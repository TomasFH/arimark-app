import { describe, it, expect } from 'vitest'
import {
  buildCashValeRecords,
  buildProductValeRecord,
  buildSalaryPayRecords,
  salaryExpenseConcept,
  valeExpenseConcept,
} from '../lib/posPayrollWrite'
import type { CachedEmployee } from '../types/pos'

const employee: CachedEmployee = {
  id: 'emp-1',
  name: 'Juan Carnicero',
  weeklyWage: 80000,
  kind: 'butcher',
  archivedAt: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
  homeStoreId: null,
}

describe('posPayrollWrite', () => {
  it('vale en efectivo crea gasto que baja caja', () => {
    const { vale, expense } = buildCashValeRecords({
      valeId: 'v1',
      expenseId: 'e1',
      employee,
      shiftId: 's1',
      storeId: 'st1',
      amount: 5000,
      description: 'adelanto',
      recordedBy: 'uid',
      now: '2026-08-28T12:00:00.000Z',
    })
    expect(vale.amount).toBe(5000)
    expect(vale.items).toBeNull()
    expect(expense.kind).toBe('expense')
    expect(expense.amount).toBe(5000)
    expect(expense.concept).toBe(valeExpenseConcept(employee.name))
  })

  it('vale en productos no crea gasto', () => {
    const vale = buildProductValeRecord({
      valeId: 'v2',
      employee,
      shiftId: 's1',
      storeId: 'st1',
      items: [{
        productId: 'p1',
        productName: 'Asado',
        unit: 'kg',
        quantity: 2,
        unitPrice: 10000,
        subtotal: 20000,
      }],
      recordedBy: 'uid',
      now: '2026-08-28T12:00:00.000Z',
    })
    expect(vale.amount).toBe(20000)
    expect(vale.items).toHaveLength(1)
  })

  it('liquidación con neto > 0 crea gasto por el neto', () => {
    const { payment, expense } = buildSalaryPayRecords({
      paymentId: 'pay-1',
      expenseId: 'e-pay',
      employee,
      shiftId: 's1',
      storeId: 'st1',
      weekStart: '2026-08-24',
      amount: 80000,
      valesDeducted: 10000,
      notes: null,
      valesSnapshot: [{ id: 'v1', amount: 10000, description: null, paidAt: '2026-08-25T12:00:00.000Z' }],
      recordedBy: 'uid',
      now: '2026-08-28T12:00:00.000Z',
    })
    expect(payment.netPaid).toBe(70000)
    expect(expense?.amount).toBe(70000)
    expect(expense?.concept).toBe(salaryExpenseConcept(employee.name))
  })

  it('liquidación con neto 0 no crea gasto', () => {
    const { expense } = buildSalaryPayRecords({
      paymentId: 'pay-2',
      expenseId: 'e-pay2',
      employee,
      shiftId: 's1',
      storeId: 'st1',
      weekStart: '2026-08-24',
      amount: 80000,
      valesDeducted: 80000,
      notes: 'cubierto con vales',
      valesSnapshot: null,
      recordedBy: 'uid',
      now: '2026-08-28T12:00:00.000Z',
    })
    expect(expense).toBeNull()
  })
})
