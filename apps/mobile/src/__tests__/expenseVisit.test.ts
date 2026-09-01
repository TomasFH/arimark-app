import { describe, it, expect } from 'vitest'
import { computeProviderVisit, debtEventId } from '../lib/expenseVisit'

describe('computeProviderVisit', () => {
  it('visita sin pago genera deuda nueva y no saca caja', () => {
    const r = computeProviderVisit({ visitTotal: 5000, delivered: 0, previousBalance: 0 })
    expect(r.amountForVisit).toBe(0)
    expect(r.newDebtAmount).toBe(5000)
    expect(r.paysOldDebt).toBe(0)
    expect(r.displayedNewDebt).toBe(5000)
    expect(r.finalBalance).toBe(5000)
  })

  it('pago parcial deja deuda de la visita', () => {
    const r = computeProviderVisit({ visitTotal: 5000, delivered: 2000, previousBalance: 0 })
    expect(r.amountForVisit).toBe(2000)
    expect(r.newDebtAmount).toBe(3000)
    expect(r.paysOldDebt).toBe(0)
  })

  it('exceso sobre la visita va a paysOldDebt', () => {
    const r = computeProviderVisit({ visitTotal: 5000, delivered: 7000, previousBalance: 1500 })
    expect(r.amountForVisit).toBe(5000)
    expect(r.newDebtAmount).toBe(0)
    expect(r.paysOldDebt).toBe(2000)
    expect(r.finalBalance).toBe(-500)
  })

  it('saldo a favor se aplica a la deuda mostrada de esta visita', () => {
    const r = computeProviderVisit({ visitTotal: 5000, delivered: 0, previousBalance: -1000 })
    expect(r.newDebtAmount).toBe(5000)
    expect(r.creditAppliedToVisit).toBe(1000)
    expect(r.displayedNewDebt).toBe(4000)
    expect(r.finalBalance).toBe(4000)
  })

  it('debtEventId es estable por gasto y tipo', () => {
    expect(debtEventId('exp-1', 'debt')).toBe('exp-1:debt')
    expect(debtEventId('exp-1', 'payment')).toBe('exp-1:payment')
  })
})
