import { describe, expect, it } from 'vitest'
import {
  PAYMENT_SPLIT_GAP_CAUSE,
  summaryPaymentBreakdown,
  tallyShiftMoney,
  type SummaryShiftCard,
} from '../summaryMoney'

function card(partial: Partial<SummaryShiftCard> & Pick<SummaryShiftCard, 'id'>): SummaryShiftCard {
  return {
    cashierName: 'Ana',
    shiftType: 'morning',
    startedAt: '2026-10-26T12:00:00.000Z',
    closedAt: '2026-10-26T20:00:00.000Z',
    openingCash: 0,
    cashLeft: null,
    withdrawn: null,
    soldTotal: null,
    cashTotal: null,
    cardWalletTotal: null,
    debtTotal: null,
    expenseTotal: null,
    contributionTotal: null,
    walletCashTotal: null,
    moneySnapshottedAt: null,
    live: false,
    ...partial,
  }
}

function withFicha(id: string, cardWalletTotal: number, cashTotal = 0): SummaryShiftCard {
  return card({
    id,
    soldTotal: cashTotal + cardWalletTotal,
    cashTotal,
    cardWalletTotal,
    debtTotal: 0,
    expenseTotal: 0,
    contributionTotal: 0,
    walletCashTotal: 0,
    moneySnapshottedAt: '2026-10-26T20:00:00.000Z',
  })
}

describe('tallyShiftMoney desglose', () => {
  it('separa una venta mixta, una seña digital y un cobro de fiado con billetera', () => {
    const money = tallyShiftMoney({
      sales: [
        {
          status: 'confirmed',
          total: 5000,
          payments: [
            { method: 'cash', amount: 2000 },
            { method: 'debit', amount: 3000 },
          ],
        },
        {
          status: 'cancelled',
          total: 9000,
          payments: [{ method: 'debit', amount: 9000 }],
        },
      ],
      deposits: [
        { method: 'wallet', amount: 500 },
        { method: 'credit', amount: 700 },
      ],
      debtEvents: [
        { eventType: 'partial_payment', amount: -400, paymentMethod: 'wallet' },
      ],
      movements: [
        { kind: 'inject', amount: 1000, injectReason: 'aporte', concept: 'Aporte' },
        { kind: 'inject', amount: 50, injectReason: 'wallet_cash', concept: 'Efectivo por digital' },
      ],
    })
    expect(money.cashTotal).toBe(2000)
    expect(money.cardWalletTotal).toBe(4600)
    expect(money.paymentSplit).toEqual({ debit: 3000, wallet: 900, credit: 700 })
    expect(money.contributionTotal).toBe(1000)
    expect(money.walletCashTotal).toBe(50)
    expect(money.paymentSplit.debit + money.paymentSplit.wallet + money.paymentSplit.credit)
      .toBe(money.cardWalletTotal)
  })

  it('una seña vieja, sin JSON, entra por depositMethod', () => {
    const money = tallyShiftMoney({
      sales: [],
      deposits: [{ method: 'debit', amount: 1500 }],
      debtEvents: [],
      movements: [],
    })
    expect(money.paymentSplit).toEqual({ debit: 1500, wallet: 0, credit: 0 })
    expect(money.cardWalletTotal).toBe(1500)
  })
})

describe('summaryPaymentBreakdown', () => {
  it('un turno solo con la ficha queda sin dato, y uno sin ficha no cuenta', () => {
    const view = summaryPaymentBreakdown([
      withFicha('solo-total', 8000),
      card({ id: 'sin-ficha' }),
    ])
    expect(view.debit).toBeNull()
    expect(view.wallet).toBeNull()
    expect(view.credit).toBeNull()
    expect(view.totalOnlyCount).toBe(1)
    expect(view.gaps).toEqual([])
  })

  it('si la suma no coincide, muestra la diferencia y no corrige el número', () => {
    const view = summaryPaymentBreakdown([
      {
        ...withFicha('distinto', 5000, 2000),
        paymentSplit: { debit: 1000, wallet: 0, credit: 0 },
      },
      withFicha('agrupado', 3000),
    ])
    expect(view.debit).toBe(1000)
    expect(view.wallet).toBe(0)
    expect(view.credit).toBe(0)
    expect(view.totalOnlyCount).toBe(1)
    expect(view.gaps).toEqual([{
      shiftId: 'distinto',
      difference: 4000,
      cause: PAYMENT_SPLIT_GAP_CAUSE,
    }])
  })
})
