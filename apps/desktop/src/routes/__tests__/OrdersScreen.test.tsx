import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrdersScreen from '../OrdersScreen'
import { resetOrderCreateDraft } from '../../lib/orderCreateDraft'
import type { OrderRow } from '../../types/hw-api'

function order(overrides: Partial<OrderRow> & Pick<OrderRow, 'id' | 'pickupDate' | 'status' | 'customerName'>): OrderRow {
  return {
    storeId: 's1',
    phone: null,
    items: 'Asado · 1 kg',
    timeSlot: 'morning',
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
    budgetItems: [{
      productId: 'p1',
      name: 'Asado',
      unit: 'kg',
      pluNumber: 1,
      estimatedQty: 1,
      unitPrice: 20000,
    }],
    ...overrides,
  }
}

describe('OrdersScreen — lista Listos / Pendientes', () => {
  beforeEach(() => {
    resetOrderCreateDraft()
    window.hw = {
      listOrders: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          order({ id: 'ready-1', pickupDate: '2026-09-02', status: 'ready', customerName: 'Update 3', readyAt: '2026-09-02T12:00:00.000Z', readyByName: 'Carnicero' }),
          order({ id: 'pend-1', pickupDate: '2026-09-04', status: 'pending', customerName: 'Update 4' }),
          order({
            id: 'del-1',
            pickupDate: '2026-09-01',
            status: 'delivered',
            customerName: 'Cliente reclamo',
            phone: '1144445555',
            updatedAt: '2026-09-01T18:00:00.000Z',
            updatedBy: 'Cajera Beto',
          }),
        ],
      }),
      getProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getPieceWeights: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      onOrderSyncUpdated: vi.fn(() => () => {}),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('muestra Listos y Pendientes, y oculta entregados hasta buscar', async () => {
    const user = userEvent.setup()
    render(
      <OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />,
    )

    expect(await screen.findByText('Update 3')).toBeInTheDocument()
    expect(screen.getByText('Update 4')).toBeInTheDocument()
    expect(screen.queryByText('Cliente reclamo')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Listos/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Pendientes/ })).toBeInTheDocument()
    expect(screen.queryByText('Activos')).not.toBeInTheDocument()
    expect(screen.queryByText('Últimos 30 días')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Entregados y cancelados' }))
    expect(await screen.findByText('Cliente reclamo')).toBeInTheDocument()
    expect(screen.queryByText('Update 3')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Listos y pendientes' }))
    expect(await screen.findByText('Update 3')).toBeInTheDocument()

    await user.type(
      screen.getByPlaceholderText(/incluye entregados/i),
      'reclamo',
    )
    expect(await screen.findByText('Cliente reclamo')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Resultados/ })).toBeInTheDocument()
  })

  it('al llegar Listo remoto recarga la lista y actualiza el detalle abierto', async () => {
    const user = userEvent.setup()
    let onSync: (() => void) | undefined
    const pending = order({ id: 'pend-1', pickupDate: '2026-09-04', status: 'pending', customerName: 'Update 4' })
    const ready = order({
      id: 'pend-1',
      pickupDate: '2026-09-04',
      status: 'ready',
      customerName: 'Update 4',
      readyAt: '2026-09-04T15:10:00.000Z',
      readyByName: 'Juan',
    })
    vi.mocked(window.hw.listOrders).mockResolvedValue({
      ok: true,
      data: [
        order({ id: 'ready-1', pickupDate: '2026-09-02', status: 'ready', customerName: 'Update 3', readyAt: '2026-09-02T12:00:00.000Z', readyByName: 'Carnicero' }),
        pending,
      ],
    })
    window.hw.onOrderSyncUpdated = vi.fn(cb => {
      onSync = cb
      return () => {}
    })

    render(<OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />)
    expect(await screen.findByText('Update 4')).toBeInTheDocument()

    await user.click(screen.getByText('Update 4'))
    const pendingCard = document.getElementById('order-pend-1')
    if (!pendingCard) throw new Error('No está la tarjeta del pedido pendiente')
    expect(within(pendingCard).queryByText(/Listo por/)).not.toBeInTheDocument()

    vi.mocked(window.hw.listOrders).mockResolvedValue({
      ok: true,
      data: [
        order({ id: 'ready-1', pickupDate: '2026-09-02', status: 'ready', customerName: 'Update 3', readyAt: '2026-09-02T12:00:00.000Z', readyByName: 'Carnicero' }),
        ready,
      ],
    })
    onSync?.()

    expect(await screen.findByText('Juan')).toBeInTheDocument()
    const updated = document.getElementById('order-pend-1')
    if (!updated) throw new Error('No está la tarjeta del pedido pendiente')
    expect(within(updated).getByText(/Listo por/)).toBeInTheDocument()
  })

  it('el alta nueva comparte el borrador y editar no lo pisa', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />,
    )
    expect(await screen.findByText('Update 4')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Nuevo pedido' }))
    await user.type(await screen.findByPlaceholderText('Ej: Restaurante El Sol'), 'Borrador Ana')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    unmount()
    render(<OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />)
    expect(await screen.findByText('Update 4')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '+ Nuevo pedido' }))
    expect(await screen.findByPlaceholderText('Ej: Restaurante El Sol')).toHaveValue('Borrador Ana')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await user.click(screen.getByText('Update 4'))
    const card = document.getElementById('order-pend-1')
    if (!card) throw new Error('No está la tarjeta del pedido pendiente')
    await user.click(menuButton(card))
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'Editar pedido' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ej: Restaurante El Sol')).toHaveValue('Update 4')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await user.click(screen.getByRole('button', { name: '+ Nuevo pedido' }))
    expect(await screen.findByPlaceholderText('Ej: Restaurante El Sol')).toHaveValue('Borrador Ana')
  })

  it('al cobrar, la etiqueta del PLU completa el peso y otra agrega un extra', async () => {
    vi.mocked(window.hw.getProducts).mockResolvedValue({
      ok: true,
      data: [
        { id: 'p1', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, price: 22000 },
        { id: 'p5', name: 'Vacío', category: 'beef_cut', unit: 'kg', pluNumber: 5, price: 21000 },
      ],
    })
    const user = userEvent.setup()
    render(<OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />)
    expect(await screen.findByText('Update 3')).toBeInTheDocument()

    await user.click(screen.getByText('Update 3'))
    const card = document.getElementById('order-ready-1')
    if (!card) throw new Error('No está la tarjeta del pedido')
    await user.click(within(card).getByRole('button', { name: 'Cobrar' }))

    expect(await screen.findByRole('heading', { name: 'Cobrar pedido' })).toBeInTheDocument()
    expect(await screen.findByText(/lista de hoy/i)).toBeInTheDocument()

    scanBarcode(kretzBarcode(1, 10000))
    expect(await screen.findByDisplayValue('0,5')).toBeInTheDocument()

    scanBarcode(kretzBarcode(5, 17535))
    expect(await screen.findByText('Extra')).toBeInTheDocument()
    expect(screen.getByText('Vacío')).toBeInTheDocument()
  })
})

function kretzBarcode(plu: number, pesos: number): string {
  const body = `20${String(plu).padStart(3, '0')}${String(pesos * 100).padStart(7, '0')}`
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[i])
    sum += i % 2 === 0 ? digit : digit * 3
  }
  return `${body}${(10 - (sum % 10)) % 10}`
}

function scanBarcode(digits: string) {
  act(() => {
    for (const key of digits) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
  })
}

function menuButton(card: HTMLElement): HTMLElement {
  const button = card.querySelector('button[aria-label="Más acciones"]')
  if (!(button instanceof HTMLElement)) throw new Error('No está el menú del pedido')
  return button
}
