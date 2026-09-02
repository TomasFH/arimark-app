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
 * Después del merge one-shot se republica el union **solo si el contenido
 * (precios/ficha/visibilidad) difiere**, y sin archivar versión. El login/↺
 * no genera entradas en Versiones. El listener en vivo
 * solo republica si el snapshot está incompleto (altas locales con precio
 * que el remoto no trae); un eco de nuestra publicación no vuelve a publicar.
 */
import { getFirestore, doc, getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { getDb } from '../db/client'
import { catalogAuditEvents, products, productPrices, storeProducts, stores, users } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getActiveSession } from '../activeSession'
import { publishCatalog, buildPublishedCatalog, catalogContentFingerprint } from './catalogPublish'
import { notifyRenderer } from './notifyRenderer'
import { IPC } from '../ipc/channels'
import { ensureUserStubWith } from './syncUserStub'

/**
 * Listener en vivo (BLOQUE I-A). El renderer recarga lista/POS con
 * `useCatalogSyncReload` (`apps/desktop/src/lib/useCatalogSyncReload.ts`).
 * AdminScreen (otro agente / I-B): usar ese hook; no mutar ítems ya en el ticket.
 */

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

type CatalogAuditAction = 'create' | 'update_identity' | 'hide_store' | 'show_store' | 'retire_global' | 'restore_revision'

const AUDIT_ACTIONS = new Set<CatalogAuditAction>([
  'create',
  'update_identity',
  'hide_store',
  'show_store',
  'retire_global',
  'restore_revision',
])

interface RemoteAuditEvent {
  id: string
  productId: string
  storeId: string | null
  action: CatalogAuditAction
  actorUserId: string
  actorName: string
  summary: string
  createdAt: string
}

interface RemotePriceHistoryRow {
  id: string
  productId: string
  price: number
  validFrom: string
  validTo: string | null
  createdBy: string
  createdByName: string
}

