import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOrderChargeDraft,
  loadOrderChargeDraft,
  resetOrderChargeDrafts,
  saveOrderChargeDraft,
} from '../orderChargeDraft'
import type { OrderChargeLine } from '../orderTicketMatch'

function line(name: string, qtyRaw: string): OrderChargeLine {
  return {
    productId: 'p1',
    name,
    unit: 'kg',
    pluNumber: 1,
    estimatedQty: 1,
    requestedUnits: null,
    unitPrice: 20000,
    qtyRaw,
    checked: true,
    ticketTotal: null,
    extra: false,
  }
}

describe('orderChargeDraft', () => {
  beforeEach(() => {
    resetOrderChargeDrafts()
  })

  it('guarda y devuelve una copia por id de pedido', () => {
    const original = [line('Asado', '2,5')]
    saveOrderChargeDraft('order-a', original)
    original[0]!.qtyRaw = '9'

    const loaded = loadOrderChargeDraft('order-a')
    expect(loaded).toEqual([line('Asado', '2,5')])
    if (!loaded?.[0]) throw new Error('falta el borrador')
    loaded[0].qtyRaw = '1'
    expect(loadOrderChargeDraft('order-a')).toEqual([line('Asado', '2,5')])
  })

  it('otro pedido no ve ese borrador, y confirmar borra solo ese id', () => {
    saveOrderChargeDraft('order-a', [line('Asado', '2,5')])
    saveOrderChargeDraft('order-b', [line('Vacío', '1')])

    expect(loadOrderChargeDraft('order-c')).toBeNull()
    expect(loadOrderChargeDraft('order-b')?.[0]?.name).toBe('Vacío')

    clearOrderChargeDraft('order-a')
    expect(loadOrderChargeDraft('order-a')).toBeNull()
    expect(loadOrderChargeDraft('order-b')?.[0]?.qtyRaw).toBe('1')
  })

  it('no escribe en localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    saveOrderChargeDraft('order-a', [line('Asado', '1')])
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})
