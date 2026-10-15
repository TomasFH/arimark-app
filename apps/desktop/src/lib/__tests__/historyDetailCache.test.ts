import { describe, expect, it, beforeEach } from 'vitest'
import type { HistoryShiftDetail } from '../../types/hw-api'
import {
  clearHistoryDetailCache,
  getCachedHistoryDetail,
  rememberHistoryDetail,
} from '../historyDetailCache'

function detail(id: string, closedAt: string | null): HistoryShiftDetail {
  return {
    shift: {
      id,
      shiftType: 'evening',
      startedAt: '2026-10-08T18:00:00.000Z',
      closedAt,
      cashierName: 'Cajera',
      openingCash: 0,
      closingCash: closedAt ? 1000 : null,
      deliveredAmount: null,
      deliveredTo: null,
      notes: null,
    },
    sales: [],
    expenses: [],
    debts: [],
    deposits: [],
    vales: [],
    summary: {
      salesCount: 0,
      totalRevenue: 0,
      totalCashSales: 0,
      totalDebitSales: 0,
      totalWalletSales: 0,
      totalCreditSales: 0,
      totalExpenses: 0,
      totalCashInjects: 0,
      cashDeposits: 0,
      digitalDeposits: 0,
      cashInHand: 0,
      debtsCount: 0,
      totalDebts: 0,
    },
  }
}

describe('historyDetailCache', () => {
  beforeEach(() => {
    clearHistoryDetailCache()
  })

  it('recuerda un turno cerrado y lo devuelve sin volver a pedirlo', () => {
    const closed = detail('turno-8', '2026-10-08T23:00:00.000Z')
    rememberHistoryDetail(closed)
    expect(getCachedHistoryDetail('turno-8')).toBe(closed)
  })

  it('no guarda un turno que sigue abierto', () => {
    rememberHistoryDetail(detail('turno-hoy', null))
    expect(getCachedHistoryDetail('turno-hoy')).toBeNull()
  })
})
