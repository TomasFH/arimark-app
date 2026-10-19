import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrdersScreen from '../OrdersScreen'
import { resetOrderCreateDraft } from '../../lib/orderCreateDraft'
import { loadOrderChargeDraft, resetOrderChargeDrafts } from '../../lib/orderChargeDraft'
import { CHARGE_LINE_FLASH_MS } from '../../lib/orderTicketMatch'
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
    resetOrderChargeDrafts()
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
    vi.useRealTimers()
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

  it('el borrador de cobro sobrevive al desmonte y no se mezcla entre pedidos', async () => {
    const user = userEvent.setup()
    const view = render(<OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />)
    expect(await screen.findByText('Update 3')).toBeInTheDocument()

    await openCharge(user, 'Update 3', 'order-ready-1')
    await user.type(screen.getByLabelText('Peso de Asado'), '2,5')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('heading', { name: 'Cobrar pedido' })).not.toBeInTheDocument()

    view.unmount()
    expect(loadOrderChargeDraft('ready-1')?.[0]?.qtyRaw).toBe('2,5')
    expect(loadOrderChargeDraft('pend-1')).toBeNull()

    const again = render(<OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />)
    expect(await screen.findByText('Update 4')).toBeInTheDocument()
    await openCharge(user, 'Update 4', 'order-pend-1')
    expect(screen.getByLabelText('Peso de Asado')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await openCharge(user, 'Update 3', 'order-ready-1')
    expect(screen.getByLabelText('Peso de Asado')).toHaveValue('2,5')
    const weight = screen.getByLabelText('Peso de Asado')
    await user.clear(weight)
    await user.type(weight, '3')
    again.unmount()
    expect(loadOrderChargeDraft('ready-1')?.[0]?.qtyRaw).toBe('3')
  })

  it('pasar al POS conserva el borrador; cancelar el cobro ahí no lo borra', async () => {
    const user = userEvent.setup()
    render(
      <OrdersScreen
        isAdmin={false}
        onBack={() => {}}
        currentShiftId="shift-1"
        onInjectOrderCart={() => {}}
      />,
    )
    expect(await screen.findByText('Update 3')).toBeInTheDocument()

    await openCharge(user, 'Update 3', 'order-ready-1')
    await user.type(screen.getByLabelText('Peso de Asado'), '2,5')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await openCharge(user, 'Update 3', 'order-ready-1')
    expect(screen.getByLabelText('Peso de Asado')).toHaveValue('2,5')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(loadOrderChargeDraft('ready-1')?.[0]?.qtyRaw).toBe('2,5')

    await openCharge(user, 'Update 3', 'order-ready-1')
    expect(screen.getByLabelText('Peso de Asado')).toHaveValue('2,5')
  })

  it('resalta una sola fila 1,5 s y corta el tiempo de la anterior', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(window.hw.getProducts).mockResolvedValue({
      ok: true,
      data: [
        { id: 'p1', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, price: 20000 },
        { id: 'p9', name: 'Ala', category: 'beef_cut', unit: 'kg', pluNumber: 9, price: 8000 },
      ],
    })
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
    render(<OrdersScreen isAdmin={false} onBack={() => {}} currentShiftId="shift-1" />)
    expect(await screen.findByText('Update 3')).toBeInTheDocument()

    await openCharge(user, 'Update 3', 'order-ready-1')
    scanBarcode(kretzBarcode(1, 10000))
    expect(document.querySelector('[data-charge-line="0"] [data-charge-flash]')).toBeTruthy()
    expect(document.querySelectorAll('[data-charge-flash]')).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    scanBarcode(kretzBarcode(9, 8000))
    expect(document.querySelector('[data-charge-line="0"] [data-charge-flash]')).toBeNull()
    expect(document.querySelector('[data-charge-line="1"] [data-charge-flash]')).toBeTruthy()
    expect(document.querySelectorAll('[data-charge-flash]')).toHaveLength(1)

    const rows = [...document.querySelectorAll('[data-charge-line]')].map(row => row.textContent ?? '')
    expect(rows[0]).toMatch(/Asado/)
    expect(rows[1]).toMatch(/Ala/)
    expect(rows[1]).toMatch(/Extra/)
    expect(rows[0]).not.toMatch(/Extra/)

    await act(async () => {
      vi.advanceTimersByTime(1400)
    })
    expect(document.querySelector('[data-charge-line="1"] [data-charge-flash]')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(document.querySelector('[data-charge-flash]')).toBeNull()
    expect(CHARGE_LINE_FLASH_MS).toBe(1500)
  })
})

async function openCharge(
  user: ReturnType<typeof userEvent.setup>,
  customerName: string,
  orderDomId: string,
) {
  const card = document.getElementById(orderDomId)
  if (!card) throw new Error(`No está la tarjeta ${orderDomId}`)
  if (!within(card).queryByRole('button', { name: 'Cobrar' })) {
    await user.click(screen.getByText(customerName))
  }
  const openCard = document.getElementById(orderDomId)
  if (!openCard) throw new Error(`No está la tarjeta ${orderDomId}`)
  await user.click(within(openCard).getByRole('button', { name: 'Cobrar' }))
  expect(await screen.findByRole('heading', { name: 'Cobrar pedido' })).toBeInTheDocument()
}

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
