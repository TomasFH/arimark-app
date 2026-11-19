/**
 * Parte de los gastos del turno que es plata a proveedores.
 *
 * Entra el gasto cuyo id está en un ingreso confirmado, entero.
 * Entra también el pago posterior: eventos `payment` de este turno
 * cuyo gasto no es un ingreso. De ese gasto se toma el monto de los
 * eventos, y nunca más de lo que salió de la caja.
 * Un aporte no entra. Un pago del libro sin gasto (saldar, compensar) no entra.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from './client'
import { expenses, merchandiseIntakes, providerDebtEvents } from './schema'

type AppDb = ReturnType<typeof getDb>

export interface ProviderExpenseRow {
  id: string
  amount: number
  kind: string | null
}

export interface ProviderPaymentSlice {
  expenseId: string | null
  amount: number
}

export function sumProviderExpenseTotal(
  expenseRows: ProviderExpenseRow[],
  intakeExpenseIds: Iterable<string | null>,
  paymentSlices: ProviderPaymentSlice[],
): number {
  const linked = new Set<string>()
  for (const id of intakeExpenseIds) {
    if (id) linked.add(id)
  }
  const paidByExpense = new Map<string, number>()
  for (const slice of paymentSlices) {
    if (!slice.expenseId) continue
    const amount = Math.round(Number(slice.amount) || 0)
    if (amount <= 0) continue
    paidByExpense.set(slice.expenseId, (paidByExpense.get(slice.expenseId) ?? 0) + amount)
  }

  let total = 0
  for (const row of expenseRows) {
    if (row.kind === 'inject') continue
    const amount = Math.round(Number(row.amount) || 0)
    if (amount <= 0) continue
    if (linked.has(row.id)) {
      total += amount
      continue
    }
    const paid = paidByExpense.get(row.id) ?? 0
    if (paid > 0) total += Math.min(amount, paid)
  }
  return total
}

export function readProviderExpenseTotal(db: AppDb, shiftId: string): number {
  const expenseRows = db
    .select({ id: expenses.id, amount: expenses.amount, kind: expenses.kind })
    .from(expenses)
    .where(eq(expenses.shiftId, shiftId))
    .all()
  const intakes = db
    .select({ expenseId: merchandiseIntakes.expenseId })
    .from(merchandiseIntakes)
    .where(and(
      eq(merchandiseIntakes.shiftId, shiftId),
      eq(merchandiseIntakes.status, 'confirmed'),
    ))
    .all()
  const payments = db
    .select({
      expenseId: providerDebtEvents.expenseId,
      amount: providerDebtEvents.amount,
    })
    .from(providerDebtEvents)
    .where(and(
      eq(providerDebtEvents.shiftId, shiftId),
      eq(providerDebtEvents.type, 'payment'),
    ))
    .all()
  return sumProviderExpenseTotal(
    expenseRows,
    intakes.map(row => row.expenseId),
    payments,
  )
}
