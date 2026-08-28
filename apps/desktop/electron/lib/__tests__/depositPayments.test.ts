import { describe, it, expect } from 'vitest'
import {
  cashAmountFromDeposit,
  digitalAmountFromDeposit,
  addDepositToTotals,
  emptyDepositTotals,
  parseDepositPayments,
  depositPaymentsToJson,
} from '../depositPayments'

describe('parseDepositPayments', () => {
  it('parsea JSON mixto', () => {
    const payments = parseDepositPayments(JSON.stringify([
      { method: 'cash', amount: 20000 },
      { method: 'debit', amount: 10000 },
    ]))
    expect(payments).toEqual([
      { method: 'cash', amount: 20000 },
      { method: 'debit', amount: 10000 },
    ])
  })

  it('retorna null si el JSON es inválido, vacío o no es un array', () => {
    expect(parseDepositPayments('no-json')).toBeNull()
    expect(parseDepositPayments('[]')).toBeNull()
    expect(parseDepositPayments(null)).toBeNull()
    expect(parseDepositPayments('"not-an-array"')).toBeNull()
  })
})

describe('cashAmountFromDeposit / digitalAmountFromDeposit', () => {
  it('usa depositPayments cuando hay JSON mixto (no el total ni solo depositMethod)', () => {
    const row = {
      depositAmount: 30000,
      depositMethod: 'cash',
      depositPayments: JSON.stringify([
        { method: 'cash', amount: 20000 },
        { method: 'debit', amount: 10000 },
      ]),
    }
    expect(cashAmountFromDeposit(row)).toBe(20000)
    expect(digitalAmountFromDeposit(row)).toBe(10000)
  })

  it('cae al campo legado depositMethod si no hay JSON', () => {
    expect(cashAmountFromDeposit({ depositAmount: 40000, depositMethod: 'cash' })).toBe(40000)
    expect(digitalAmountFromDeposit({ depositAmount: 40000, depositMethod: 'cash' })).toBe(0)
    expect(cashAmountFromDeposit({ depositAmount: 15000, depositMethod: 'debit' })).toBe(0)
    expect(digitalAmountFromDeposit({ depositAmount: 15000, depositMethod: 'debit' })).toBe(15000)
  })

  it('JSON inválido cae a depositMethod', () => {
    const row = { depositAmount: 5000, depositMethod: 'cash' as const, depositPayments: '{broken' }
    expect(cashAmountFromDeposit(row)).toBe(5000)
  })
})

describe('addDepositToTotals', () => {
  it('acumula por medio', () => {
    const totals = emptyDepositTotals()
    addDepositToTotals({
      depositAmount: 30000,
      depositPayments: JSON.stringify([
        { method: 'cash', amount: 20000 },
        { method: 'wallet', amount: 10000 },
      ]),
    }, totals)
    addDepositToTotals({ depositAmount: 5000, depositMethod: 'credit' }, totals)
    expect(totals).toEqual({ cash: 20000, debit: 0, wallet: 10000, credit: 5000 })
  })
})

describe('depositPaymentsToJson', () => {
  it('acepta string o array', () => {
    expect(depositPaymentsToJson('[{"method":"cash","amount":1}]')).toBe('[{"method":"cash","amount":1}]')
    expect(depositPaymentsToJson([{ method: 'cash', amount: 1 }])).toBe('[{"method":"cash","amount":1}]')
    expect(depositPaymentsToJson(null)).toBeNull()
  })
})
