import { describe, it, expect } from 'vitest'
import {
  parseBudgetItems,
  budgetItemsForFirestore,
  budgetItemsForSqlite,
  isBudgetCartLine,
} from '../budgetItems'

const asado = {
  productId: 'p1',
  name: 'Asado',
  unit: 'kg' as const,
  pluNumber: 10,
  estimatedQty: 1.5,
  unitPrice: 18000,
}

const morcillaPiezas = {
  productId: 'p2',
  name: 'Morcilla',
  unit: 'kg' as const,
  pluNumber: 20,
  estimatedQty: 0,
  unitPrice: 9000,
  requestedUnits: 3,
}

describe('parseBudgetItems', () => {
  it('parsea array de Firestore y JSON de SQLite', () => {
    expect(parseBudgetItems([asado])).toEqual([asado])
    expect(parseBudgetItems(JSON.stringify([asado, morcillaPiezas]))).toEqual([asado, morcillaPiezas])
  })

  it('omite líneas inválidas y vacía queda null', () => {
    expect(parseBudgetItems(null)).toBe(null)
    expect(parseBudgetItems('')).toBe(null)
    expect(parseBudgetItems('not-json')).toBe(null)
    expect(parseBudgetItems([{ name: 'Asado' }])).toBe(null)
    expect(parseBudgetItems([asado, { name: 'basura' }])).toEqual([asado])
  })

  it('acepta piezas sin kg (estimatedQty 0)', () => {
    expect(isBudgetCartLine(morcillaPiezas)).toBe(true)
    expect(parseBudgetItems([morcillaPiezas])).toEqual([morcillaPiezas])
  })
})

describe('budgetItemsForFirestore / budgetItemsForSqlite', () => {
  it('el push manda array y el pull guarda JSON', () => {
    expect(budgetItemsForFirestore(JSON.stringify([asado]))).toEqual([asado])
    expect(budgetItemsForSqlite([asado, morcillaPiezas])).toBe(
      JSON.stringify([asado, morcillaPiezas]),
    )
    expect(budgetItemsForFirestore(null)).toBe(null)
    expect(budgetItemsForSqlite(undefined)).toBe(null)
  })
})
