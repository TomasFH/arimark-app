/**
 * Plata del turno, calculada desde SQLite.
 *
 * La escribe la PC que tiene las ventas (abrió el turno acá, o tiene
 * ventas, gastos, señas o fiados de ese turno). Una ficha bajada de
 * Firestore sin esos movimientos no se calcula: un cero inventado
 * quedaría corto para siempre.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from './client'
import { debtEvents, expenses, orders, sales, salePayments } from './schema'
import { addDepositToTotals, emptyDepositTotals } from '../lib/depositPayments'

type AppDb = ReturnType<typeof getDb>

export interface ShiftMoneySnapshot {
  soldTotal: number
  cashTotal: number
  cardWalletTotal: number
  debtTotal: number
  expenseTotal: number
  contributionTotal: number
  walletCashTotal: number
  moneySnapshottedAt: string
}

const CARD_METHODS = new Set(['debit', 'wallet', 'credit'])

function isWalletCash(row: { injectReason: string | null; concept: string | null }): boolean {
  return row.injectReason === 'wallet_cash' || row.concept === 'Efectivo por digital'
}

function hasLocalLedger(db: AppDb, shiftId: string): boolean {
  const sale = db.select({ id: sales.id }).from(sales).where(eq(sales.shiftId, shiftId)).limit(1).get()
  if (sale) return true
  const expense = db.select({ id: expenses.id }).from(expenses).where(eq(expenses.shiftId, shiftId)).limit(1).get()
  if (expense) return true
  const order = db.select({ id: orders.id }).from(orders).where(eq(orders.depositShiftId, shiftId)).limit(1).get()
  if (order) return true
  const debt = db.select({ id: debtEvents.id }).from(debtEvents).where(eq(debtEvents.shiftId, shiftId)).limit(1).get()
  return Boolean(debt)
}

/** true si esta base es la que operó el turno, no una copia vacía. */
export function shouldSnapshotShiftMoney(
  db: AppDb,
  shift: { id: string; openedLocally: boolean },
): boolean {
  if (shift.openedLocally) return true
  return hasLocalLedger(db, shift.id)
}

/**
 * Vendió: ventas confirmadas (el fiado cuenta el día que se vendió).
 * Efectivo: cobros, señas y cobranzas de fiado en efectivo. Sin apertura ni aportes.
 * Tarjeta y billetera: débito, crédito y billetera (ventas, señas y cobranzas).
 * Se fió: eventos `created` de las ventas del turno.
 * Gastos: salidas. Aportes: ingresos de los dueños.
 * Efectivo por digital queda aparte: no es venta, ni gasto, ni aporte.
 */
export function computeShiftMoney(db: AppDb, shiftId: string): Omit<ShiftMoneySnapshot, 'moneySnapshottedAt'> {
  const confirmed = db
    .select({ total: sales.total })
    .from(sales)
    .where(and(eq(sales.shiftId, shiftId), eq(sales.status, 'confirmed')))
    .all()
  const soldTotal = confirmed.reduce((acc, row) => acc + Number(row.total ?? 0), 0)

  const paymentRows = db
    .select({ method: salePayments.paymentMethod, amount: salePayments.amount })
    .from(salePayments)
    .innerJoin(sales, eq(salePayments.saleId, sales.id))
    .where(and(eq(sales.shiftId, shiftId), eq(sales.status, 'confirmed')))
    .all()

  let cashSales = 0
  let cardSales = 0
  for (const row of paymentRows) {
    const amount = Number(row.amount ?? 0)
    if (row.method === 'cash') cashSales += amount
    else if (CARD_METHODS.has(row.method)) cardSales += amount
  }

  const depositOrders = db
    .select({
      depositAmount: orders.depositAmount,
      depositMethod: orders.depositMethod,
      depositPayments: orders.depositPayments,
    })
    .from(orders)
    .where(eq(orders.depositShiftId, shiftId))
    .all()

  const depositTotals = emptyDepositTotals()
  for (const row of depositOrders) {
    if (row.depositAmount <= 0 && !row.depositPayments) continue
    addDepositToTotals(row, depositTotals)
  }
  const cardDeposits = depositTotals.debit + depositTotals.wallet + depositTotals.credit

  const debtPaymentRows = db
    .select({ amount: debtEvents.amount, paymentMethod: debtEvents.paymentMethod })
    .from(debtEvents)
    .where(eq(debtEvents.shiftId, shiftId))
    .all()

  let cashDebt = 0
  let cardDebt = 0
  for (const row of debtPaymentRows) {
    if (row.paymentMethod == null) continue
    const amount = Math.abs(Number(row.amount ?? 0))
    if (row.paymentMethod === 'cash') cashDebt += amount
    else if (CARD_METHODS.has(row.paymentMethod)) cardDebt += amount
  }

  const createdDebts = db
    .select({ amount: debtEvents.amount })
    .from(debtEvents)
    .innerJoin(sales, eq(debtEvents.saleId, sales.id))
    .where(and(eq(sales.shiftId, shiftId), eq(debtEvents.eventType, 'created')))
    .all()
  const debtTotal = createdDebts.reduce((acc, row) => acc + Number(row.amount ?? 0), 0)

  const expenseRows = db
    .select({
      amount: expenses.amount,
      kind: expenses.kind,
      injectReason: expenses.injectReason,
      concept: expenses.concept,
    })
    .from(expenses)
    .where(eq(expenses.shiftId, shiftId))
    .all()

  let expenseTotal = 0
  let contributionTotal = 0
  let walletCashTotal = 0
  for (const row of expenseRows) {
    const amount = Number(row.amount ?? 0)
    if (row.kind === 'inject') {
      if (isWalletCash(row)) walletCashTotal += amount
      else contributionTotal += amount
    } else {
      expenseTotal += amount
    }
  }

  return {
    soldTotal,
    cashTotal: cashSales + depositTotals.cash + cashDebt,
    cardWalletTotal: cardSales + cardDeposits + cardDebt,
    debtTotal,
    expenseTotal,
    contributionTotal,
    walletCashTotal,
  }
}

/** Null si esta base no tiene los movimientos del turno. */
export function snapshotShiftMoney(
  db: AppDb,
  shift: { id: string; openedLocally: boolean },
  at: string,
): ShiftMoneySnapshot | null {
  if (!shouldSnapshotShiftMoney(db, shift)) return null
  return { ...computeShiftMoney(db, shift.id), moneySnapshottedAt: at }
}
