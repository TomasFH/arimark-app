import { describe, expect, it } from 'vitest'
import { historyListRowFromFicha, type HistoryListFicha } from '../historyListRow'

function ficha(partial: Partial<HistoryListFicha> = {}): HistoryListFicha {
  return {
    id: 'shift-1',
    shiftType: 'morning',
    startedAt: '2026-11-20T11:00:00.000Z',
    closedAt: '2026-11-20T16:00:00.000Z',
    cashierName: 'Ana',
    openingCash: 1000,
    source: 'desktop',
    soldTotal: null,
    cashTotal: null,
    cardWalletTotal: null,
    debtTotal: null,
    expenseTotal: null,
    contributionTotal: null,
    walletCashTotal: null,
    moneySnapshottedAt: null,
    ...partial,
  }
}

const sealedMoney = {
  soldTotal: 500_000,
  cashTotal: 400_000,
  cardWalletTotal: 80_000,
  debtTotal: 20_000,
  expenseTotal: 20_000,
  contributionTotal: 5_000,
  walletCashTotal: 0,
  moneySnapshottedAt: '2026-11-20T16:00:00.000Z',
}

describe('historyListRowFromFicha', () => {
  it('un turno sellado muestra el vendido y no inventa la cantidad de ventas', () => {
    const row = historyListRowFromFicha(ficha(sealedMoney))
    expect(historyListRowFromFicha(ficha({ ...sealedMoney, storeId: 'store-a' })).storeId).toBe('store-a')
    expect(row.totalsSealed).toBe(true)
    expect(row.totalRevenue).toBe(500_000)
    expect(row.totalExpenses).toBe(20_000)
    expect(row.salesCount).toBeNull()
    expect(row.cashInHand).toBe(1000 + 400_000 + 5_000 - 20_000)
  })

  it('un turno abierto no trae totales', () => {
    const row = historyListRowFromFicha(ficha({
      closedAt: null,
      openingCash: 2000,
    }))
    expect(row.totalsSealed).toBe(false)
    expect(row.totalRevenue).toBeNull()
    expect(row.totalExpenses).toBeNull()
    expect(row.cashInHand).toBeNull()
    expect(row.salesCount).toBeNull()
  })

  it('un cerrado sin sellar tampoco', () => {
    const row = historyListRowFromFicha(ficha({ soldTotal: 500_000 }))
    expect(row.totalsSealed).toBe(false)
    expect(row.totalRevenue).toBeNull()
  })
})
