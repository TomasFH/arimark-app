/**
 * Servicio de sincronización de gastos con Firestore.
 *
 * Estructura Firestore:
 *   licenses/{tenantId}/expenses/{expenseId}
 *
 * Responsabilidades:
 *   1. pushUnsyncedExpenses — envía filas con syncedAt=null y marca syncedAt
 *   2. markExpensesDeletedInFirestore — soft-delete (deleted:true) al borrar/editar
 *
 * No-op completo cuando isFirebaseAvailable() === false (entorno dev).
 */

import { getFirestore, doc, setDoc, updateDoc } from 'firebase/firestore'
import log from 'electron-log'
import { eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { expenses, providers } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

/**
 * Busca gastos locales con syncedAt=null y los sube a Firestore.
 * Marca syncedAt en SQLite tras cada push exitoso.
 */
export async function pushUnsyncedExpenses(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(expenses).where(isNull(expenses.syncedAt)).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const e of pending) {
    try {
      let providerName: string | null = null
      if (e.providerId) {
        const prov = db.select({ name: providers.name })
          .from(providers)
          .where(eq(providers.id, e.providerId))
          .get()
        providerName = prov?.name ?? null
      }

      const ref = doc(firestore, 'licenses', tenantId, 'expenses', e.id)
      await setDoc(ref, {
        id: e.id,
        storeId: e.storeId,
        shiftId: e.shiftId,
        concept: e.concept ?? null,
        providerId: e.providerId ?? null,
        providerName,
        amount: e.amount,
        notes: e.notes ?? null,
        createdAt: e.createdAt,
        createdBy: e.createdBy,
        deleted: false,
        kind: e.kind ?? 'expense',
      }, { merge: true })

      db.update(expenses)
        .set({ syncedAt: now })
        .where(eq(expenses.id, e.id))
        .run()
    } catch (err) {
      log.error('[expenseSync] Error al pushear expense', { id: e.id, err })
    }
  }

  log.info('[expenseSync] Expenses pusheados', { count: pending.length })
}

/**
 * Soft-delete de gastos ya sincronizados en Firestore.
 * Se usa al eliminar un gasto local (SQLite hard-delete + flag remoto).
 */
export async function markExpensesDeletedInFirestore(
  tenantId: string,
  expenseIds: string[],
): Promise<void> {
  if (!isFirebaseAvailable() || expenseIds.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const id of expenseIds) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'expenses', id)
      await updateDoc(ref, { deleted: true, deletedAt: now })
      log.info('[expenseSync] Gasto marcado como eliminado en Firestore', { id })
    } catch (err) {
      log.error('[expenseSync] No se pudo marcar gasto como eliminado', { id, err })
    }
  }
}
