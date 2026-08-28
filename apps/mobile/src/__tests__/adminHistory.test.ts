import { describe, it, expect } from 'vitest'
import {
  sumPaymentTotals,
  sumValesByEmployee,
  debtEventMatchesShift,
  type AdminSale,
  type AdminVale,
} from '../lib/adminHistory'

function sale(partial: Partial<AdminSale> & { id: string }): AdminSale {
  return {
    shiftId: 's1',
    total: 0,
    status: 'confirmed',
    createdAt: '2026-08-01T12:00:00.000Z',
    items: [],
    payments: [],
    ...partial,
  }
}

describe('sumPaymentTotals', () => {
  it('suma por medio de pago e ignora canceladas', () => {
    const totals = sumPaymentTotals([
      sale({
        id: 'a',
        payments: [
          { paymentMethod: 'cash', amount: 1000 },
          { paymentMethod: 'debit', amount: 500 },
        ],
      }),
      sale({
        id: 'b',
        payments: [{ paymentMethod: 'wallet', amount: 200 }],
      }),
      sale({
        id: 'c',
        status: 'cancelled',
        payments: [{ paymentMethod: 'cash', amount: 999 }],
      }),
      sale({
        id: 'd',
        payments: [{ paymentMethod: 'credit', amount: 300 }],
      }),
    ])

    expect(totals.cash).toBe(1000)
    expect(totals.debit).toBe(500)
    expect(totals.wallet).toBe(200)
    expect(totals.credit).toBe(300)
    expect(totals.total).toBe(2000)
  })

  it('retorna ceros si no hay ventas', () => {
    expect(sumPaymentTotals([])).toEqual({
      cash: 0,
      debit: 0,
      wallet: 0,
      credit: 0,
      total: 0,
    })
  })
})

function vale(partial: Partial<AdminVale> & { id: string; employeeId: string }): AdminVale {
  return {
    employeeName: 'Emp',
    storeId: 's1',
    shiftId: null,
    amount: 0,
    description: null,
    items: [],
    paidAt: '2026-08-03T12:00:00.000Z',
    createdAt: '2026-08-03T12:00:00.000Z',
    cancelledAt: null,
    ...partial,
  }
}

describe('sumValesByEmployee', () => {
  it('agrupa montos y cuenta por empleado', () => {
    const totals = sumValesByEmployee([
      vale({ id: '1', employeeId: 'a', employeeName: 'Ana', amount: 1000 }),
      vale({ id: '2', employeeId: 'b', employeeName: 'Bob', amount: 500 }),
      vale({ id: '3', employeeId: 'a', employeeName: 'Ana', amount: 2000 }),
    ])
    expect(totals).toEqual([
      { employeeId: 'a', employeeName: 'Ana', total: 3000, count: 2 },
      { employeeId: 'b', employeeName: 'Bob', total: 500, count: 1 },
    ])
  })

  it('retorna vacío si no hay vales', () => {
    expect(sumValesByEmployee([])).toEqual([])
  })
})

describe('debtEventMatchesShift', () => {
  const saleIds = new Set(['sale-1'])

  it('acepta evento con shiftId del turno', () => {
    expect(debtEventMatchesShift({ shiftId: 's1', eventType: 'created' }, 's1', new Set())).toBe(true)
  })

  it('acepta alta created ligada a una venta del turno aunque shiftId sea null', () => {
    expect(debtEventMatchesShift(
      { shiftId: null, saleId: 'sale-1', eventType: 'created' },
      's1',
      saleIds,
    )).toBe(true)
  })

  it('no atribuye un cobro posterior al turno de la venta original', () => {
    expect(debtEventMatchesShift(
      { shiftId: 'otro', saleId: 'sale-1', eventType: 'partial_payment' },
      's1',
      saleIds,
    )).toBe(false)
  })

  it('ignora eliminados y ventas de otro turno', () => {
    expect(debtEventMatchesShift({ shiftId: 's1', deleted: true }, 's1', saleIds)).toBe(false)
    expect(debtEventMatchesShift(
      { shiftId: null, saleId: 'sale-otra', eventType: 'created' },
      's1',
      saleIds,
    )).toBe(false)
  })
})
