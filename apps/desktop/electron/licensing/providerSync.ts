/**
 * Servicio de sincronización de proveedores con Firestore.
 *
 * Estructura Firestore:
 *   licenses/{licenseKey}/providers/{providerId}
 *   licenses/{licenseKey}/providerDebtEvents/{eventId}
 *
 * Responsabilidades:
 *   1. pushUnsyncedProviders     — envía filas locales con syncedAt=null a Firestore
 *   2. pushUnsyncedDebtEvents    — ídem para eventos de deuda
 *   3. startProviderSyncListener — onSnapshot en providers → upsert al cache local
 *   4. stopProviderSyncListener  — cancela los listeners activos
 *
 * No-op completo cuando isFirebaseAvailable() === false (entorno dev).
 */

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  getDocs,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import { isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { providers, providerDebtEvents, stores, shifts, expenses, users } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { ensureUserStub } from './syncUserStub'
import { providerNameKey } from '../ipc/providerUtils'
import { debtEventServerTimestampFields } from './debtCheckpoint'
import { touchDebtCheckpointTail } from './debtCheckpointTail'

const listeners: Unsubscribe[] = []

const REMOTE_PROVIDER_UNKNOWN_USER = 'remote-provider-unknown'

function upsertProviderFromRemote(data: {
  id?: string
  name?: string
  nameKey?: string
  phone?: string | null
  notes?: string | null
  archivedAt?: string | null
  createdAt?: string
  createdBy?: string | null
  updatedAt?: string | null
  updatedBy?: string | null
}, docId: string): void {
  if (!data.name) {
    log.warn('[providerSync] Provider remoto sin nombre — omitido', { id: docId })
    return
  }

  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId
  const nameKey = data.nameKey || providerNameKey(data.name)
  const createdAt = data.createdAt || now

  db.insert(providers).values({
    id,
    name: data.name,
    nameKey,
    phone: data.phone ?? null,
    notes: data.notes ?? null,
    archivedAt: data.archivedAt ?? null,
    createdAt,
    createdBy: null,
    updatedAt: data.updatedAt ?? null,
    updatedBy: null,
    syncedAt: now,
  })
    .onConflictDoUpdate({
      target: providers.id,
      set: {
        name: data.name,
        phone: data.phone ?? null,
        notes: data.notes ?? null,
        archivedAt: data.archivedAt ?? null,
        updatedAt: data.updatedAt ?? null,
        updatedBy: null,
        syncedAt: now,
      },
    })
    .run()
}

export function applyRemoteProviderDebtEvent(data: {
  id?: string
  storeId?: string
  providerId?: string | null
  provider?: string
  type?: 'debt' | 'payment'
  amount?: number
  expenseId?: string | null
  shiftId?: string | null
  createdAt?: string
  date?: string
  createdBy?: string
  deleted?: boolean
  description?: string | null
  notes?: string | null
}, docId: string): void {
  if (data.deleted === true) {
    const id = data.id || docId
    getDb().delete(providerDebtEvents).where(eq(providerDebtEvents.id, id)).run()
    return
  }
  const providerId = data.providerId ?? null
  const storeId = data.storeId
  const type = data.type
  const amount = data.amount
  if (!providerId || !storeId || (type !== 'debt' && type !== 'payment') || typeof amount !== 'number') {
    log.warn('[providerSync] Evento de deuda incompleto — omitido', { id: docId })
    return
  }

  const db = getDb()
  const store = db.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).get()
  if (!store) {
    log.warn('[providerSync] Evento con local inexistente — omitido', { id: docId, storeId })
    return
  }
  let parent = db.select({ id: providers.id, name: providers.name }).from(providers).where(eq(providers.id, providerId)).get()
  if (!parent) {
    if (!data.provider) {
      log.warn('[providerSync] Evento sin proveedor local — omitido', { id: docId, providerId })
      return
    }
    upsertProviderFromRemote({ id: providerId, name: data.provider }, providerId)
    parent = { id: providerId, name: data.provider }
  }

  const now = new Date().toISOString()
  const id = data.id || docId
  const createdBy = data.createdBy || REMOTE_PROVIDER_UNKNOWN_USER
  ensureUserStub(createdBy, storeId)
  const createdAt = data.createdAt || data.date || now

  let shiftId: string | null = data.shiftId ?? null
  if (shiftId) {
    const shift = db.select({ id: shifts.id }).from(shifts).where(eq(shifts.id, shiftId)).get()
    if (!shift) shiftId = null
  }
  let expenseId: string | null = data.expenseId ?? null
  if (expenseId) {
    const exp = db.select({ id: expenses.id }).from(expenses).where(eq(expenses.id, expenseId)).get()
    if (!exp) expenseId = null
  }

  const notes = data.notes ?? data.description ?? null

  db.insert(providerDebtEvents).values({
    id,
    storeId,
    providerId,
    provider: data.provider || parent.name,
    type,
    amount: Math.abs(amount),
    expenseId,
    shiftId,
    createdAt,
    createdBy,
    notes,
    syncedAt: now,
  })
    .onConflictDoUpdate({
      target: providerDebtEvents.id,
      set: {
        type,
        amount: Math.abs(amount),
        provider: data.provider || parent.name,
        notes,
        syncedAt: now,
      },
    })
    .run()
}