interface RemoteCatalog {
  products: CatalogProduct[]
  updatedAt: string | null
  deletedProductIds: string[]
  auditEvents: RemoteAuditEvent[] | null
  priceHistory: RemotePriceHistoryRow[] | null
  /** Si está, este snapshot es un restore: pisar precios/ficha locales más nuevos. */
  restoredAt: string | null
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

function applyRemoteAvailability(tx: DbTx, productId: string, storeId: string, available: boolean): boolean {
  const existing = tx
    .select({ productId: storeProducts.productId, available: storeProducts.available })
    .from(storeProducts)
    .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
    .get()
  if (existing) {
    if (Boolean(existing.available) === Boolean(available)) return false
    tx.update(storeProducts)
      .set({ available })
      .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
      .run()
    return true
  }
  tx.insert(storeProducts).values({ storeId, productId, available }).run()
  return true
}

function applyRemoteProduct(
  tx: DbTx,
  p: CatalogProduct,
  storeId: string,
  userId: string,
  now: string,
  opts?: { skipPrice?: boolean },
): void {
  applyRemoteIdentity(tx, p, now)
  if (!opts?.skipPrice) applyRemotePrice(tx, p.productId, storeId, p.price, userId, now)
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

function parseRemoteCatalogData(data: unknown): RemoteCatalog {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const productsList = Array.isArray(raw['products']) ? (raw['products'] as CatalogProduct[]) : []
  const deletedRaw = raw['deletedProductIds']
  const deletedProductIds = Array.isArray(deletedRaw)
    ? deletedRaw.filter((id): id is string => typeof id === 'string')
    : []
  const updatedAt = typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : null
  const restoredAt = typeof raw['restoredAt'] === 'string' && raw['restoredAt'].trim()
    ? raw['restoredAt']
    : null
  return {
    products: productsList,
    updatedAt,
    deletedProductIds,
    auditEvents: parseRemoteAuditEvents(raw['auditEvents']),
    priceHistory: parseRemotePriceHistory(raw['priceHistory']),
    restoredAt,
  }
}

function parseRemoteAuditEvents(raw: unknown): RemoteAuditEvent[] | null {
  if (!Array.isArray(raw)) return null
  const rows: RemoteAuditEvent[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    const productId = typeof r.productId === 'string' ? r.productId : ''
    const action = typeof r.action === 'string' && AUDIT_ACTIONS.has(r.action as CatalogAuditAction)
      ? (r.action as CatalogAuditAction)
      : null
    const actorUserId = typeof r.actorUserId === 'string' ? r.actorUserId : ''
    const summary = typeof r.summary === 'string' ? r.summary : ''
    const createdAt = typeof r.createdAt === 'string' ? r.createdAt : ''
    if (!id || !productId || !action || !actorUserId || !summary || !createdAt) continue
    rows.push({
      id,
      productId,
      storeId: typeof r.storeId === 'string' ? r.storeId : null,
      action,
      actorUserId,
      actorName: typeof r.actorName === 'string' && r.actorName.trim() ? r.actorName : actorUserId,
      summary,
      createdAt,
    })
  }
  return rows
}

function parseRemotePriceHistory(raw: unknown): RemotePriceHistoryRow[] | null {
  if (!Array.isArray(raw)) return null
  const rows: RemotePriceHistoryRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    const productId = typeof r.productId === 'string' ? r.productId : ''
    const createdBy = typeof r.createdBy === 'string' ? r.createdBy : ''
    const validFrom = typeof r.validFrom === 'string' ? r.validFrom : ''
    const price = typeof r.price === 'number' && Number.isFinite(r.price) ? r.price : NaN
    if (!id || !productId || !createdBy || !validFrom || !Number.isFinite(price)) continue
    rows.push({
      id,
      productId,
      price,
      validFrom,
      validTo: typeof r.validTo === 'string' ? r.validTo : null,
      createdBy,
      createdByName: typeof r.createdByName === 'string' && r.createdByName.trim() ? r.createdByName : createdBy,
    })
  }
  return rows
}

function mergeRemoteAuditEvents(tx: DbTx, storeId: string, events: RemoteAuditEvent[]): void {
  for (const event of events) {
    ensureUserStubWith(tx, event.actorUserId, storeId, event.actorName)
    const existing = tx
      .select({ id: catalogAuditEvents.id })
      .from(catalogAuditEvents)
      .where(eq(catalogAuditEvents.id, event.id))
      .get()
    if (existing) continue
    try {
      tx.insert(catalogAuditEvents)
        .values({
          id: event.id,
          productId: event.productId,
          storeId: event.storeId,
          action: event.action,
          actorUserId: event.actorUserId,
          summary: event.summary,
          createdAt: event.createdAt,
        })
        .run()
    } catch (err) {
      log.warn('[catalogSync] Auditoría remota omitida', { id: event.id, productId: event.productId, err })
    }
  }
}

function mergeRemotePriceHistory(
  tx: DbTx,
  storeId: string,
  rows: RemotePriceHistoryRow[],
): boolean {
  const storeRow = tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).get()
  if (!storeRow) {
    log.warn('[catalogSync] Historial de precios omitido: local ausente', { storeId })
    return false
  }

  let changed = false
  for (const row of rows) {
    const product = tx.select({ id: products.id }).from(products).where(eq(products.id, row.productId)).get()
    if (!product) {
      log.warn('[catalogSync] Historial de precio omitido: producto ausente', {
        productId: row.productId,
        storeId,
      })
      continue
    }

    ensureUserStubWith(tx, row.createdBy, storeId, row.createdByName)
    const actor = tx.select({ id: users.id }).from(users).where(eq(users.id, row.createdBy)).get()
    if (!actor) {
      log.warn('[catalogSync] Historial de precio omitido: autor ausente', {
        createdBy: row.createdBy,
        productId: row.productId,
      })
      continue
    }

    const existing = tx
      .select({
        id: productPrices.id,
        price: productPrices.price,
        validTo: productPrices.validTo,
      })
      .from(productPrices)
      .where(eq(productPrices.id, row.id))
      .get()
    if (existing) {
      const remoteTo = row.validTo
      const localTo = existing.validTo ?? null
      if (existing.price !== row.price || localTo !== remoteTo) {
        try {
          tx.update(productPrices)
            .set({ price: row.price, validTo: remoteTo })
            .where(eq(productPrices.id, row.id))
            .run()
          changed = true
        } catch (err) {
          log.warn('[catalogSync] No se pudo actualizar precio remoto', { id: row.id, err })
        }
      }
      continue
    }
    try {
      tx.insert(productPrices)
        .values({
          id: row.id,
          productId: row.productId,
          storeId,
          price: row.price,
          validFrom: row.validFrom,
          validTo: row.validTo,
          createdBy: row.createdBy,
        })
        .run()
      changed = true
    } catch (err) {
      log.warn('[catalogSync] Precio remoto omitido', { id: row.id, productId: row.productId, storeId, err })
    }
  }

