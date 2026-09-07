import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrdersScreen from '../OrdersScreen'
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

    await user.click(screen.getByRole('button', { name: /Entregados y cancelados/ }))
    expect(await screen.findByText('Cliente reclamo')).toBeInTheDocument()
    expect(screen.queryByText('Update 3')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Entregados y cancelados/ }))
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
    expect(screen.queryByText(/Listo por/)).not.toBeInTheDocument()

    vi.mocked(window.hw.listOrders).mockResolvedValue({
      ok: true,
      data: [
        order({ id: 'ready-1', pickupDate: '2026-09-02', status: 'ready', customerName: 'Update 3', readyAt: '2026-09-02T12:00:00.000Z', readyByName: 'Carnicero' }),
        ready,
      ],
    })
    onSync?.()

    expect(await screen.findByText(/Listo por/)).toBeInTheDocument()
    expect(screen.getByText('Juan')).toBeInTheDocument()
  })
})
