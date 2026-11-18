import { describe, expect, it } from 'vitest'
import {
  EXPENSE_GAP_NO_ROWS,
  summarizeExpenses,
  type SummaryExpenseInput,
} from '../expenseSummary'
import type { SummaryShiftCard } from '../summaryMoney'

function ficha(id: string, expenseTotal: number): SummaryShiftCard {
  return {
    id,
    cashierName: 'Ana',
    shiftType: 'morning',
    startedAt: '2026-10-20T12:00:00.000Z',
    closedAt: '2026-10-20T20:00:00.000Z',
    openingCash: 0,
    cashLeft: null,
    withdrawn: null,
    soldTotal: 0,
    cashTotal: 0,
    cardWalletTotal: 0,
    debtTotal: 0,
    expenseTotal,
    contributionTotal: 0,
    walletCashTotal: 0,
    moneySnapshottedAt: '2026-10-20T20:00:00.000Z',
    live: false,
  }
}

function line(partial: Partial<SummaryExpenseInput> & Pick<SummaryExpenseInput, 'id' | 'concept' | 'amount'>): SummaryExpenseInput {
  return {
    shiftId: 'turno',
    createdAt: '2026-10-20T15:00:00.000Z',
    providerName: 'Hielo Sur',
    notes: null,
    kind: 'expense',
    storeName: 'Local Norte',
    ...partial,
  }
}

describe('summarizeExpenses', () => {
  it('clasifica gasto, vale, sueldo y mercadería, y deja afuera el inject', () => {
    const view = summarizeExpenses([
      line({ id: 'g', concept: 'Hielo', amount: 100, createdAt: '2026-10-20T18:00:00.000Z' }),
      line({ id: 'v', concept: 'Vale: Ana', amount: 200, providerName: null, createdAt: '2026-10-20T16:00:00.000Z' }),
      line({ id: 's', concept: 'Salario: Luis', amount: 300, createdAt: '2026-10-20T17:00:00.000Z' }),
      line({ id: 'm', concept: 'Mercadería: Pollo', amount: 400, createdAt: '2026-10-20T15:00:00.000Z' }),
      line({ id: 'i', concept: 'Aporte', amount: 999, kind: 'inject' }),
    ], [ficha('turno', 1000)])
    expect(view.rows.map(row => row.origin)).toEqual(['Mercadería', 'Vale', 'Salario', 'Gasto'])
    expect(view.rows.map(row => row.id)).toEqual(['m', 'v', 's', 'g'])
    expect(view.rowTotal).toBe(1000)
    expect(view.gap).toBeNull()
    expect(view.byOrigin).toEqual([
      { origin: 'Mercadería', amount: 400 },
      { origin: 'Salario', amount: 300 },
      { origin: 'Vale', amount: 200 },
      { origin: 'Gasto', amount: 100 },
    ])
    expect(view.rows.find(row => row.id === 'v')?.providerName).toBe('Sin proveedor')
  })

  it('agrupa concepto y proveedor aunque cambie la mayúscula o sobren espacios', () => {
    const view = summarizeExpenses([
      line({ id: 'a', concept: 'Hielo', providerName: '  Frigorífico Sur ', amount: 10, createdAt: '2026-10-20T15:00:00.000Z' }),
      line({ id: 'b', concept: '  hielo  ', providerName: 'frigorífico   sur', amount: 15, createdAt: '2026-10-20T16:00:00.000Z' }),
      line({ id: 'c', concept: '   ', providerName: '  ', amount: 5, createdAt: '2026-10-20T17:00:00.000Z' }),
    ], [ficha('turno', 30)])
    expect(view.byConcept).toEqual([
      { key: 'hielo', label: 'Hielo', amount: 25 },
      { key: 'Sin concepto', label: 'Sin concepto', amount: 5 },
    ])
    expect(view.byProvider).toEqual([
      { key: 'frigorífico sur', label: 'Frigorífico Sur', amount: 25 },
      { key: 'Sin proveedor', label: 'Sin proveedor', amount: 5 },
    ])
    expect(view.gap).toBeNull()
  })

  it('si la ficha tiene gastos y no hay filas, muestra la diferencia y no inventa filas', () => {
    const view = summarizeExpenses([], [
      ficha('con-filas', 0),
      ficha('sin-filas', 800),
      {
        ...ficha('sin-ficha', 5000),
        soldTotal: null,
        cashTotal: null,
        cardWalletTotal: null,
        debtTotal: null,
        expenseTotal: null,
        contributionTotal: null,
        walletCashTotal: null,
        moneySnapshottedAt: null,
      },
    ])
    expect(view.rows).toEqual([])
    expect(view.rowTotal).toBeNull()
    expect(view.gap).toEqual({
      difference: 800,
      cause: EXPENSE_GAP_NO_ROWS,
      shiftIds: ['sin-filas'],
    })
  })
})
