import { describe, expect, it } from 'vitest'
import { buildOrdersView, matchesOrderSearch, parseOrderSearch } from '../orderListView'
import type { BudgetCartLine, OrderRow } from '../../types/hw-api'

function line(name: string, estimatedQty: number, extra?: Partial<BudgetCartLine>): BudgetCartLine {
  return {
    productId: name,
    name,
    unit: extra?.unit ?? 'kg',
    pluNumber: 1,
    estimatedQty,
    unitPrice: 1000,
    requestedUnits: extra?.requestedUnits ?? null,
    ...extra,
  }
}

function order(overrides: Partial<OrderRow> & Pick<OrderRow, 'id' | 'pickupDate' | 'status'>): OrderRow {
  return {
    storeId: 's1',
    customerName: overrides.customerName ?? overrides.id,
    phone: null,
    items: '',
    timeSlot: null,
    pickupTime: null,
    priority: false,
    notes: null,
    depositAmount: 0,
    depositPayments: null,
    depositMethod: null,
    createdAt: '2026-09-02T10:00:00.000Z',
    createdBy: 'Cajera Ana',
    updatedAt: null,
    updatedBy: null,
    readyAt: null,
    readyBy: null,
    readyByName: null,
    budgetItems: null,
    ...overrides,
  }
}

describe('matchesOrderSearch', () => {
  it('encuentra por nombre, teléfono o productos', () => {
    const o = order({
      id: '1',
      pickupDate: '2026-09-03',
      status: 'delivered',
      customerName: 'Restaurante Sol',
      phone: '11-3303-0249',
      items: 'Morcilla · 4 u',
    })
    expect(matchesOrderSearch(o, 'sol')).toBe(true)
    expect(matchesOrderSearch(o, '3303')).toBe(true)
    expect(matchesOrderSearch(o, 'morcilla')).toBe(true)
    expect(matchesOrderSearch(o, 'asado')).toBe(false)
  })

  it('combina dos productos con espacio, sin atar un peso suelto a otro corte', () => {
    const asado = order({
      id: 'a',
      pickupDate: '2026-09-03',
      status: 'pending',
      items: 'Asado · 1,5 kg',
      budgetItems: [line('Asado', 1.5)],
    })
    const vacio2 = order({
      id: 'b',
      pickupDate: '2026-09-03',
      status: 'pending',
      items: 'Vacío · 2 kg',
      budgetItems: [line('Vacío', 2)],
    })
    const chorizo2u = order({
      id: 'c',
      pickupDate: '2026-09-03',
      status: 'pending',
      items: 'Chorizo colorado · 2 u',
      budgetItems: [line('Chorizo colorado', 0, { requestedUnits: 2 })],
    })
    const asado2 = order({
      id: 'd',
      pickupDate: '2026-09-03',
      status: 'pending',
      items: 'Asado · 2 kg',
      budgetItems: [line('Asado', 2)],
    })
    const both = order({
      id: 'e',
      pickupDate: '2026-09-03',
      status: 'pending',
      items: 'Asado · 1,5 kg, Morcilla · 3 u',
      budgetItems: [line('Asado', 1.5), line('Morcilla', 0, { requestedUnits: 3 })],
    })

    expect(matchesOrderSearch(asado2, 'asado, 2')).toBe(true)
    expect(matchesOrderSearch(asado2, 'asado 2kg')).toBe(true)
    expect(matchesOrderSearch(asado, 'asado, 2')).toBe(false)
    expect(matchesOrderSearch(asado, 'asado 2')).toBe(false)
    expect(matchesOrderSearch(vacio2, 'asado 2')).toBe(false)
    expect(matchesOrderSearch(chorizo2u, 'asado 2')).toBe(false)
    expect(matchesOrderSearch(asado, 'asado, 1,5')).toBe(true)
    expect(matchesOrderSearch(asado2, 'asado, 1,5')).toBe(false)
    expect(matchesOrderSearch(both, 'asado morcilla')).toBe(true)
    expect(matchesOrderSearch(asado, 'asado morcilla')).toBe(false)
  })

  it('parsea asado, 1,5 como par y asado morcilla como dos productos', () => {
    expect(parseOrderSearch('asado, 1,5')).toEqual([
      { kind: 'pair', product: 'asado', qty: 1.5, unit: undefined },
    ])
    expect(parseOrderSearch('asado morcilla')).toEqual([
      { kind: 'text', value: 'asado' },
      { kind: 'text', value: 'morcilla' },
    ])
    expect(parseOrderSearch('asado 2kg')).toEqual([
      { kind: 'pair', product: 'asado', qty: 2, unit: 'kg' },
    ])
  })
})

describe('buildOrdersView', () => {
  const readyToday = order({ id: 'listo-hoy', pickupDate: '2026-09-02', status: 'ready', customerName: 'Update 3' })
  const pendingFri = order({ id: 'pend-vie', pickupDate: '2026-09-04', status: 'pending', customerName: 'Update 4' })
  const delivered = order({
    id: 'entregado',
    pickupDate: '2026-09-01',
    status: 'delivered',
    customerName: 'Cliente reclamo',
    phone: '1144445555',
  })
  const cancelled = order({ id: 'cancel', pickupDate: '2026-09-02', status: 'cancelled', customerName: 'Cancelado X' })

  it('sin búsqueda: Listos arriba de Pendientes, oculta entregados y cancelados', () => {
    const view = buildOrdersView([pendingFri, delivered, readyToday, cancelled], '', false)
    expect(view.mode).toBe('grouped')
    if (view.mode !== 'grouped') return
    expect(view.ready.map(o => o.id)).toEqual(['listo-hoy'])
    expect(view.pending.map(o => o.id)).toEqual(['pend-vie'])
  })

  it('con búsqueda: incluye entregados y cancelados', () => {
    const view = buildOrdersView([pendingFri, delivered, readyToday, cancelled], 'reclamo', false)
    expect(view.mode).toBe('search')
    if (view.mode !== 'search') return
    expect(view.results.map(o => o.id)).toEqual(['entregado'])
  })

  it('con búsqueda por teléfono encuentra un cobrado', () => {
    const view = buildOrdersView([pendingFri, delivered], '114444', false)
    expect(view.mode).toBe('search')
    if (view.mode !== 'search') return
    expect(view.results).toHaveLength(1)
    expect(view.results[0]?.status).toBe('delivered')
  })

  it('dentro de Listos ordena por fecha de retiro más próxima', () => {
    const readyLater = order({ id: 'listo-vie', pickupDate: '2026-09-04', status: 'ready' })
    const view = buildOrdersView([readyLater, readyToday], '', false)
    expect(view.mode).toBe('grouped')
    if (view.mode !== 'grouped') return
    expect(view.ready.map(o => o.id)).toEqual(['listo-hoy', 'listo-vie'])
  })

  it('showClosed lista solo entregados y cancelados', () => {
    const view = buildOrdersView([pendingFri, delivered, readyToday, cancelled], '', true)
    expect(view.mode).toBe('closed')
    if (view.mode !== 'closed') return
    expect(view.results.map(o => o.id)).toEqual(['entregado', 'cancel'])
  })
})
