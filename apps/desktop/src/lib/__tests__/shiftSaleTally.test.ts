import { describe, expect, it } from 'vitest'
import { tallyShiftCollections, ventaCountLabel } from '../shiftSaleTally'

describe('tallyShiftCollections', () => {
  it('una mezcla cuenta en efectivo y en digital, y el fiado sin cobro solo en el total', () => {
    const tally = tallyShiftCollections([
      { status: 'confirmed', total: 10000, payments: [{ method: 'cash', amount: 6000 }, { method: 'debit', amount: 4000 }] },
      { status: 'confirmed', total: 8000, payments: [{ method: 'wallet', amount: 8000 }] },
      { status: 'confirmed', total: 99999, payments: [] },
      { status: 'cancelled', total: 1000, payments: [{ method: 'cash', amount: 1000 }] },
    ])

    expect(tally.saleCount).toBe(3)
    expect(tally.total).toBe(117999)
    expect(tally.cashAmount).toBe(6000)
    expect(tally.cashSales).toBe(1)
    expect(tally.digitalAmount).toBe(12000)
    expect(tally.digitalSales).toBe(2)
    expect(tally.byMethod.debit).toEqual({ amount: 4000, sales: 1 })
    expect(tally.byMethod.wallet).toEqual({ amount: 8000, sales: 1 })
    expect(tally.byMethod.credit).toEqual({ amount: 0, sales: 0 })
  })

  it('débito y billetera en la misma venta cuentan en los dos medios y una sola vez en digital', () => {
    const tally = tallyShiftCollections([
      {
        status: 'confirmed',
        total: 5000,
        payments: [{ method: 'debit', amount: 2000 }, { method: 'wallet', amount: 3000 }],
      },
    ])
    expect(tally.digitalSales).toBe(1)
    expect(tally.byMethod.debit.sales).toBe(1)
    expect(tally.byMethod.wallet.sales).toBe(1)
    expect(tally.cashSales).toBe(0)
  })
})

describe('ventaCountLabel', () => {
  it('pluraliza', () => {
    expect(ventaCountLabel(1)).toBe('1 venta')
    expect(ventaCountLabel(3)).toBe('3 ventas')
  })
})
