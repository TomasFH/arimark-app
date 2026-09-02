/**
 * Publicación del catálogo de productos a Firestore.
 *
 * Ruta: licenses/{licenseKey}/catalog/{storeId}
 * Estructura: { products: [...], deletedProductIds: [...], auditEvents, priceHistory, updatedAt: ISO }
 *
 * Las «versiones» (revisions) son copias del catálogo vigente **antes** de una
 * confirmación de precios. Login, ↺ y cambios de ficha/visibilidad actualizan
 * el documento vivo si hace falta, pero no archivan una revisión.
 *
 * Antes de sobrescribir con `archive: true`, se guarda el snapshot anterior en
 * licenses/{licenseKey}/catalog/{storeId}/revisions/{id} (últimos 10).
 */
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  deleteDoc,
} from 'firebase/firestore'
import log from 'electron-log'
import { getDb } from '../db/client'
import { catalogAuditEvents, products, productPrices, storeProducts, stores, users } from '../db/schema'
import { and, desc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

const MAX_CATALOG_REVISIONS = 10
/** Tope por documento (1 lectura Spark). Cubre días de operación, no años. */
const MAX_AUDIT_EVENTS = 80
const MAX_PRICE_ROWS_PER_PRODUCT = 12

/** Una publicación a la vez por local: hide→show no deja un snapshot viejo pisando el nuevo. */
const publishQueue = new Map<string, Promise<void>>()

/** Agrupa tandas (Editar precios × N, o IPC sucesivos) en un solo publish/versión. */
export const CATALOG_PUBLISH_DEBOUNCE_MS = 600

interface ScheduledPublish {
  timer: ReturnType<typeof setTimeout>
  archive: boolean
}

const scheduledPublish = new Map<string, ScheduledPublish>()

export interface PublishCatalogOptions {
  /**
   * Si true y el contenido cambió, archiva el snapshot remoto actual (versión).
   * Default true en `publishCatalog` directo. El sync de login pasa false.
   */
  archive?: boolean
}

interface CatalogProduct {
  productId: string
  pluNumber: number
  name: string
  category: string
  unit: string
  price: number
  updatedAt: string
  priceUpdatedAt: string
  /** Visibilidad en este local. Ausente = disponible (compat con snapshots viejos). */
  available: boolean
}

function publishKey(licenseKey: string, storeId: string): string {
  return `${licenseKey}:${storeId}`
}

export function catalogContentFingerprint(
  catalogProducts: Array<{
    productId: string
    pluNumber: number
    name: string
    category: string
    unit: string
    price: number
    available?: boolean
  }>,
  deletedProductIds: string[],
): string {
  const items = catalogProducts
    .map(p =>
      [
        p.productId,
        p.pluNumber,
        p.name,
        p.category,
        p.unit,
        p.price,
        p.available === false ? '0' : '1',
      ].join('\t'),
    )
    .sort()
  return `${items.join('\n')}#${[...deletedProductIds].sort().join(',')}`
}

export function buildPublishedCatalog(storeId: string): {
  products: CatalogProduct[]
  deletedProductIds: string[]
} {
  const db = getDb()
  const now = new Date().toISOString()

  const productRows = db
    .select({
      productId: products.id,
      pluNumber: products.pluNumber,
      name: products.name,
      category: products.category,
      unit: products.unit,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(and(eq(products.active, true), isNotNull(products.pluNumber)))
    .all()

  const priceRows = db
    .select({
      productId: productPrices.productId,
      price: productPrices.price,
      validFrom: productPrices.validFrom,
    })
    .from(productPrices)
    .where(
      and(
        eq(productPrices.storeId, storeId),
        lte(productPrices.validFrom, now),
        or(isNull(productPrices.validTo), gt(productPrices.validTo, now)),
      ),
    )
    .all()

  const priceMap = new Map<string, { price: number; validFrom: string }>()
  for (const row of priceRows) {
    const existing = priceMap.get(row.productId)
    if (!existing || row.validFrom > existing.validFrom) {
      priceMap.set(row.productId, { price: row.price, validFrom: row.validFrom })
    }
  }

  const availRows = db
    .select({ productId: storeProducts.productId, available: storeProducts.available })
    .from(storeProducts)
    .where(eq(storeProducts.storeId, storeId))
    .all()
  const availMap = new Map(availRows.map(r => [r.productId, r.available]))

  const catalogProducts: CatalogProduct[] = productRows
    .filter(r => r.pluNumber !== null && priceMap.has(r.productId))
    .map(r => {
      const priceMeta = priceMap.get(r.productId)
      return {
        productId: r.productId,
        pluNumber: r.pluNumber as number,
        name: r.name,
        category: r.category,
        unit: r.unit,
        price: priceMeta?.price ?? 0,
        updatedAt: r.updatedAt ?? r.createdAt,
        priceUpdatedAt: priceMeta?.validFrom ?? r.updatedAt ?? r.createdAt,
        available: availMap.get(r.productId) ?? true,
      }
    })

  const deletedProductIds = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.active, false))
    .all()
    .map(r => r.id)

  return { products: catalogProducts, deletedProductIds }
}

export interface PublishedAuditEvent {
  id: string
  productId: string
  storeId: string | null
  action: string
  actorUserId: string
  actorName: string
  summary: string
  createdAt: string
}

export interface PublishedPriceHistoryRow {
  id: string
  productId: string
  price: number
  validFrom: string
  validTo: string | null
  createdBy: string
  createdByName: string
}

function userNameMap(userIds: string[]): Map<string, string> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const db = getDb()
  const rows = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(or(...unique.map(id => eq(users.id, id))))
    .all()
  return new Map(rows.map(r => [r.id, r.name]))
}

