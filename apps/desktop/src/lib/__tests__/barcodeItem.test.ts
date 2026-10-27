/**
 * Tests de buildItemFromBarcode (módulo barcodeItem.ts).
 */

import { describe, it, expect } from 'vitest'
import { buildItemFromBarcode, applySpecialUnitPrice, assignCatalogProduct, resolveScannedItem, valeLineFromBarcode, valeLineFromTypedPrice } from '../barcodeItem'
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

const abierto: ProductRow = {
  id: 'prod-abierto',
  pluNumber: 998,
  name: 'Prueba',
  category: 'beef_cut',
  unit: 'kg',
  price: 0,
}

const unidadAbierta: ProductRow = {
  ...unitProduct,
  id: 'prod-u0',
  pluNumber: 950,
  name: 'Confirmación',
  price: 0,
}

describe('resolveScannedItem — precio abierto', () => {
  it('no arma la línea si la lista está en 0 y no hay precio de cliente', () => {
    const resolved = resolveScannedItem(998, 10000, abierto)
    expect(resolved.status).toBe('needsPrice')
    if (resolved.status !== 'needsPrice') return
    expect(resolved.request.totalARS).toBe(10000)
    expect(resolved.request.product.id).toBe(abierto.id)
  })

  it('divide por el precio de cliente cuando la lista está en 0', () => {
    const resolved = resolveScannedItem(998, 10000, abierto, 20000)
    expect(resolved.status).toBe('ready')
    if (resolved.status !== 'ready') return
    expect(resolved.item.weightKg).toBeCloseTo(0.5, 5)
    expect(resolved.item.unitPrice).toBe(20000)
    expect(resolved.item.subtotal).toBe(10000)
    expect(resolved.item.productId).toBe(abierto.id)
  })

  it('con lista mayor a 0 sigue dividiendo por la lista', () => {
    const resolved = resolveScannedItem(5, 17535, kgProduct, 18000)
    expect(resolved.status).toBe('ready')
    if (resolved.status !== 'ready') return
    expect(resolved.item.unitPrice).toBe(21000)
    expect(resolved.item.weightKg).toBeCloseTo(17535 / 21000, 5)
    expect(resolved.item.subtotal).toBe(17535)
  })

  it('el precio tipeado usa el mismo redondeo por unidad que la lista', () => {
    const fromList = buildItemFromBarcode(1, 7000, unitProduct)
    const typed = buildItemFromBarcode(950, 7000, unidadAbierta, unitProduct.price ?? 0)
    expect(typed.weightKg).toBe(fromList.weightKg)
    expect(typed.priceDiscrepancy).toBe(fromList.priceDiscrepancy)
    expect(typed.unitPrice).toBe(unitProduct.price)
    expect(typed.subtotal).toBe(7000)
  })

  it('el kilo tipeado conserva el importe del ticket', () => {
    const item = buildItemFromBarcode(998, 10000, abierto, 18000)
    expect(item.weightKg).toBeCloseTo(10000 / 18000, 5)
    expect(item.unitPrice).toBe(18000)
    expect(item.subtotal).toBe(10000)
    expect(item.priceDiscrepancy).toBeUndefined()
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

  it('pide precio si el PLU está en 0', () => {
    const line = valeLineFromBarcode(kretzBarcode(998, 10000), [abierto])
    expect(line.ok).toBe(false)
    if (line.ok || !('needsPrice' in line)) return
    expect(line.needsPrice.product.pluNumber).toBe(998)
    expect(line.needsPrice.totalARS).toBe(10000)
  })
})

describe('valeLineFromTypedPrice', () => {
  it('guarda el kilo como importe ÷ precio y el subtotal del ticket', () => {
    const line = valeLineFromTypedPrice(abierto, 10000, 20000)
    expect(line.ok).toBe(true)
    if (!line.ok) return
    expect(line.priceText).toBe('20.000')
    expect(line.quantityText).toContain('0,5')
    expect(line.subtotal).toBe(10000)
  })

  it('redondea unidades igual que un precio de lista', () => {
    const fromList = valeLineFromBarcode(kretzBarcode(1, 7000), [unitProduct])
    const typed = valeLineFromTypedPrice(unidadAbierta, 7000, 6000)
    expect(fromList.ok).toBe(true)
    expect(typed.ok).toBe(true)
    if (!fromList.ok || !typed.ok) return
    expect(typed.quantityText).toBe(fromList.quantityText)
    expect(typed.subtotal).toBe(7000)
  })
})

function kretzBarcode(plu: number, pesos: number): string {
  const body = `20${String(plu).padStart(3, '0')}${String(pesos * 100).padStart(7, '0')}`
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const digit = Number(body[i])
    sum += i % 2 === 0 ? digit : digit * 3
  }
  const check = (10 - (sum % 10)) % 10
  return body + String(check)
}