  const productIds = [...new Set(rows.map(r => r.productId))]
  for (const productId of productIds) {
    const open = tx
      .select({ id: productPrices.id, validFrom: productPrices.validFrom })
      .from(productPrices)
      .where(
        and(
          eq(productPrices.productId, productId),
          eq(productPrices.storeId, storeId),
          isNull(productPrices.validTo),
        ),
      )
      .all()
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0))
    for (const extra of open.slice(1)) {
      try {
        tx.update(productPrices)
          .set({ validTo: open[0]?.validFrom ?? extra.validFrom })
          .where(eq(productPrices.id, extra.id))
          .run()
        changed = true
      } catch (err) {
        log.warn('[catalogSync] No se pudo cerrar precio duplicado', { id: extra.id, err })
      }
    }
  }

  return changed
}

function applySnapshotForced(
  tx: DbTx,
  storeId: string,
  remote: RemoteCatalog,
  userId: string,
  now: string,
): { applied: number; deleted: number; availabilityChanged: number } {
  ensureUserStubWith(tx, userId, storeId)
  let applied = 0
  let deleted = 0
  let availabilityChanged = 0
  const remoteIds = new Set(remote.products.map(p => p.productId))

  for (const p of remote.products) {
    applyRemoteIdentity(tx, p, now)
    applyRemotePrice(tx, p.productId, storeId, p.price, userId, now)
    applied += 1
    if (p.available !== undefined && applyRemoteAvailability(tx, p.productId, storeId, p.available)) {
      availabilityChanged += 1
    }
  }

  for (const id of remote.deletedProductIds) {
    if (remoteIds.has(id)) continue
    const row = tx.select({ id: products.id, active: products.active }).from(products).where(eq(products.id, id)).get()
    if (!row || !row.active) continue
    tx.update(products)
      .set({ active: false, pluNumber: null })
      .where(eq(products.id, id))
      .run()
    deleted += 1
  }

  if (remote.auditEvents) mergeRemoteAuditEvents(tx, storeId, remote.auditEvents)
  return { applied, deleted, availabilityChanged }
}

