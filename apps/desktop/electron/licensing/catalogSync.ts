/**
 * Sincroniza el catálogo publicado en Firestore con SQLite local.
 *
 * Ruta: licenses/{licenseKey}/catalog/{storeId}
 *
 * Merge por producto (no hay una PC “maestra”):
 *  - Alta en cualquier dispositivo → llega a los demás.
 *  - Precio/nombre más nuevo gana por ítem.
 *  - Baja global (soft-delete) se propaga vía deletedProductIds.
 *  - Visibilidad por local (`available`) viaja en cada ítem del catálogo de ese local.
 * Después del merge se republica el union para que el resto reciba lo local-only.
 */
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { getDb } from '../db/client'
import { products, productPrices, storeProducts, stores } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getActiveSession } from '../activeSession'
import { publishCatalog } from './catalogPublish'

interface CatalogProduct {
  productId: string
  pluNumber: number
  name: string
  category: string
  unit: string
  price: number
  /** Edición de ficha. Si coincide con updatedAt del documento, es sello de lote viejo — no pisar nombres. */
  updatedAt?: string
  priceUpdatedAt?: string
  /** Visibilidad en este local. Ausente = no tocar (compat con snapshots viejos). */
  available?: boolean
}

interface RemoteCatalog {
  products: CatalogProduct[]
  updatedAt: string | null
  deletedProductIds: string[]
}

type DbTx = ReturnType<typeof getDb>

function applyRemotePrice(
  tx: DbTx,
  productId: string,
  storeId: string,
  price: number,
  userId: string,
  now: string,
): void {
  tx.update(productPrices)
    .set({ validTo: now })
    .where(
      and(
        eq(productPrices.productId, productId),
        eq(productPrices.storeId, storeId),
        isNull(productPrices.validTo),
      ),
    )
    .run()

  tx.insert(productPrices)
    .values({
      id: uuidv4(),
      productId,
      storeId,
      price,
      validFrom: now,
      validTo: null,
      createdBy: userId,
    })
    .run()
}

function applyRemoteIdentity(tx: DbTx, p: CatalogProduct, now: string): void {
  tx.update(products)
    .set({ pluNumber: null })
    .where(and(eq(products.pluNumber, p.pluNumber), ne(products.id, p.productId)))
    .run()

  tx.insert(products)
    .values({
      id: p.productId,
      name: p.name,
      category: p.category as 'beef_cut' | 'poultry' | 'pork' | 'other',
      unit: p.unit as 'kg' | 'unit',
      pluNumber: p.pluNumber,
      active: true,
      createdAt: now,
      updatedAt: p.updatedAt ?? now,
    })
    .onConflictDoUpdate({
      target: products.id,
      set: {
        name: p.name,
        pluNumber: p.pluNumber,
        category: p.category as 'beef_cut' | 'poultry' | 'pork' | 'other',
        unit: p.unit as 'kg' | 'unit',
        active: true,
        updatedAt: p.updatedAt ?? now,
      },
    })
    .run()
}

function applyRemoteAvailability(tx: DbTx, productId: string, storeId: string, available: boolean): void {
  const existing = tx
    .select({ productId: storeProducts.productId })
    .from(storeProducts)
    .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
    .get()
  if (existing) {
    tx.update(storeProducts)
      .set({ available })
      .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
      .run()
  } else {
    tx.insert(storeProducts).values({ storeId, productId, available }).run()
  }
}

function applyRemoteProduct(
  tx: DbTx,
  p: CatalogProduct,
  storeId: string,
  userId: string,
  now: string,
): void {
  applyRemoteIdentity(tx, p, now)
  applyRemotePrice(tx, p.productId, storeId, p.price, userId, now)
  if (p.available !== undefined) applyRemoteAvailability(tx, p.productId, storeId, p.available)
}

function localIdentityTs(tx: DbTx, productId: string): string | null {
  const row = tx
    .select({ createdAt: products.createdAt, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.id, productId))
    .get()
  if (!row) return null
  return row.updatedAt ?? row.createdAt
}

function localPriceTs(tx: DbTx, productId: string, storeId: string): string | null {
  const price = tx
    .select({ validFrom: productPrices.validFrom })
    .from(productPrices)
    .where(
      and(
        eq(productPrices.productId, productId),
        eq(productPrices.storeId, storeId),
        isNull(productPrices.validTo),
      ),
    )
    .get()
  return price?.validFrom ?? null
}

function isBatchStamp(p: CatalogProduct, remote: RemoteCatalog): boolean {
  return p.updatedAt != null && remote.updatedAt != null && p.updatedAt === remote.updatedAt
}

function hasPricedLocalCatalog(storeId: string): boolean {
  const db = getDb()
  const priced = db
    .select({ productId: productPrices.productId })
    .from(productPrices)
    .where(and(eq(productPrices.storeId, storeId), isNull(productPrices.validTo)))
    .all()
  if (priced.length === 0) return false

  const pricedIds = new Set(priced.map(r => r.productId))
  const active = db
    .select({ id: products.id })
    .from(products)
    .all()
    .filter(p => pricedIds.has(p.id))
  return active.length > 0
}

async function readRemoteCatalog(licenseKey: string, storeId: string): Promise<RemoteCatalog | null> {
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
  const snap = await getDoc(catalogRef)
  if (!snap.exists()) return null

  const data = snap.data() as {
    products?: CatalogProduct[]
    updatedAt?: string
    deletedProductIds?: string[]
  }
  if (!Array.isArray(data.products) || data.products.length === 0) {
    return {
      products: [],
      updatedAt: data.updatedAt ?? null,
      deletedProductIds: Array.isArray(data.deletedProductIds) ? data.deletedProductIds : [],
    }
  }
  return {
    products: data.products,
    updatedAt: data.updatedAt ?? null,
    deletedProductIds: Array.isArray(data.deletedProductIds) ? data.deletedProductIds : [],
  }
}