function collectAuditEvents(productIds: Set<string>): PublishedAuditEvent[] {
  if (productIds.size === 0) return []
  const db = getDb()
  const rows = db
    .select({
      id: catalogAuditEvents.id,
      productId: catalogAuditEvents.productId,
      storeId: catalogAuditEvents.storeId,
      action: catalogAuditEvents.action,
      actorUserId: catalogAuditEvents.actorUserId,
      summary: catalogAuditEvents.summary,
      createdAt: catalogAuditEvents.createdAt,
    })
    .from(catalogAuditEvents)
    .orderBy(desc(catalogAuditEvents.createdAt))
    .all()

  const filtered = rows.filter(r => productIds.has(r.productId)).slice(0, MAX_AUDIT_EVENTS)
  const names = userNameMap(filtered.map(r => r.actorUserId))
  return filtered.map(r => ({
    id: r.id,
    productId: r.productId,
    storeId: r.storeId ?? null,
    action: r.action,
    actorUserId: r.actorUserId,
    actorName: names.get(r.actorUserId) ?? r.actorUserId,
    summary: r.summary,
    createdAt: r.createdAt,
  }))
}

function collectPriceHistory(storeId: string, productIds: Set<string>): PublishedPriceHistoryRow[] {
  if (productIds.size === 0) return []
  const db = getDb()
  const rows = db
    .select({
      id: productPrices.id,
      productId: productPrices.productId,
      price: productPrices.price,
      validFrom: productPrices.validFrom,
      validTo: productPrices.validTo,
      createdBy: productPrices.createdBy,
    })
    .from(productPrices)
    .where(eq(productPrices.storeId, storeId))
    .orderBy(desc(productPrices.validFrom))
    .all()

  const grouped = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!productIds.has(row.productId)) continue
    const list = grouped.get(row.productId) ?? []
    if (list.length >= MAX_PRICE_ROWS_PER_PRODUCT) continue
    list.push(row)
    grouped.set(row.productId, list)
  }

  const picked = [...grouped.values()].flat()
  const names = userNameMap(picked.map(r => r.createdBy))
  return picked.map(r => ({
    id: r.id,
    productId: r.productId,
    price: r.price,
    validFrom: r.validFrom,
    validTo: r.validTo ?? null,
    createdBy: r.createdBy,
    createdByName: names.get(r.createdBy) ?? r.createdBy,
  }))
}

export interface CatalogRevisionRow {
  id: string
  archivedAt: string
  updatedAt: string | null
  productCount: number
}

function revisionsCol(licenseKey: string, storeId: string) {
  const firestore = getFirestore(getFirebaseApp())
  return collection(firestore, 'licenses', licenseKey, 'catalog', storeId, 'revisions')
}