// ---------------------------------------------------------------------------
// Push: providers
// ---------------------------------------------------------------------------

/**
 * Busca providers locales con syncedAt=null y los sube a Firestore.
 * Marca syncedAt en SQLite tras cada push exitoso.
 */
export async function pushUnsyncedProviders(licenseKey: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(providers).where(isNull(providers.syncedAt)).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const p of pending) {
    try {
      const ref = doc(firestore, 'licenses', licenseKey, 'providers', p.id)
      await setDoc(ref, {
        id: p.id,
        name: p.name,
        nameKey: p.nameKey,
        phone: p.phone ?? null,
        notes: p.notes ?? null,
        archivedAt: p.archivedAt ?? null,
        createdAt: p.createdAt,
        createdBy: p.createdBy ?? null,
        updatedAt: p.updatedAt ?? null,
        updatedBy: p.updatedBy ?? null,
      }, { merge: true })

      db.update(providers)
        .set({ syncedAt: now })
        .where(eq(providers.id, p.id))
        .run()
    } catch (err) {
      log.error('[providerSync] Error al pushear provider', { id: p.id, err })
    }
  }

  log.info('[providerSync] Providers pusheados', { count: pending.length })
}

// ---------------------------------------------------------------------------
// Push: provider debt events
// ---------------------------------------------------------------------------

/**
 * Busca eventos de deuda locales con syncedAt=null y los sube a Firestore.
 */
export async function pushUnsyncedDebtEvents(licenseKey: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(providerDebtEvents).where(isNull(providerDebtEvents.syncedAt)).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()
  const userRows = db.select({ id: users.id, name: users.name }).from(users).all()
  const userNameMap = new Map(userRows.map(u => [u.id, u.name]))

  for (const evt of pending) {
    try {
      const ref = doc(firestore, 'licenses', licenseKey, 'providerDebtEvents', evt.id)
      await setDoc(ref, {
        id: evt.id,
        storeId: evt.storeId,
        providerId: evt.providerId ?? null,
        provider: evt.provider,
        type: evt.type,
        amount: evt.amount,
        expenseId: evt.expenseId ?? null,
        shiftId: evt.shiftId,
        createdAt: evt.createdAt,
        createdBy: evt.createdBy,
        createdByName: userNameMap.get(evt.createdBy) ?? evt.createdBy,
        description: evt.notes ?? null,
        notes: evt.notes ?? null,
        ...debtEventServerTimestampFields(),
      }, { merge: true })

      if (evt.providerId) {
        await touchDebtCheckpointTail({
          tenantId: licenseKey,
          kind: 'provider',
          entityId: evt.providerId,
          storeId: evt.storeId,
        })
      }

      db.update(providerDebtEvents)
        .set({ syncedAt: now })
        .where(eq(providerDebtEvents.id, evt.id))
        .run()
    } catch (err) {
      log.error('[providerSync] Error al pushear debt event', { id: evt.id, err })
    }
  }

  log.info('[providerSync] Debt events pusheados', { count: pending.length })
}