/**
 * Aplica el snapshot remoto completo (restore / PC sin catálogo local).
 */
export async function pullCatalogFromFirestore(licenseKey: string, storeId: string): Promise<void> {
  if (!isFirebaseAvailable()) {
    log.info('[catalogSync] Firebase no disponible — pull omitido')
    return
  }

  const session = getActiveSession()
  if (!session) {
    log.warn('[catalogSync] Sin sesión activa — pull omitido')
    return
  }

  try {
    const remote = await readRemoteCatalog(licenseKey, storeId)
    if (!remote || remote.products.length === 0) {
      log.info('[catalogSync] Catálogo aún no publicado o vacío', { storeId })
      return
    }

    const db = getDb()
    const now = new Date().toISOString()
    const userId = session.userId

    db.transaction(tx => {
      for (const p of remote.products) {
        applyRemoteProduct(tx as unknown as DbTx, p, storeId, userId, now)
      }
    })

    log.info('[catalogSync] Catálogo sincronizado desde Firestore', {
      storeId,
      count: remote.products.length,
    })
  } catch (err) {
    log.error('[catalogSync] Error al sincronizar catálogo', err)
  }
}

function mergeRemoteIntoLocal(
  storeId: string,
  remote: RemoteCatalog,
  userId: string,
): { applied: number; keptLocal: number; deleted: number } {
  const db = getDb()
  const now = new Date().toISOString()
  const remoteIds = new Set(remote.products.map(p => p.productId))
  let applied = 0
  let keptLocal = 0
  let deleted = 0

  db.transaction(tx => {
    const t = tx as unknown as DbTx
    for (const p of remote.products) {
      const local = t
        .select({ active: products.active })
        .from(products)
        .where(eq(products.id, p.productId))
        .get()
      if (local && !local.active) {
        keptLocal += 1
        continue
      }

      if (!local) {
        applyRemoteProduct(t, p, storeId, userId, now)
        applied += 1
        continue
      }

      const localIdTs = localIdentityTs(t, p.productId)
      const remoteIdTs = p.updatedAt ?? ''
      const identityFromRemote =
        !isBatchStamp(p, remote)
        && remoteIdTs !== ''
        && localIdTs != null
        && remoteIdTs > localIdTs

      const localPTs = localPriceTs(t, p.productId, storeId)
      const remotePTs = p.priceUpdatedAt ?? (isBatchStamp(p, remote) ? '' : (p.updatedAt ?? ''))
      const priceFromRemote = localPTs == null || (remotePTs !== '' && remotePTs > localPTs)

      if (identityFromRemote) applyRemoteIdentity(t, p, now)
      if (priceFromRemote) applyRemotePrice(t, p.productId, storeId, p.price, userId, now)
      if (p.available !== undefined) applyRemoteAvailability(t, p.productId, storeId, p.available)

      if (identityFromRemote || priceFromRemote) applied += 1
      else keptLocal += 1
    }

    for (const id of remote.deletedProductIds) {
      if (remoteIds.has(id)) continue
      const row = t.select({ id: products.id, active: products.active }).from(products).where(eq(products.id, id)).get()
      if (!row || !row.active) continue
      t.update(products)
        .set({ active: false, pluNumber: null })
        .where(eq(products.id, id))
        .run()
      deleted += 1
    }
  })

  return { applied, keptLocal, deleted }
}

/**
 * Sincroniza el catálogo de un local: merge por producto y republica el union.
 *
 * - SQLite vacío → baja el snapshot remoto.
 * - Firestore ausente y hay catálogo local → publica.
 * - Ambos existen → une altas, respeta el ítem más nuevo, aplica bajas, republica.
 */
export async function syncCatalogWithFirestore(licenseKey: string, storeId: string): Promise<void> {
  if (!isFirebaseAvailable()) {
    log.info('[catalogSync] Firebase no disponible — sync omitido')
    return
  }

  const session = getActiveSession()
  if (!session) {
    log.warn('[catalogSync] Sin sesión activa — sync omitido')
    return
  }

  const hasLocal = hasPricedLocalCatalog(storeId)

  let remote: RemoteCatalog | null = null
  try {
    remote = await readRemoteCatalog(licenseKey, storeId)
  } catch (err) {
    log.warn('[catalogSync] No se pudo leer catálogo remoto', { storeId, err })
  }

  if (!hasLocal) {
    log.info('[catalogSync] Sin catálogo local — pull', { storeId })
    await pullCatalogFromFirestore(licenseKey, storeId)
    return
  }

  if (!remote) {
    log.info('[catalogSync] Firestore ausente — publish', { storeId })
    await publishCatalog(licenseKey, storeId)
    return
  }

  const stats = mergeRemoteIntoLocal(storeId, remote, session.userId)
  log.info('[catalogSync] Merge catálogo', { storeId, ...stats, remoteCount: remote.products.length })
  await publishCatalog(licenseKey, storeId)
}

/**
 * Sincroniza el catálogo de todos los locales activos.
 * Lo usa el admin al loguear o refrescar (no tiene un único storeId de trabajo).
 */
export async function syncAllStoreCatalogs(licenseKey: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const rows = db
    .select({ id: stores.id })
    .from(stores)
    .where(isNull(stores.archivedAt))
    .all()

  for (const row of rows) {
    await syncCatalogWithFirestore(licenseKey, row.id)
  }
}
