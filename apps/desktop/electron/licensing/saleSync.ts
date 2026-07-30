/**
 * Servicio de sincronización de ventas con Firestore.
 *
 * Estructura Firestore:
 *   licenses/{tenantId}/sales/{saleId}
 *
 * El documento incluye items y payments embebidos (arrays) para minimizar lecturas
 * cuando el admin audita desde otro dispositivo.
 *
 * Solo pushea ventas con syncedAt=null y status='confirmed'.
 * No-op completo cuando isFirebaseAvailable() === false (entorno dev).
 */

import { getFirestore, doc, setDoc } from 'firebase/firestore'
import log from 'electron-log'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { sales, saleItems, salePayments, products } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

/**
 * Busca ventas locales confirmadas con syncedAt=null, construye el documento
 * completo (sale + items + payments) y lo sube a Firestore.
 * Marca syncedAt en la tabla `sales` tras cada push exitoso.
 */
export async function pushUnsyncedSales(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db
    .select()
    .from(sales)
    .where(and(isNull(sales.syncedAt), eq(sales.status, 'confirmed')))
    .all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const sale of pending) {
    try {
      const itemRows = db
        .select({
          id: saleItems.id,
          productId: saleItems.productId,
          productName: products.name,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          subtotal: saleItems.subtotal,
          notes: saleItems.notes,
        })
        .from(saleItems)
        .leftJoin(products, eq(saleItems.productId, products.id))
        .where(eq(saleItems.saleId, sale.id))
        .all()

      const paymentRows = db
        .select({
          id: salePayments.id,
          paymentMethod: salePayments.paymentMethod,
          amount: salePayments.amount,
          installments: salePayments.installments,
          createdAt: salePayments.createdAt,
          createdBy: salePayments.createdBy,
        })
        .from(salePayments)
        .where(eq(salePayments.saleId, sale.id))
        .all()

      const ref = doc(firestore, 'licenses', tenantId, 'sales', sale.id)
      await setDoc(ref, {
        id: sale.id,
        storeId: sale.storeId,
        shiftId: sale.shiftId,
        customerId: sale.customerId ?? null,
        total: sale.total,
        isDebt: sale.isDebt,
        status: sale.status,
        manualEntry: sale.manualEntry,
        manualApprovedBy: sale.manualApprovedBy ?? null,
        manualApprovedAt: sale.manualApprovedAt ?? null,
        notes: sale.notes ?? null,
        createdAt: sale.createdAt,
        createdBy: sale.createdBy,
        items: itemRows.map(i => ({
          id: i.id,
          productId: i.productId,
          productName: i.productName ?? null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          subtotal: i.subtotal,
          notes: i.notes ?? null,
        })),
        payments: paymentRows.map(p => ({
          id: p.id,
          paymentMethod: p.paymentMethod,
          amount: p.amount,
          installments: p.installments ?? null,
          createdAt: p.createdAt,
          createdBy: p.createdBy,
        })),
      }, { merge: true })

      db.update(sales)
        .set({ syncedAt: now })
        .where(eq(sales.id, sale.id))
        .run()
    } catch (err) {
      log.error('[saleSync] Error al pushear sale', { id: sale.id, err })
    }
  }

  log.info('[saleSync] Sales pusheadas', { count: pending.length })
}