// ---------------------------------------------------------------------------
// Listener: providers → cache local
// ---------------------------------------------------------------------------

/**
 * Inicia un listener onSnapshot sobre la colección providers.
 * Cada cambio remoto se upsertea en la cache local para mantener
 * el autocomplete global actualizado en todas las PCs.
 */
export function startProviderSyncListener(licenseKey: string): void {
  if (!isFirebaseAvailable()) {
    log.info('[providerSync] Firebase no disponible (dev) — listener omitido')
    return
  }

  if (listeners.length > 0) {
    log.info('[providerSync] Listeners ya activos — omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)

    const providersCol = collection(firestore, 'licenses', licenseKey, 'providers')
    const unsubProviders = onSnapshot(providersCol, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          upsertProviderFromRemote(change.doc.data() as {
            id?: string
            name?: string
            nameKey?: string
            phone?: string | null
            notes?: string | null
            archivedAt?: string | null
            createdAt?: string
            createdBy?: string | null
            updatedAt?: string | null
            updatedBy?: string | null
          }, change.doc.id)
        } catch (err) {
          log.error('[providerSync] Error al upsertear provider desde snapshot', { id: change.doc.id, err })
        }
      }
    }, err => {
      log.error('[providerSync] Error en listener de providers', err)
    })

    listeners.push(unsubProviders)
    log.info('[providerSync] Listener de providers iniciado')
  } catch (err) {
    log.error('[providerSync] No se pudo iniciar el listener', err)
  }
}

/** Detiene todos los listeners activos de providerSync. */
/**
 * Marca eventos de deuda ya sincronizados como eliminados en Firestore.
 *
 * Se llama cuando una cajera elimina o edita un gasto durante el turno activo.
 * En lugar de borrar los documentos (no permitido por las reglas del ledger),
 * se setea `deleted: true` vía updateDoc. El handler de consulta filtra estos
 * documentos al calcular el balance de deuda del proveedor.
 *
 * No-op si Firebase no está disponible o la lista de IDs es vacía.
 */
export async function markDebtEventsDeletedInFirestore(
  licenseKey: string,
  eventIds: string[],
): Promise<void> {
  if (!isFirebaseAvailable() || eventIds.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const id of eventIds) {
    try {
      const ref = doc(firestore, 'licenses', licenseKey, 'providerDebtEvents', id)
      await updateDoc(ref, { deleted: true, deletedAt: now })
      log.info('[providerSync] Evento de deuda marcado como eliminado en Firestore', { id })
    } catch (err) {
      // No bloqueante: si falla, el balance puede quedar desincronizado temporalmente.
      // Se corregirá en el próximo push o recarga. Se registra el error explícitamente.
      log.error('[providerSync] No se pudo marcar evento como eliminado en Firestore', { id, err })
    }
  }
}


/**
 * Restaura eventos de deuda marcados deleted en Firestore (p. ej. un purge viejo).
 * El listener los vuelve a upsertar en SQLite.
 */
export async function restoreProviderLedgerInFirestore(
  licenseKey: string,
  providerId: string,
): Promise<void> {
  if (!isFirebaseAvailable()) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const eventsCol = collection(firestore, 'licenses', licenseKey, 'providerDebtEvents')
  const q = query(eventsCol, where('providerId', '==', providerId))
  const snap = await getDocs(q)

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as { deleted?: boolean }
    if (data.deleted !== true) continue
    try {
      await updateDoc(docSnap.ref, { deleted: false, deletedAt: null })
      log.info('[providerSync] Evento de deuda restaurado en Firestore', { id: docSnap.id })
    } catch (err) {
      log.error('[providerSync] No se pudo restaurar evento en Firestore', { id: docSnap.id, err })
    }
  }
}

export function stopProviderSyncListener(): void {
  listeners.forEach(u => u())
  listeners.length = 0
  log.info('[providerSync] Listeners detenidos')
}
