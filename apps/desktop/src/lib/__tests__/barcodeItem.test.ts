/**
 * Tests de buildItemFromBarcode (módulo barcodeItem.ts).
 */

import { describe, it, expect } from 'vitest'
import { buildItemFromBarcode, applySpecialUnitPrice, assignCatalogProduct, valeLineFromBarcode } from '../barcodeItem'
import type { ProductRow } from '../../types/hw-api'

const kgProduct: ProductRow = {
  id: 'prod-1',
  pluNumber: 5,
  name: 'Vacío',
  category: 'beef_cut',
  unit: 'kg',
  price: 21000,
}

const unitProduct: ProductRow = {
  id: 'prod-2',
  pluNumber: 1,
  name: 'Huevos x30',
  category: 'other',
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

  it('entra con el precio del ticket si no hay producto en catálogo', () => {
    const item = buildItemFromBarcode(99, 10000, undefined)
    expect(item.productName).toBe('PLU 99')
    expect(item.productId).toBeNull()
    expect(item.weightKg).toBe(1)
    expect(item.unitPrice).toBe(10000)
    expect(item.subtotal).toBe(10000)
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

describe('applySpecialUnitPrice', () => {
  it('recalcula subtotal conservando el peso', () => {
    const item = buildItemFromBarcode(5, 17535, kgProduct)
    const priced = applySpecialUnitPrice(item, 18000)
    expect(priced.weightKg).toBeCloseTo(item.weightKg, 5)
    expect(priced.unitPrice).toBe(18000)
    expect(priced.subtotal).toBe(Math.round(item.weightKg * 18000))
    expect(priced.priceDiscrepancy).toBe(true)
  })

  it('no cambia si no hay precio especial', () => {
    const item = buildItemFromBarcode(5, 17535, kgProduct)
    expect(applySpecialUnitPrice(item, undefined)).toEqual(item)
    expect(applySpecialUnitPrice(item, 0)).toEqual(item)
  })
})

describe('assignCatalogProduct', () => {
  const ticket = buildItemFromBarcode(99, 17535, undefined)

  it('deriva el peso si el precio de lista cierra con el ticket', () => {
    const assigned = assignCatalogProduct(ticket, kgProduct)
    expect(assigned.productId).toBe(kgProduct.id)
    expect(assigned.productName).toBe('Vacío')
    expect(assigned.subtotal).toBe(17535)
    expect(assigned.unitPrice).toBe(21000)
    expect(assigned.weightKg).toBeCloseTo(17535 / 21000, 5)
    expect(assigned.priceDiscrepancy).toBeUndefined()
  })

  it('deja precio especial si el total no coincide con unidades de lista', () => {
    const assigned = assignCatalogProduct(
      buildItemFromBarcode(99, 7000, undefined),
      unitProduct,
    )
    expect(assigned.productId).toBe(unitProduct.id)
    expect(assigned.subtotal).toBe(7000)
    expect(assigned.priceDiscrepancy).toBe(true)
    expect(assigned.unitPrice).not.toBe(unitProduct.price)
  })

  it('usa el precio del ticket cuando el producto no tiene precio de lista', () => {
    const otros: ProductRow = {
      id: 'prod-otros',
      pluNumber: 999,
      name: 'Otros',
      category: 'other',
      unit: 'kg',
      price: null,
    }
    const assigned = assignCatalogProduct(ticket, otros)
    expect(assigned.productId).toBe('prod-otros')
    expect(assigned.productName).toBe('Otros')
    expect(assigned.pluNumber).toBe(999)
    expect(assigned.subtotal).toBe(17535)
    expect(assigned.unitPrice).toBe(17535)
    expect(assigned.priceDiscrepancy).toBe(true)
  })
})

describe('valeLineFromBarcode', () => {
  it('agrega el producto del ticket a la lista del vale', () => {
    const line = valeLineFromBarcode('2000517535000', [kgProduct])
    expect(line.ok).toBe(true)
    if (!line.ok) return
    expect(line.product.id).toBe(kgProduct.id)
    expect(line.priceText).toBe('21.000')
    expect(line.quantityText).toContain('0,835')
  })

  it('no arma línea si el PLU no está en el catálogo', () => {
    const line = valeLineFromBarcode('2009910000009', [kgProduct])
    expect(line).toEqual({ ok: false, error: 'PLU 99 no está en el catálogo.' })
  })
})
