/**
 * Sincronización de locales (stores) con Firestore.
 *
 * Estructura Firestore:
 *   licenses/{tenantId}/stores/{storeId}
 *
 * Responsabilidades:
 *   1. pushUnsyncedStores     — envía filas locales con syncedAt=null a Firestore
 *   2. pullStoresFromFirestore  — getDocs una vez (bloqueante) para cache fresco
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
import { isNull, eq, desc } from 'drizzle-orm'
import { getDb } from '../db/client'
import { cashDiscountAudits, stores } from '../db/schema'
import { ensureCatalogSeedUser, seedCatalogOntoStore } from '../db/seedStoreCatalog'
import { publishCatalog } from './catalogPublish'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { normalizeCashDiscountRule, parseCashDiscountSchedule, parseHoursSchedule, serializeCashDiscountSchedule, serializeHoursSchedule } from '@carniceria/shared'
import { v4 as uuidv4 } from 'uuid'

const listeners: Unsubscribe[] = []

interface RemoteStoreDoc {
  id: string
  name: string
  address?: string | null
  createdAt: string
  archivedAt?: string | null
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

function upsertStoreFromRemote(data: RemoteStoreDoc, docId: string, tenantId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId
  const hoursSchedule = hoursScheduleForSqlite(data.hoursSchedule)
  const discount = normalizeCashDiscountRule(data.cashDiscountMinAmount, data.cashDiscountPercent)
  const cashDiscountSchedule = serializeCashDiscountSchedule(parseCashDiscountSchedule(data.cashDiscountSchedule))

  const existing = db
    .select({ syncedAt: stores.syncedAt })
    .from(stores)
    .where(eq(stores.id, id))
    .get()
  // Outbox local pendiente: no pisar con un snapshot viejo (ej. archivar y luego pull).
  if (existing && existing.syncedAt === null) return
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
  const pending = db.select().from(stores).where(isNull(stores.syncedAt)).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const s of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'stores', s.id)
      await setDoc(ref, {
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
      }, { merge: true })

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
export async function pullStoresFromFirestore(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'stores')
    const snap = await getDocs(col)

    for (const d of snap.docs) {
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
  } catch (err) {
    log.error('[storeSync] Error en pullStoresFromFirestore', err)
  }
}

/**
 * Push pendientes → pull fresco → listener en vivo.
 * Debe await-earse en login antes de que el renderer llame getStores().
 */
export async function ensureStoresSynced(tenantId: string): Promise<void> {
  await pushUnsyncedStores(tenantId)
  await pullStoresFromFirestore(tenantId)
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
          upsertStoreFromRemote(data, change.doc.id, tenantId)
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
