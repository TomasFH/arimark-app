import { describe, it, expect } from 'vitest'
import { expectedCashInHand, shiftRevenue } from '../lib/shiftCash'

describe('shiftCash', () => {
  it('apertura + solo efectivo; débito no suma', () => {
    const sales = [
      { total: 15000, payments: [{ paymentMethod: 'cash', amount: 10000 }, { paymentMethod: 'debit', amount: 5000 }] },
      { total: 3000, payments: [{ paymentMethod: 'wallet', amount: 3000 }] },
    ]
    expect(expectedCashInHand(5000, sales)).toBe(15000)
    expect(shiftRevenue(sales)).toBe(18000)
  })

  it('sin ventas es el efectivo de apertura', () => {
    expect(expectedCashInHand(12000, [])).toBe(12000)
  })
})
