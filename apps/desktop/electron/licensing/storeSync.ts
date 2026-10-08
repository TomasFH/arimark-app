/**
 * Sincronización de locales (stores) con Firestore.
 *
 * Estructura Firestore:
 *   licenses/{tenantId}/stores/{storeId}
 *
 * Responsabilidades:
 *   1. pullStoresFromFirestore  — getDocs una vez; la baja remota pisa un placeholder local
 *   2. pushUnsyncedStores     — envía filas locales pendientes (no el placeholder de arranque)
 *   3. startStoreSyncListener — onSnapshot → upsert SQLite (cambios en vivo)
 *   4. stopStoreSyncListener  — cancela los listeners activos
 *
 * No-op completo cuando isFirebaseAvailable() === false (entorno dev).
 */

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import { isNull, eq, desc, or } from 'drizzle-orm'
import { getDb } from '../db/client'
import { cashDiscountAudits, stores } from '../db/schema'
import { ensureCatalogSeedUser, seedCatalogOntoStore } from '../db/seedStoreCatalog'
import { publishCatalog } from './catalogPublish'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { STORE_SYNC_BOOTSTRAP, STORE_SYNC_UNARCHIVE } from './storeSyncMarkers'
import { normalizeCashDiscountRule, parseCashDiscountSchedule, parseHoursSchedule, serializeCashDiscountSchedule, serializeHoursSchedule } from '@carniceria/shared'
import { v4 as uuidv4 } from 'uuid'

const listeners: Unsubscribe[] = []

interface RemoteStoreDoc {
  id: string
  name: string
  address?: string | null
  createdAt: string
  archivedAt?: string | null
  /** ISO de una restauración explícita. Sin esto, un alta local no revive un local eliminado. */
  reactivatedAt?: string | null
  morningStart?: string | null
  morningEnd?: string | null
  afternoonStart?: string | null
  afternoonEnd?: string | null
  hoursSchedule?: unknown
  cashDiscountMinAmount?: number | null
  cashDiscountPercent?: number | null
  cashDiscountSchedule?: unknown
  cashDiscountAudits?: unknown
}

function hoursScheduleForSqlite(raw: unknown): string | null {
  return serializeHoursSchedule(parseHoursSchedule(raw) ?? [])
}

const CASH_DISCOUNT_AUDIT_PUSH_LIMIT = 20

interface RemoteCashDiscountAudit {
  id: string
  createdAt: string
  actorUserId: string
  actorName: string
  previousMinAmount: number
  previousPercent: number
  nextMinAmount: number
  nextPercent: number
}

function parseRemoteAudits(raw: unknown): RemoteCashDiscountAudit[] {
  if (!Array.isArray(raw)) return []
  const out: RemoteCashDiscountAudit[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.id !== 'string' || typeof rec.createdAt !== 'string') continue
    out.push({
      id: rec.id,
      createdAt: rec.createdAt,
      actorUserId: typeof rec.actorUserId === 'string' ? rec.actorUserId : '',
      actorName: typeof rec.actorName === 'string' ? rec.actorName : '',
      previousMinAmount: Number(rec.previousMinAmount) || 0,
      previousPercent: Number(rec.previousPercent) || 0,
      nextMinAmount: Number(rec.nextMinAmount) || 0,
      nextPercent: Number(rec.nextPercent) || 0,
    })
  }
  return out.slice(0, CASH_DISCOUNT_AUDIT_PUSH_LIMIT)
}

function mergeRemoteAudits(storeId: string, remote: RemoteCashDiscountAudit[]): void {
  if (remote.length === 0) return
  const db = getDb()
  for (const row of remote) {
    const existing = db.select({ id: cashDiscountAudits.id })
      .from(cashDiscountAudits)
      .where(eq(cashDiscountAudits.id, row.id))
      .get()
    if (existing) continue
    db.insert(cashDiscountAudits).values({
      id: row.id || uuidv4(),
      storeId,
      actorUserId: row.actorUserId || 'remote',
      actorName: row.actorName || 'remoto',
      createdAt: row.createdAt,
      previousMinAmount: row.previousMinAmount,
      previousPercent: row.previousPercent,
      nextMinAmount: row.nextMinAmount,
      nextPercent: row.nextPercent,
    }).run()
  }
}

function auditsForPush(storeId: string): RemoteCashDiscountAudit[] {
  const db = getDb()
  return db
    .select()
    .from(cashDiscountAudits)
    .where(eq(cashDiscountAudits.storeId, storeId))
    .orderBy(desc(cashDiscountAudits.createdAt))
    .limit(CASH_DISCOUNT_AUDIT_PUSH_LIMIT)
    .all()
    .map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      actorUserId: r.actorUserId,
      actorName: r.actorName,
      previousMinAmount: r.previousMinAmount,
      previousPercent: r.previousPercent,
      nextMinAmount: r.nextMinAmount,
      nextPercent: r.nextPercent,
    }))
}