async function archiveCurrentCatalog(
  licenseKey: string,
  storeId: string,
  archivedAt: string,
  preloaded?: {
    products?: unknown[]
    updatedAt?: string
    deletedProductIds?: string[]
    auditEvents?: unknown[]
    priceHistory?: unknown[]
  } | null,
): Promise<void> {
  let data = preloaded ?? null
  if (!data) {
    const firestore = getFirestore(getFirebaseApp())
    const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
    const snap = await getDoc(catalogRef)
    if (!snap.exists()) return
    data = snap.data() as {
      products?: unknown[]
      updatedAt?: string
      deletedProductIds?: string[]
      auditEvents?: unknown[]
      priceHistory?: unknown[]
    }
  }
  if (!Array.isArray(data.products) || data.products.length === 0) return

  const revRef = doc(revisionsCol(licenseKey, storeId))
  await setDoc(revRef, {
    products: data.products,
    deletedProductIds: data.deletedProductIds ?? [],
    updatedAt: data.updatedAt ?? null,
    archivedAt,
    productCount: data.products.length,
    auditEvents: Array.isArray(data.auditEvents) ? data.auditEvents : [],
    priceHistory: Array.isArray(data.priceHistory) ? data.priceHistory : [],
  })

  try {
    const q = query(revisionsCol(licenseKey, storeId), orderBy('archivedAt', 'desc'))
    const docs = await getDocs(q)
    const extra = docs.docs.slice(MAX_CATALOG_REVISIONS)
    for (const d of extra) {
      await deleteDoc(d.ref)
    }
  } catch (err) {
    log.warn('[catalogPublish] No se pudieron podar revisiones viejas', { storeId, err })
  }
}

/**
 * Publica el catálogo vigente del local indicado a Firestore.
 * No-op en modo dev. Archiva el snapshot previo si existía.
 * Las llamadas se encolan por local para que gane el SQLite más reciente.
 * Cancela un publish agendado (debounce de tanda) para este local.
 */
export async function publishCatalog(
  licenseKey: string,
  storeId: string,
  opts?: PublishCatalogOptions,
): Promise<void> {
  const key = publishKey(licenseKey, storeId)
  const pending = scheduledPublish.get(key)
  if (pending) {
    clearTimeout(pending.timer)
    scheduledPublish.delete(key)
  }
  const previous = publishQueue.get(key) ?? Promise.resolve()
  const next = previous.then(
    () => publishCatalogNow(licenseKey, storeId, opts),
    () => publishCatalogNow(licenseKey, storeId, opts),
  )
  publishQueue.set(key, next)
  await next
}

/** Un solo publish tras una tanda de IPC (Editar precios × N). */
export function scheduleCatalogPublish(
  licenseKey: string,
  storeId: string,
  opts?: PublishCatalogOptions,
): void {
  const key = publishKey(licenseKey, storeId)
  const prev = scheduledPublish.get(key)
  if (prev) clearTimeout(prev.timer)
  const archive = (prev?.archive === true) || (opts?.archive === true)
  scheduledPublish.set(key, {
    archive,
    timer: setTimeout(() => {
      scheduledPublish.delete(key)
      void publishCatalog(licenseKey, storeId, { archive })
    }, CATALOG_PUBLISH_DEBOUNCE_MS),
  })
}

export function scheduleCatalogPublishForAllStores(
  licenseKey: string,
  opts?: PublishCatalogOptions,
): void {
  if (!isFirebaseAvailable()) return
  const db = getDb()
  const rows = db
    .select({ id: stores.id })
    .from(stores)
    .where(isNull(stores.archivedAt))
    .all()
  for (const row of rows) {
    scheduleCatalogPublish(licenseKey, row.id, opts)
  }
}

export function clearScheduledCatalogPublishes(): void {
  for (const pending of scheduledPublish.values()) {
    clearTimeout(pending.timer)
  }
  scheduledPublish.clear()
}

