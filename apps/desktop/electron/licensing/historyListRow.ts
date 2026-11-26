import type { HistoryShiftRow, ShiftType } from '../../src/types/hw-api'

/**
 * Datos que ya están en la ficha del turno.
 * La cantidad de ventas no se sella: soldHoursJson guarda montos por hora, no el conteo.
 */
export interface HistoryListFicha {
  id: string
  shiftType: ShiftType
  startedAt: string
  closedAt: string | null
  cashierName: string
  storeId?: string | null
  openingCash: number
  source?: string | null
  soldTotal: number | null
  cashTotal: number | null
  cardWalletTotal: number | null
  debtTotal: number | null
  expenseTotal: number | null
  contributionTotal: number | null
  walletCashTotal: number | null
  moneySnapshottedAt: string | null
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Fila de la lista. Solo números sellados.
 * Sin ficha (turno abierto, o cerrado antes de sellar) no inventa ceros:
 * las ventas se leen al abrir ese turno.
 */
export function historyListRowFromFicha(ficha: HistoryListFicha): HistoryShiftRow {
  const soldTotal = finite(ficha.soldTotal)
  const cashTotal = finite(ficha.cashTotal)
  const cardWalletTotal = finite(ficha.cardWalletTotal)
  const debtTotal = finite(ficha.debtTotal)
  const expenseTotal = finite(ficha.expenseTotal)
  const contributionTotal = finite(ficha.contributionTotal)
  const walletCashTotal = finite(ficha.walletCashTotal)
  const sealed = typeof ficha.moneySnapshottedAt === 'string'
    && ficha.moneySnapshottedAt.length > 0
    && soldTotal != null
    && cashTotal != null
    && cardWalletTotal != null
    && debtTotal != null
    && expenseTotal != null
    && contributionTotal != null
    && walletCashTotal != null

  const opening = Number.isFinite(ficha.openingCash) ? ficha.openingCash : 0
  return {
    id: ficha.id,
    shiftType: ficha.shiftType,
    startedAt: ficha.startedAt,
    closedAt: ficha.closedAt,
    cashierName: ficha.cashierName,
    storeId: ficha.storeId ?? null,
    salesCount: null,
    totalRevenue: sealed ? soldTotal : null,
    totalCashSales: null,
    totalExpenses: sealed ? expenseTotal : null,
    cashInHand: sealed
      ? opening + cashTotal + contributionTotal + walletCashTotal - expenseTotal
      : null,
    totalDeposits: null,
    source: ficha.source === 'mobile' ? 'mobile' : 'desktop',
    totalsSealed: sealed,
  }
}
