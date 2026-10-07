/**
 * Venta mínima confirmada para un cobro de sebo.
 * El importe cargado es el total: no aplica el descuento de efectivo del local,
 * porque la cajera anota la plata que entró.
 * No toca sale.handler: otro flujo puede estar editándolo en paralelo.
 */
import { v4 as uuidv4 } from 'uuid'
import { eq } from 'drizzle-orm'
import type { getDb } from '../db/client'
import { products, saleItems, salePayments, sales } from '../db/schema'

export const SEBO_PRODUCT_ID = '00000000-0000-4000-8000-0000000005eb'

export type SeboPaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

function ensureSeboProduct(tx: Tx, now: string): void {
  const existing = tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, SEBO_PRODUCT_ID))
    .get()
  if (existing) return
  tx.insert(products).values({
    id: SEBO_PRODUCT_ID,
    name: 'Sebo',
    category: 'other',
    unit: 'kg',
    pluNumber: null,
    active: false,
    createdAt: now,
  }).run()
}

export function insertConfirmedSeboSale(
  tx: Tx,
  input: {
    storeId: string
    shiftId: string
    userId: string
    quantityKg: number
    amount: number
    paymentMethod: SeboPaymentMethod
    now: string
  },
): string {
  ensureSeboProduct(tx, input.now)
  const saleId = uuidv4()
  tx.insert(sales).values({
    id: saleId,
    storeId: input.storeId,
    shiftId: input.shiftId,
    customerId: null,
    total: input.amount,
    isDebt: false,
    status: 'confirmed',
    manualEntry: false,
    manualApprovedBy: null,
    manualApprovedAt: null,
    notes: null,
    discountAmount: 0,
    discountPercent: 0,
    createdAt: input.now,
    createdBy: input.userId,
    syncedAt: null,
  }).run()

  tx.insert(saleItems).values({
    id: uuidv4(),
    saleId,
    productId: SEBO_PRODUCT_ID,
    quantity: input.quantityKg,
    unitPrice: input.amount / input.quantityKg,
    subtotal: input.amount,
    notes: null,
    syncedAt: null,
  }).run()

  tx.insert(salePayments).values({
    id: uuidv4(),
    saleId,
    paymentMethod: input.paymentMethod,
    amount: input.amount,
    installments: null,
    createdAt: input.now,
    createdBy: input.userId,
    syncedAt: null,
  }).run()

  return saleId
}

/** Alinea los kilos del ítem con la entrega. El importe cobrado no cambia. */
export function syncSeboSaleQuantity(tx: Tx, saleId: string, quantityKg: number): void {
  const sale = tx
    .select({ total: sales.total, status: sales.status })
    .from(sales)
    .where(eq(sales.id, saleId))
    .get()
  if (!sale || sale.status !== 'confirmed') return
  const payment = tx
    .select({ amount: salePayments.amount })
    .from(salePayments)
    .where(eq(salePayments.saleId, saleId))
    .get()
  const amount = payment?.amount ?? sale.total
  tx.update(saleItems).set({
    quantity: quantityKg,
    unitPrice: amount / quantityKg,
  }).where(eq(saleItems.saleId, saleId)).run()
}
