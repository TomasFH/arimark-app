/**
 * Servicio de sincronización de turnos con Firestore.
 *
 * Estructura Firestore:
 *   licenses/{tenantId}/shifts/{shiftId}
 *
 * Responsabilidades:
 *   1. pushUnsyncedShifts — envía filas locales con syncedAt=null a Firestore
 *                           y marca syncedAt tras cada push exitoso.
 *
 * Al abrir un turno: syncedAt queda null → se pushea.
 * Al cerrar un turno: el handler debe setear syncedAt=null de nuevo → re-push
 * con closedAt / closingCash / etc.
 *
 * No-op completo cuando isFirebaseAvailable() === false (entorno dev).
 */

import { getFirestore, doc, setDoc } from 'firebase/firestore'
import log from 'electron-log'
import { eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { shifts } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

/**
 * Busca shifts locales con syncedAt=null y los sube a Firestore.
 * Marca syncedAt en SQLite tras cada push exitoso.
 */
export async function pushUnsyncedShifts(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(shifts).where(isNull(shifts.syncedAt)).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const s of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'shifts', s.id)
      await setDoc(ref, {
        id: s.id,
        storeId: s.storeId,
        userId: s.userId,
        shiftType: s.shiftType,
        startedAt: s.startedAt,
        closedAt: s.closedAt ?? null,
        openingCash: s.openingCash,
        closingCash: s.closingCash ?? null,
        safeAmount: s.safeAmount ?? null,
        deliveredAmount: s.deliveredAmount ?? null,
        deliveredTo: s.deliveredTo ?? null,
        notes: s.notes ?? null,
        source: s.source,
      }, { merge: true })

      db.update(shifts)
        .set({ syncedAt: now })
        .where(eq(shifts.id, s.id))
        .run()
    } catch (err) {
      log.error('[shiftSync] Error al pushear shift', { id: s.id, err })
    }
  }

  log.info('[shiftSync] Shifts pusheados', { count: pending.length })
}