async function publishCatalogNow(
  licenseKey: string,
  storeId: string,
  opts?: PublishCatalogOptions,
): Promise<void> {
  if (!isFirebaseAvailable()) {
    log.info('[catalogPublish] Firebase no disponible (dev) — publicación omitida')
    return
  }

  const shouldArchive = opts?.archive !== false

  try {
    const now = new Date().toISOString()
    const { products: catalogProducts, deletedProductIds } = buildPublishedCatalog(storeId)

    if (catalogProducts.length === 0) {
      log.info('[catalogPublish] Sin productos con PLU y precio — publicación omitida', { storeId })
      return
    }

    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
    const currentSnap = await getDoc(catalogRef)
    if (currentSnap.exists()) {
      const data = currentSnap.data() as {
        products?: CatalogProduct[]
        deletedProductIds?: string[]
      }
      const remoteProducts = Array.isArray(data.products) ? data.products : []
      const remoteDeleted = Array.isArray(data.deletedProductIds) ? data.deletedProductIds : []
      const localFp = catalogContentFingerprint(catalogProducts, deletedProductIds)
      const remoteFp = catalogContentFingerprint(remoteProducts, remoteDeleted)
      if (localFp === remoteFp) {
        log.info('[catalogPublish] Catálogo idéntico al remoto — no se publica ni se archiva versión', { storeId })
        return
      }
    }

    const catalogProductIds = new Set(catalogProducts.map(p => p.productId))
    const auditProductIds = new Set(catalogProductIds)
    for (const id of deletedProductIds) auditProductIds.add(id)
    const auditEvents = collectAuditEvents(auditProductIds)
    const priceHistory = collectPriceHistory(storeId, catalogProductIds)

    if (shouldArchive && currentSnap.exists()) {
      await archiveCurrentCatalog(licenseKey, storeId, now, currentSnap.data() as {
        products?: unknown[]
        updatedAt?: string
        deletedProductIds?: string[]
        auditEvents?: unknown[]
        priceHistory?: unknown[]
      })
    }

    await setDoc(catalogRef, {
      products: catalogProducts,
      deletedProductIds,
      auditEvents,
      priceHistory,
      updatedAt: now,
    })

    log.info('[catalogPublish] Catálogo publicado', {
      storeId,
      products: catalogProducts.length,
      archived: shouldArchive && currentSnap.exists(),
    })
  } catch (err) {
    log.error('[catalogPublish] Error al publicar catálogo', err)
  }
}

export async function publishCatalogForAllStores(
  licenseKey: string,
  opts?: PublishCatalogOptions,
): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const rows = db
    .select({ id: stores.id })
    .from(stores)
    .where(isNull(stores.archivedAt))
    .all()

  for (const row of rows) {
    await publishCatalog(licenseKey, row.id, opts)
  }
}

export async function listCatalogRevisions(
  licenseKey: string,
  storeId: string,
): Promise<CatalogRevisionRow[]> {
  if (!isFirebaseAvailable()) return []

  const q = query(revisionsCol(licenseKey, storeId), orderBy('archivedAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const data = d.data() as { archivedAt?: string; updatedAt?: string | null; productCount?: number; products?: unknown[] }
    const count = data.productCount ?? (Array.isArray(data.products) ? data.products.length : 0)
    return {
      id: d.id,
      archivedAt: data.archivedAt ?? '',
      updatedAt: data.updatedAt ?? null,
      productCount: count,
    }
  })
}

/**
 * Restaura un snapshot archivado como catálogo vigente (y archiva el actual antes).
 */
export async function restoreCatalogRevision(
  licenseKey: string,
  storeId: string,
  revisionId: string,
): Promise<{ productCount: number }> {
  if (!isFirebaseAvailable()) {
    throw new Error('Firebase no disponible.')
  }

  const firestore = getFirestore(getFirebaseApp())
  const revRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId, 'revisions', revisionId)
  const revSnap = await getDoc(revRef)
  if (!revSnap.exists()) {
    throw new Error('Versión de catálogo no encontrada.')
  }

  const data = revSnap.data() as {
    products?: CatalogProduct[]
    updatedAt?: string
    deletedProductIds?: string[]
    auditEvents?: unknown[]
    priceHistory?: unknown[]
  }
  if (!Array.isArray(data.products) || data.products.length === 0) {
    throw new Error('La versión archivada está vacía.')
  }

  const now = new Date().toISOString()
  const restoredProducts = data.products.map(p => ({
    ...p,
    updatedAt: now,
    priceUpdatedAt: now,
  }))
  await archiveCurrentCatalog(licenseKey, storeId, now)

  const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
  await setDoc(catalogRef, {
    products: restoredProducts,
    deletedProductIds: data.deletedProductIds ?? [],
    auditEvents: Array.isArray(data.auditEvents) ? data.auditEvents : [],
    // Sin historial viejo: si se copia, el merge conserva precios posteriores y anula el restore.
    priceHistory: [],
    updatedAt: now,
    restoredAt: now,
  })

  log.info('[catalogPublish] Catálogo restaurado desde revisión', {
    storeId,
    revisionId,
    products: data.products.length,
  })

  return { productCount: data.products.length }
}