async function readRemoteCatalog(licenseKey: string, storeId: string): Promise<RemoteCatalog | null> {
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
  const snap = await getDoc(catalogRef)
  if (!snap.exists()) return null
  return parseRemoteCatalogData(snap.data())
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
      const t = tx as unknown as DbTx
      if (remote.restoredAt) {
        applySnapshotForced(t, storeId, remote, userId, now)
        return
      }
      const skipPrice = (remote.priceHistory?.length ?? 0) > 0
      for (const p of remote.products) {
        applyRemoteProduct(t, p, storeId, userId, now, { skipPrice })
      }
      if (remote.auditEvents) mergeRemoteAuditEvents(t, storeId, remote.auditEvents)
      if (remote.priceHistory) mergeRemotePriceHistory(t, storeId, remote.priceHistory)
      if (skipPrice) {
        for (const p of remote.products) {
          const hasPrice = t
            .select({ id: productPrices.id })
            .from(productPrices)
            .where(
              and(
                eq(productPrices.productId, p.productId),
                eq(productPrices.storeId, storeId),
                isNull(productPrices.validTo),
              ),
            )
            .get()
          if (!hasPrice) {
            try {
              applyRemotePrice(t, p.productId, storeId, p.price, userId, now)
            } catch (err) {
              log.warn('[catalogSync] Precio vigente de respaldo omitido', { productId: p.productId, storeId, err })
            }
          }
        }
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
): { applied: number; keptLocal: number; deleted: number; availabilityChanged: number } {
  const db = getDb()
  const now = new Date().toISOString()
  const remoteIds = new Set(remote.products.map(p => p.productId))
  let applied = 0
  let keptLocal = 0
  let deleted = 0
  let availabilityChanged = 0

  if (remote.restoredAt) {
    db.transaction(tx => {
      const stats = applySnapshotForced(tx as unknown as DbTx, storeId, remote, userId, now)
      applied = stats.applied
      deleted = stats.deleted
      availabilityChanged = stats.availabilityChanged
    })
    return { applied, keptLocal: 0, deleted, availabilityChanged }
  }

  const skipPrice = (remote.priceHistory?.length ?? 0) > 0

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
        applyRemoteProduct(t, p, storeId, userId, now, { skipPrice })
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
      if (!skipPrice && priceFromRemote) applyRemotePrice(t, p.productId, storeId, p.price, userId, now)
      if (p.available !== undefined && applyRemoteAvailability(t, p.productId, storeId, p.available)) {
        availabilityChanged += 1
      }

      if (identityFromRemote || (!skipPrice && priceFromRemote)) applied += 1
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

    if (remote.auditEvents) mergeRemoteAuditEvents(t, storeId, remote.auditEvents)
    if (remote.priceHistory && mergeRemotePriceHistory(t, storeId, remote.priceHistory)) {
      applied += 1
    }
    if (skipPrice) {
      for (const p of remote.products) {
        const hasPrice = t
          .select({ id: productPrices.id })
          .from(productPrices)
          .where(
            and(
              eq(productPrices.productId, p.productId),
              eq(productPrices.storeId, storeId),
              isNull(productPrices.validTo),
            ),
          )
          .get()
        if (!hasPrice) {
          try {
            applyRemotePrice(t, p.productId, storeId, p.price, userId, now)
          } catch (err) {
            log.warn('[catalogSync] Precio vigente de respaldo omitido', { productId: p.productId, storeId, err })
          }
        }
      }
    }
  })

  return { applied, keptLocal, deleted, availabilityChanged }
}

/** Productos locales con precio vigente que el snapshot no trae y no marca como baja. */
function hasLocalOnlyPricedProducts(storeId: string, remote: RemoteCatalog): boolean {
  const remoteIds = new Set(remote.products.map(p => p.productId))
  const deleted = new Set(remote.deletedProductIds)
  const db = getDb()
  const priced = db
    .select({ productId: productPrices.productId })
    .from(productPrices)
    .where(and(eq(productPrices.storeId, storeId), isNull(productPrices.validTo)))
    .all()

  for (const row of priced) {
    if (remoteIds.has(row.productId) || deleted.has(row.productId)) continue
    const prod = db
      .select({ id: products.id, active: products.active })
      .from(products)
      .where(eq(products.id, row.productId))
      .get()
    if (prod?.active) return true
  }
  return false
}

interface CatalogDocSnap {
  exists: () => boolean
  data: () => unknown
}

async function applyLiveCatalogSnapshot(
  licenseKey: string,
  storeId: string,
  snap: CatalogDocSnap,
): Promise<void> {
  const session = getActiveSession()
  if (!session) {
    log.warn('[catalogSync] Sin sesión — snapshot de catálogo omitido', { storeId })
    return
  }

  const remote = snap.exists()
    ? parseRemoteCatalogData(snap.data())
    : { products: [], updatedAt: null, deletedProductIds: [], auditEvents: null, priceHistory: null, restoredAt: null }

  const stats = mergeRemoteIntoLocal(storeId, remote, session.userId)
  const incomplete = hasLocalOnlyPricedProducts(storeId, remote)

  // Anti-loop: republicar SOLO si el snapshot no trae altas locales (union incompleto).
  // Un eco de nuestra propia publicación ya es el union → applied/deleted 0 y no incompleto.
  if (incomplete) {
    log.info('[catalogSync] Snapshot incompleto — republicar union', { storeId, ...stats })
    await publishCatalog(licenseKey, storeId, { archive: false })
  } else {
    log.info('[catalogSync] Snapshot aplicado sin republicar', { storeId, ...stats, remoteCount: remote.products.length })
  }

  if (stats.applied > 0 || stats.deleted > 0 || stats.availabilityChanged > 0) {
    notifyRenderer(IPC.CATALOG_SYNC_UPDATED, { storeId })
  }
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
    await publishCatalog(licenseKey, storeId, { archive: false })
    return
  }

  const stats = mergeRemoteIntoLocal(storeId, remote, session.userId)
  log.info('[catalogSync] Merge catálogo', { storeId, ...stats, remoteCount: remote.products.length })

  const local = buildPublishedCatalog(storeId)
  const localFp = catalogContentFingerprint(local.products, local.deletedProductIds)
  const remoteFp = catalogContentFingerprint(remote.products, remote.deletedProductIds)
  if (localFp === remoteFp) {
    log.info('[catalogSync] Catálogo igual al remoto — no se publica (login/↺ no genera versión)', { storeId })
    return
  }
  await publishCatalog(licenseKey, storeId, { archive: false })
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
    try {
      await syncCatalogWithFirestore(licenseKey, row.id)
    } catch (err) {
      log.error('[catalogSync] Sync de un local falló — se continúa con el resto', { storeId: row.id, err })
    }
  }
}

