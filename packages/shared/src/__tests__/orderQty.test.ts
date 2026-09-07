import { describe, it, expect } from 'vitest'
import { formatKgQty, formatOrderQty, formatOrderQtyHint, summarizeBudgetItems } from '../orderQty'

describe('formatKgQty', () => {
  it('entero sin coma', () => {
    expect(formatKgQty(2)).toBe('2 kg')
  })

  it('decimal con coma es-AR', () => {
    expect(formatKgQty(1.5)).toBe('1,5 kg')
  })
})

describe('formatOrderQty', () => {
  it('muestra piezas si hay requestedUnits', () => {
    expect(formatOrderQty({
      name: 'Morcilla',
      unit: 'kg',
      estimatedQty: 1,
      requestedUnits: 3,
    })).toBe('3 u')
  })

  it('muestra kg si no hay piezas', () => {
    expect(formatOrderQty({
      name: 'Asado',
      unit: 'kg',
      estimatedQty: 1.7,
    })).toBe('1,7 kg')
  })

  it('muestra unidades de catálogo', () => {
    expect(formatOrderQty({
      name: 'Huevo',
      unit: 'unit',
      estimatedQty: 12,
    })).toBe('12 u')
  })
})

describe('formatOrderQtyHint', () => {
  it('muestra kilos chicos cuando hay piezas y kg', () => {
    expect(formatOrderQtyHint({
      name: 'Morcilla',
      unit: 'kg',
      estimatedQty: 1,
      requestedUnits: 3,
    })).toBe('~1 kg')
  })

  it('no muestra pista si solo hay kilos', () => {
    expect(formatOrderQtyHint({
      name: 'Asado',
      unit: 'kg',
      estimatedQty: 1.7,
    })).toBeNull()
  })

  it('no muestra pista si hay piezas sin kg', () => {
    expect(formatOrderQtyHint({
      name: 'Morcilla',
      unit: 'kg',
      estimatedQty: 0,
      requestedUnits: 3,
    })).toBeNull()
  })
})

describe('summarizeBudgetItems', () => {
  it('arma el texto de búsqueda', () => {
    expect(summarizeBudgetItems([
      { name: 'Asado', unit: 'kg', estimatedQty: 1.5 },
      { name: 'Morcilla', unit: 'kg', estimatedQty: 1, requestedUnits: 3 },
    ])).toBe('Asado · 1,5 kg, Morcilla · 3 u (~1 kg)')
  })
})
