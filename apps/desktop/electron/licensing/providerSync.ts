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
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import { isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { providers, providerDebtEvents } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

const listeners: Unsubscribe[] = []

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
      }, { merge: true })

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

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)

    const col = collection(firestore, 'licenses', licenseKey, 'providers')

    const unsub = onSnapshot(col, snapshot => {
      const db = getDb()
      const now = new Date().toISOString()

      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue

        const data = change.doc.data() as {
          id: string
          name: string
          nameKey: string
          phone?: string | null
          notes?: string | null
          archivedAt?: string | null
          createdAt: string
          createdBy?: string | null
          updatedAt?: string | null
          updatedBy?: string | null
        }

        try {
          db.insert(providers).values({
            id: data.id,
            name: data.name,
            nameKey: data.nameKey,
            phone: data.phone ?? null,
            notes: data.notes ?? null,
            archivedAt: data.archivedAt ?? null,
            createdAt: data.createdAt,
            // Nullificar referencias a usuarios que pueden no existir en esta PC
            // (PC de casa, perfil remote, etc.) — la columna es nullable en schema.
            createdBy: null,
            updatedAt: data.updatedAt ?? null,
            updatedBy: null,
            syncedAt: now, // ya vino de Firestore, no necesita re-push
          })
          .onConflictDoUpdate({
            target: providers.id,
            set: {
              name: data.name,
              phone: data.phone ?? null,
              notes: data.notes ?? null,
              archivedAt: data.archivedAt ?? null,
              updatedAt: data.updatedAt ?? null,
              // updatedBy queda null para no imponer FK a usuarios ausentes
              updatedBy: null,
              syncedAt: now,
            },
          })
          .run()
        } catch (err) {
          log.error('[providerSync] Error al upsertear provider desde snapshot', { id: data.id, err })
        }
      }
    }, err => {
      log.error('[providerSync] Error en listener de providers', err)
    })

    listeners.push(unsub)
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


export function stopProviderSyncListener(): void {
  listeners.forEach(u => u())
  listeners.length = 0
  log.info('[providerSync] Listeners detenidos')
}
