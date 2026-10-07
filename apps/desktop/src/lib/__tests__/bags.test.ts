import { describe, it, expect } from 'vitest'
import { addBagItem, addBagToCart, removeBagQuantity } from '../bags'
import type { ProductRow, SaleItemDraft } from '../../types/hw-api'

const bag: ProductRow = {
  id: 'bag-1',
  pluNumber: 80,
  name: 'Bolsa chica',
  category: 'bags',
  unit: 'unit',
  price: 200,
}

const noPrice: ProductRow = { ...bag, id: 'bag-0', price: null }
const cut: ProductRow = { ...bag, id: 'cut', category: 'beef_cut', name: 'Asado' }

describe('addBagItem', () => {
  it('arma la línea con el precio de lista', () => {
    expect(addBagItem(bag, 2)).toMatchObject({
      productId: 'bag-1',
      weightKg: 2,
      unitPrice: 200,
      subtotal: 400,
    })
  })

  it('no inventa precio ni acepta otra categoría', () => {
    expect(addBagItem(noPrice, 1)).toBeNull()
    expect(addBagItem(cut, 1)).toBeNull()
    expect(addBagItem(bag, 0)).toBeNull()
  })
})

describe('addBagToCart', () => {
  const line = (qty: number, id = 'bag-1'): SaleItemDraft & { localId: string } => ({
    localId: `${id}-${qty}`,
    pluNumber: 80,
    productId: id,
    productName: id === 'bag-1' ? 'Bolsa ecológica' : 'Bolsa blanca',
    unit: 'unit',
    weightKg: qty,
    unitPrice: 200,
    subtotal: qty * 200,
    manualEntry: false,
  })

  it('suma en el mismo renglón y deja otro tipo aparte', () => {
    const once = addBagToCart([], bag, 1, 'nuevo')
    expect(once).toHaveLength(1)
    expect(once[0]?.weightKg).toBe(1)

    const twice = addBagToCart([line(1), line(1), line(2, 'bag-2')], bag, 1, 'otro')
    expect(twice).toHaveLength(2)
    expect(twice[0]).toMatchObject({ productId: 'bag-1', weightKg: 3, subtotal: 600 })
    expect(twice[1]?.productId).toBe('bag-2')
  })
})

describe('removeBagQuantity', () => {
  const line = (qty: number, id = 'bag-1'): SaleItemDraft & { localId: string } => ({
    localId: id + qty,
    pluNumber: 80,
    productId: id,
    productName: 'Bolsa chica',
    unit: 'unit',
    weightKg: qty,
    unitPrice: 200,
    subtotal: qty * 200,
    manualEntry: false,
  })

  it('resta cantidad y saca la línea si queda en cero', () => {
    const once = removeBagQuantity([line(3)], 'bag-1', 1)
    expect(once).toHaveLength(1)
    expect(once[0]?.weightKg).toBe(2)
    expect(once[0]?.subtotal).toBe(400)

    const gone = removeBagQuantity(once, 'bag-1', 2)
    expect(gone).toHaveLength(0)
  })

  it('no toca otros productos', () => {
    const items = [line(1, 'bag-1'), line(4, 'otro')]
    const next = removeBagQuantity(items, 'bag-1', 1)
    expect(next.map(item => item.productId)).toEqual(['otro'])
  })
})
