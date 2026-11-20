import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mondayWeekRange, transferOccurredAt } from '@carniceria/shared'
import StoreTransfersScreen from '../StoreTransfersScreen'
import type { StoreTransferRow } from '../../types/hw-api'

const ROW: StoreTransferRow = {
  id: '11111111-1111-4111-8111-111111111111',
  productName: 'Vacío',
  quantity: 4,
  unit: 'kg',
  fromStoreId: 'norte',
  toStoreId: 'sur',
  occurredAt: transferOccurredAt('2026-11-15') ?? '',
  notes: null,
  estimatedValue: 15000,
  status: 'pending',
  receivedQuantity: null,
  hasDifference: false,
  confirmedAt: null,
  confirmedBy: null,
  createdAt: '2026-11-20T15:00:00.000Z',
  createdBy: 'ana',
}

describe('StoreTransfersScreen', () => {
  beforeEach(() => {
    window.hw = {
      getStores: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: 'norte', name: 'Norte' },
          { id: 'sur', name: 'Sur' },
        ],
      }),
      listStoreTransfers: vi.fn().mockResolvedValue({ ok: true, data: [ROW] }),
      createStoreTransfer: vi.fn().mockResolvedValue({ ok: true, data: { id: 'nuevo' } }),
      confirmStoreTransfer: vi.fn().mockResolvedValue({ ok: true, data: { hasDifference: false } }),
      getUiSettings: vi.fn().mockResolvedValue({ ok: true, data: { zoomFactor: 1, colorScheme: 'light' } }),
      setUiSettings: vi.fn().mockResolvedValue({ ok: true }),
      onUiSettingsChanged: vi.fn(() => () => undefined),
    } as unknown as typeof window.hw
  })

  it('abre con la lista ya guardada y Actualizar vuelve a pedirla', async () => {
    const user = userEvent.setup()
    const week = mondayWeekRange(0)
    render(<StoreTransfersScreen session={{ userId: 'ana', role: 'cashier', storeId: 'norte' }} onBack={vi.fn()} onLogout={vi.fn()} />)

    expect(await screen.findByText('Vacío')).toBeInTheDocument()
    expect(screen.getAllByText(/Valor estimado/).length).toBeGreaterThan(0)
    expect(window.hw.listStoreTransfers).toHaveBeenCalledTimes(1)
    expect(window.hw.listStoreTransfers).toHaveBeenCalledWith({
      startIso: week.startIso,
      endIso: week.endIso,
      refresh: false,
    })

    await user.click(screen.getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(window.hw.listStoreTransfers).toHaveBeenCalledTimes(2))
    expect(window.hw.listStoreTransfers).toHaveBeenLastCalledWith({
      startIso: week.startIso,
      endIso: week.endIso,
      refresh: true,
    })
  })

  it('guarda sin valor estimado y confirma la cantidad recibida', async () => {
    const user = userEvent.setup()
    render(<StoreTransfersScreen session={{ userId: 'ana', role: 'cashier', storeId: 'norte' }} onBack={vi.fn()} onLogout={vi.fn()} />)
    await screen.findByText('Vacío')

    expect((await screen.findAllByRole('option', { name: 'Norte' })).length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText('Producto'), 'Asado')
    await user.type(screen.getByLabelText('Cantidad'), '2')
    await user.selectOptions(screen.getByLabelText('Sale de'), 'norte')
    await user.selectOptions(screen.getByLabelText('Llega a'), 'sur')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(window.hw.createStoreTransfer).toHaveBeenCalled())
    expect(window.hw.createStoreTransfer).toHaveBeenCalledWith(expect.objectContaining({
      productName: 'Asado',
      quantity: 2,
      unit: 'kg',
      fromStoreId: 'norte',
      toStoreId: 'sur',
      estimatedValue: null,
    }))

    await user.type(screen.getByLabelText('Cantidad recibida de Vacío'), '4')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(window.hw.confirmStoreTransfer).toHaveBeenCalledWith({
      id: ROW.id,
      receivedQuantity: 4,
    }))
  })
})
