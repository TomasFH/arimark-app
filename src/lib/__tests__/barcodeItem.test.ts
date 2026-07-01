/**
 * Tests de buildItemFromBarcode (módulo barcodeItem.ts).
 */

import { describe, it, expect } from 'vitest'
import { buildItemFromBarcode } from '../barcodeItem'
import type { ProductRow } from '../../types/hw-api'

const kgProduct: ProductRow = {
  id: 'prod-1',
  pluNumber: 5,
  name: 'Vacío',
  unit: 'kg',
  price: 21000,
}

const unitProduct: ProductRow = {
  id: 'prod-2',
  pluNumber: 1,
  name: 'Huevos x30',
  unit: 'unit',
  price: 6000,
}

describe('buildItemFromBarcode — producto por kg', () => {
  it('calcula el peso correcto a partir del precio total', () => {
    const item = buildItemFromBarcode(5, 17535, kgProduct)
    expect(item.weightKg).toBeCloseTo(0.835, 2)
    expect(item.unitPrice).toBe(21000)
    expect(item.subtotal).toBe(17535)
    expect(item.unit).toBe('kg')
    expect(item.priceDiscrepancy).toBeUndefined()
    expect(item.manualEntry).toBe(false)
  })

  it('usa el productName del catálogo', () => {
    const item = buildItemFromBarcode(5, 17535, kgProduct)
    expect(item.productName).toBe('Vacío')
  })

  it('fallback a PLU N si no hay producto en catálogo', () => {
    const item = buildItemFromBarcode(99, 10000, undefined)
    expect(item.productName).toBe('PLU 99')
    expect(item.weightKg).toBe(1)
    expect(item.unitPrice).toBe(10000)
  })
})

describe('buildItemFromBarcode — producto por unidad', () => {
  it('calcula cantidad entera correctamente (sin discrepancia)', () => {
    const item = buildItemFromBarcode(1, 6000, unitProduct)
    expect(item.weightKg).toBe(1)
    expect(item.priceDiscrepancy).toBe(false)
  })

  it('detecta discrepancia cuando el precio no coincide con unidades enteras', () => {
    // 7000 / 6000 = 1.166… → no es entero → priceDiscrepancy
    const item = buildItemFromBarcode(1, 7000, unitProduct)
    expect(item.priceDiscrepancy).toBe(true)
  })

  it('calcula múltiples unidades (2 huevos = 12000)', () => {
    const item = buildItemFromBarcode(1, 12000, unitProduct)
    expect(item.weightKg).toBe(2)
    expect(item.priceDiscrepancy).toBe(false)
  })
})
