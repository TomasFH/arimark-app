import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
      getAllProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
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

  it('sugiere el corte del catálogo y no la oferta', async () => {
    const user = userEvent.setup()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
      if (this instanceof HTMLInputElement) {
        return {
          x: 16, y: 80, top: 80, bottom: 120, left: 16, right: 320, width: 304, height: 40,
          toJSON() { return {} },
        } as DOMRect
      }
      return {
        x: 0, y: 0, top: 0, bottom: 520, left: 0, right: 360, width: 360, height: 520,
        toJSON() { return {} },
      } as DOMRect
    })
    vi.mocked(window.hw.getAllProducts).mockResolvedValue({
      ok: true,
      data: [
        { id: 'asado', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 5, baseProductId: null, active: true, available: true, price: 10000 },
        { id: 'pack', name: 'Asado x2kg', category: 'beef_cut', unit: 'kg', pluNumber: 301, baseProductId: 'asado', active: true, available: true, price: 15000 },
      ],
    })
    render(<StoreTransfersScreen session={{ userId: 'ana', role: 'cashier', storeId: 'norte' }} onBack={vi.fn()} onLogout={vi.fn()} />)
    await screen.findByText('Vacío')

    const field = screen.getByLabelText('Producto')
    await user.type(field, 'asa')

    expect(await screen.findByRole('button', { name: /Asado/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PLU 5/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Asado x2kg/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /PLU 301/ })).not.toBeInTheDocument()

    expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(false)
    expect(document.querySelector('[data-merch-marked="true"]')).toHaveTextContent('Agregar')
    expect(fireEvent.keyDown(field, { key: 'ArrowUp' })).toBe(false)
    expect(document.querySelector('[data-merch-marked="true"]')).toHaveTextContent('Asado')
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
    expect(field).toHaveValue('Asado')
    expect(screen.queryByRole('button', { name: /PLU 5/ })).not.toBeInTheDocument()
  })

  it('completa el valor estimado con el precio de lista por la cantidad y deja editarlo', async () => {
    const user = userEvent.setup()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
      if (this instanceof HTMLInputElement) {
        return {
          x: 16, y: 80, top: 80, bottom: 120, left: 16, right: 320, width: 304, height: 40,
          toJSON() { return {} },
        } as DOMRect
      }
      return {
        x: 0, y: 0, top: 0, bottom: 520, left: 0, right: 360, width: 360, height: 520,
        toJSON() { return {} },
      } as DOMRect
    })
    vi.mocked(window.hw.getAllProducts).mockResolvedValue({
      ok: true,
      data: [
        { id: 'aceite', name: 'Aceite', category: 'other', unit: 'unit', pluNumber: 555, baseProductId: null, active: true, available: true, price: 10000 },
      ],
    })
    render(<StoreTransfersScreen session={{ userId: 'ana', role: 'cashier', storeId: 'norte' }} onBack={vi.fn()} onLogout={vi.fn()} />)
    await screen.findByText('Vacío')

    await user.type(screen.getByLabelText('Producto'), 'ace')
    await user.click(await screen.findByRole('button', { name: /Aceite/ }))
    await user.type(screen.getByLabelText('Cantidad'), '2')

    expect(screen.getByLabelText('Valor estimado')).toHaveValue('20.000')

    const estimate = screen.getByLabelText('Valor estimado')
    await user.clear(estimate)
    await user.type(estimate, '15000')
    const quantity = screen.getByLabelText('Cantidad')
    await user.clear(quantity)
    await user.type(quantity, '3')
    expect(estimate).toHaveValue('15.000')

    await user.selectOptions(screen.getByLabelText('Sale de'), 'norte')
    await user.selectOptions(screen.getByLabelText('Llega a'), 'sur')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(window.hw.createStoreTransfer).toHaveBeenCalledWith(expect.objectContaining({
      productName: 'Aceite',
      quantity: 3,
      unit: 'u',
      estimatedValue: 15000,
    })))
  })
})