/**
 * true si el local quedó archivado y hay que volver a empujar esa baja
 * (otro dispositivo había republicado el placeholder como activo).
 */
function upsertStoreFromRemote(data: RemoteStoreDoc, docId: string, tenantId: string): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId
  const hoursSchedule = hoursScheduleForSqlite(data.hoursSchedule)
  const discount = normalizeCashDiscountRule(data.cashDiscountMinAmount, data.cashDiscountPercent)
  const cashDiscountSchedule = serializeCashDiscountSchedule(parseCashDiscountSchedule(data.cashDiscountSchedule))
  const remoteArchived = data.archivedAt ?? null
  const reactivatedAt = typeof data.reactivatedAt === 'string' ? data.reactivatedAt : null

  const existing = db
    .select({ syncedAt: stores.syncedAt, archivedAt: stores.archivedAt })
    .from(stores)
    .where(eq(stores.id, id))
    .get()

  if (existing?.archivedAt && !remoteArchived) {
    const restoreWins = reactivatedAt != null && reactivatedAt > existing.archivedAt
    if (!restoreWins) {
      if (existing.syncedAt !== null && existing.syncedAt !== STORE_SYNC_UNARCHIVE) {
        db.update(stores).set({ syncedAt: null }).where(eq(stores.id, id)).run()
        return true
      }
      return false
    }
  } else if (existing && keepLocalStoreEdit(existing, remoteArchived)) {
    return false
  }
  const isNew = !existing

  db.insert(stores).values({
    id,
    name: data.name,
    address: data.address ?? null,
    createdAt: data.createdAt,
    archivedAt: data.archivedAt ?? null,
    morningStart: data.morningStart ?? null,
    morningEnd: data.morningEnd ?? null,
    afternoonStart: data.afternoonStart ?? null,
    afternoonEnd: data.afternoonEnd ?? null,
    hoursSchedule,
    cashDiscountMinAmount: discount.minAmount,
    cashDiscountPercent: discount.percent,
    cashDiscountSchedule,
    syncedAt: now,
  })
    .onConflictDoUpdate({
      target: stores.id,
      set: {
        name: data.name,
        address: data.address ?? null,
        archivedAt: data.archivedAt ?? null,
        morningStart: data.morningStart ?? null,
        morningEnd: data.morningEnd ?? null,
        afternoonStart: data.afternoonStart ?? null,
        afternoonEnd: data.afternoonEnd ?? null,
        hoursSchedule,
        cashDiscountMinAmount: discount.minAmount,
        cashDiscountPercent: discount.percent,
        cashDiscountSchedule,
        syncedAt: now,
      },
    })
    .run()

  mergeRemoteAudits(id, parseRemoteAudits(data.cashDiscountAudits))

  if (isNew) {
    const seedUserId = ensureCatalogSeedUser(now)
    const seeded = seedCatalogOntoStore({ storeId: id, createdByUserId: seedUserId, now })
    if (seeded > 0) {
      publishCatalog(tenantId, id, { archive: false }).catch(err =>
        log.warn('[storeSync] publishCatalog al alta remota falló (no bloqueante)', { id, err }),
      )
    }
  }
  return false
}

/**
 * Una edición local todavía no empujada no se pisa con un snapshot activo viejo.
 * Si el remoto está eliminado y el local sigue activo, gana la baja compartida:
 * el placeholder que cada PC crea al arrancar no es una restauración.
 */
function keepLocalStoreEdit(
  existing: { syncedAt: string | null; archivedAt: string | null },
  remoteArchived: string | null,
): boolean {
  if (existing.syncedAt === STORE_SYNC_UNARCHIVE) return true
  if (existing.syncedAt !== null) return false
  if (existing.archivedAt && !remoteArchived) return true
  if (!existing.archivedAt && !remoteArchived) return true
  if (!existing.archivedAt && remoteArchived) return false
  return true
}

// ---------------------------------------------------------------------------
// Push: stores locales → Firestore
// ---------------------------------------------------------------------------

/**
 * Envía locales con syncedAt=null a Firestore y marca syncedAt tras éxito.
 */
export async function pushUnsyncedStores(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(stores).where(
    or(isNull(stores.syncedAt), eq(stores.syncedAt, STORE_SYNC_UNARCHIVE)),
  ).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const s of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'stores', s.id)
      const payload: RemoteStoreDoc = {
        id: s.id,
        name: s.name,
        address: s.address ?? null,
        createdAt: s.createdAt,
        archivedAt: s.archivedAt ?? null,
        morningStart: s.morningStart ?? null,
        morningEnd: s.morningEnd ?? null,
        afternoonStart: s.afternoonStart ?? null,
        afternoonEnd: s.afternoonEnd ?? null,
        hoursSchedule: parseHoursSchedule(s.hoursSchedule) ?? null,
        cashDiscountMinAmount: s.cashDiscountMinAmount ?? 0,
        cashDiscountPercent: s.cashDiscountPercent ?? 0,
        cashDiscountSchedule: parseCashDiscountSchedule(s.cashDiscountSchedule),
        cashDiscountAudits: auditsForPush(s.id),
      }
      if (s.syncedAt === STORE_SYNC_UNARCHIVE) {
        payload.reactivatedAt = new Date().toISOString()
      }
      await setDoc(ref, payload, { merge: true })

      db.update(stores)
        .set({ syncedAt: now })
        .where(eq(stores.id, s.id))
        .run()
    } catch (err) {
      log.error('[storeSync] Error al pushear store', { id: s.id, err })
    }
  }

  log.info('[storeSync] Stores pusheados', { count: pending.length })
}

