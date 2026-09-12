import { describe, expect, it } from 'vitest'
import {
  quoteCashDiscount,
  remainderIncludesCash,
  resolveCashDiscountRule,
  roundCashDiscount,
  saleTotalFromQuote,
} from '../cashDiscount'

const RULE = { minAmount: 50000, percent: 10 }

describe('roundCashDiscount', () => {
  it('redondea el 10% de 100000 a 10000', () => {
    expect(roundCashDiscount(100000, 10)).toBe(10000)
  })

  it('percent 0 no descuenta', () => {
    expect(roundCashDiscount(100000, 0)).toBe(0)
  })
})

describe('quoteCashDiscount — ejemplo acordado', () => {
  it('100000 − 10% = 90000; seña cash 20000 → cobrar 70000', () => {
    const quote = quoteCashDiscount({
      rule: RULE,
      itemTotal: 100000,
      depositAmount: 20000,
      depositDigitalAmount: 0,
      remainderIncludesCash: true,
    })
    expect(quote.eligible).toBe(true)
    expect(quote.discountAmount).toBe(10000)
    expect(quote.discountedTotal).toBe(90000)
    expect(quote.amountDue).toBe(70000)
    expect(saleTotalFromQuote(quote, 100000, 20000)).toBe(90000)
  })

  it('seña digital anula el descuento: cobra 80000', () => {
    const quote = quoteCashDiscount({
      rule: RULE,
      itemTotal: 100000,
      depositAmount: 20000,
      depositDigitalAmount: 20000,
      remainderIncludesCash: true,
    })
    expect(quote.eligible).toBe(false)
    expect(quote.amountDue).toBe(80000)
    expect(saleTotalFromQuote(quote, 100000, 20000)).toBe(80000)
  })

  it('saldo 100% digital no aplica', () => {
    const quote = quoteCashDiscount({
      rule: RULE,
      itemTotal: 100000,
      remainderIncludesCash: false,
    })
    expect(quote.eligible).toBe(false)
    expect(quote.amountDue).toBe(100000)
  })

  it('fiado no aplica', () => {
    const quote = quoteCashDiscount({
      rule: RULE,
      itemTotal: 100000,
      isDebt: true,
      remainderIncludesCash: true,
    })
    expect(quote.eligible).toBe(false)
    expect(quote.amountDue).toBe(100000)
  })

  it('debajo del mínimo no aplica', () => {
    const quote = quoteCashDiscount({
      rule: RULE,
      itemTotal: 49999,
      remainderIncludesCash: true,
    })
    expect(quote.eligible).toBe(false)
  })

  it('mixto con efectivo mantiene el descuento', () => {
    const quote = quoteCashDiscount({
      rule: RULE,
      itemTotal: 100000,
      remainderIncludesCash: remainderIncludesCash([
        { paymentMethod: 'cash', amount: 80000 },
        { paymentMethod: 'debit', amount: 10000 },
      ]),
    })
    expect(quote.eligible).toBe(true)
    expect(quote.amountDue).toBe(90000)
  })
})

describe('resolveCashDiscountRule', () => {
  const fallback = { minAmount: 50000, percent: 10 }
  const weekend: Array<{
    days: Array<0 | 6>
    morning: { minAmount: number; percent: number }
    afternoon: { minAmount: number; percent: number }
  }> = [{
    days: [0, 6],
    morning: { minAmount: 0, percent: 15 },
    afternoon: { minAmount: 0, percent: 20 },
  }]

  it('usa la regla general si el día no está en un bloque', () => {
    expect(resolveCashDiscountRule({
      fallback,
      schedule: weekend,
      weekday: 1,
      shiftType: 'morning',
    })).toEqual(fallback)
  })

  it('usa mañana o tarde del bloque; evening es tarde', () => {
    expect(resolveCashDiscountRule({
      fallback,
      schedule: weekend,
      weekday: 6,
      shiftType: 'morning',
    }).percent).toBe(15)
    expect(resolveCashDiscountRule({
      fallback,
      schedule: weekend,
      weekday: 0,
      shiftType: 'evening',
    }).percent).toBe(20)
  })

  it('0 % en el bloque apaga el descuento ese turno', () => {
    expect(resolveCashDiscountRule({
      fallback,
      schedule: [{
        days: [3],
        morning: { minAmount: 0, percent: 0 },
        afternoon: { minAmount: 0, percent: 0 },
      }],
      weekday: 3,
      shiftType: 'morning',
    }).percent).toBe(0)
  })
})