// ---------------------------------------------------------------------------
// Listener en vivo (BLOQUE I-A) — 1 doc por local, no 1 por producto
// ---------------------------------------------------------------------------

const catalogUnsubs: Unsubscribe[] = []
let catalogListenerTenant: string | null = null
let catalogListenerStoreKey = ''

function catalogStoreKey(ids: string[]): string {
  return [...ids].sort().join(',')
}

function resolveCatalogListenerStoreIds(): string[] {
  const session = getActiveSession()
  if (session?.role === 'cashier' && session.storeId) {
    return [session.storeId]
  }
  const db = getDb()
  return db
    .select({ id: stores.id })
    .from(stores)
    .where(isNull(stores.archivedAt))
    .all()
    .map(r => r.id)
}

/**
 * onSnapshot de `licenses/{tenant}/catalog/{storeId}`.
 * Cajera: el local de sesión. Admin o sin store: todos los locales activos.
 * Idempotente: mismo tenant + mismos locales → no duplica.
 */
export function startCatalogSyncListener(tenantId: string): void {
  if (!isFirebaseAvailable()) {
    log.info('[catalogSync] Firebase no disponible — listener de catálogo omitido')
    return
  }

  const storeIds = resolveCatalogListenerStoreIds()
  const storeKey = catalogStoreKey(storeIds)
  if (catalogUnsubs.length > 0 && catalogListenerTenant === tenantId && catalogListenerStoreKey === storeKey) {
    log.info('[catalogSync] Listener de catálogo ya activo — omitido')
    return
  }

  stopCatalogSyncListener()

  if (storeIds.length === 0) {
    log.info('[catalogSync] Sin locales para listener de catálogo')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)

    for (const storeId of storeIds) {
      const catalogRef = doc(firestore, 'licenses', tenantId, 'catalog', storeId)
      const unsub = onSnapshot(
        catalogRef,
        snapshot => applyLiveCatalogSnapshot(tenantId, storeId, snapshot).catch(err => {
          log.error('[catalogSync] Error aplicando snapshot de catálogo', { storeId, err })
        }),
        err => {
          log.error('[catalogSync] Error en listener de catálogo', { storeId, err })
        },
      )
      catalogUnsubs.push(unsub)
    }

    catalogListenerTenant = tenantId
    catalogListenerStoreKey = storeKey
    log.info('[catalogSync] Listener de catálogo iniciado', { tenantId, storeIds })
  } catch (err) {
    stopCatalogSyncListener()
    log.error('[catalogSync] No se pudo iniciar el listener de catálogo', err)
  }
}

export function stopCatalogSyncListener(): void {
  for (const unsub of catalogUnsubs) {
    try {
      unsub()
    } catch (err) {
      log.warn('[catalogSync] Error al detener listener de catálogo', err)
    }
  }
  catalogUnsubs.length = 0
  catalogListenerTenant = null
  catalogListenerStoreKey = ''
  log.info('[catalogSync] Listener de catálogo detenido')
}

/** Sync one-shot existente + arranque del listener. */
export async function ensureCatalogSynced(tenantId: string, storeId?: string): Promise<void> {
  if (storeId) await syncCatalogWithFirestore(tenantId, storeId)
  else await syncAllStoreCatalogs(tenantId)
  startCatalogSyncListener(tenantId)
}