// ---------------------------------------------------------------------------
// Pull bloqueante: Firestore → cache local (antes del store picker)
// ---------------------------------------------------------------------------

/**
 * Trae todos los locales del tenant y los upsertea en SQLite.
 * Usar en login (await) para que getStores() vea nombres/datos actualizados.
 */
export async function pullStoresFromFirestore(tenantId: string): Promise<{ ok: boolean; ids: string[] }> {
  if (!isFirebaseAvailable()) return { ok: false, ids: [] }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'stores')
    const snap = await getDocs(col)
    const ids: string[] = []

    for (const d of snap.docs) {
      ids.push(d.id)
      try {
        const data = d.data() as RemoteStoreDoc
        if (!data.name || !data.createdAt) {
          log.warn('[storeSync] Documento store incompleto, omitido', { id: d.id })
          continue
        }
        upsertStoreFromRemote(data, d.id, tenantId)
      } catch (err) {
        log.error('[storeSync] Error al upsertear store en pull', { id: d.id, err })
      }
    }

    log.info('[storeSync] Stores bajados de Firestore', { count: snap.size })
    return { ok: true, ids }
  } catch (err) {
    log.error('[storeSync] Error en pullStoresFromFirestore', err)
    return { ok: false, ids: [] }
  }
}

/**
 * El placeholder de arranque solo se publica si Firestore todavía no tiene ese id.
 * Si el remoto ya lo conoce (aunque esté eliminado), el pull ya lo aplicó.
 */
function promoteBootstrapsMissingFromRemote(remoteIds: string[]): void {
  const known = new Set(remoteIds)
  const db = getDb()
  const bootstraps = db.select({ id: stores.id })
    .from(stores)
    .where(eq(stores.syncedAt, STORE_SYNC_BOOTSTRAP))
    .all()
  for (const row of bootstraps) {
    if (known.has(row.id)) continue
    db.update(stores).set({ syncedAt: null }).where(eq(stores.id, row.id)).run()
  }
}

/**
 * Pull primero, después push. Así un placeholder local no pisa una baja ya compartida.
 * Debe await-earse en login antes de que el renderer llame getStores().
 */
export async function ensureStoresSynced(tenantId: string): Promise<void> {
  const pulled = await pullStoresFromFirestore(tenantId)
  if (pulled.ok) promoteBootstrapsMissingFromRemote(pulled.ids)
  await pushUnsyncedStores(tenantId)
  startStoreSyncListener(tenantId)
}

// ---------------------------------------------------------------------------
// Listener: Firestore → cache local
// ---------------------------------------------------------------------------

/**
 * Inicia un onSnapshot sobre la colección stores del tenant.
 * Cada cambio remoto se upsertea en la cache local.
 */
export function startStoreSyncListener(tenantId: string): void {
  if (!isFirebaseAvailable()) {
    log.info('[storeSync] Firebase no disponible (dev) — listener omitido')
    return
  }

  // Evitar listeners duplicados si se llama más de una vez (login + select-store).
  if (listeners.length > 0) {
    log.info('[storeSync] Listener ya activo — omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'stores')

    const unsub = onSnapshot(col, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue

        try {
          const data = change.doc.data() as RemoteStoreDoc
          if (!data.name || !data.createdAt) continue
          if (upsertStoreFromRemote(data, change.doc.id, tenantId)) {
            void pushUnsyncedStores(tenantId)
          }
        } catch (err) {
          log.error('[storeSync] Error al upsertear store desde snapshot', {
            id: change.doc.id,
            err,
          })
        }
      }
    }, err => {
      log.error('[storeSync] Error en listener de stores', err)
    })

    listeners.push(unsub)
    log.info('[storeSync] Listener de stores iniciado')
  } catch (err) {
    log.error('[storeSync] No se pudo iniciar el listener', err)
  }
}

/** Detiene todos los listeners activos de storeSync. */
export function stopStoreSyncListener(): void {
  for (const unsub of listeners) {
    try {
      unsub()
    } catch (err) {
      log.warn('[storeSync] Error al detener listener', err)
    }
  }
  listeners.length = 0
  log.info('[storeSync] Listeners detenidos')
}
