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
import { isNull, eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { stores } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

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
}

function upsertStoreFromRemote(data: RemoteStoreDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId

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
        syncedAt: now,
      },
    })
    .run()
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
        upsertStoreFromRemote(data, d.id)
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
          upsertStoreFromRemote(data, change.doc.id)
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
