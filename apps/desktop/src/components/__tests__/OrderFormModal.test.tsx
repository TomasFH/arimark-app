import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import OrderFormModal from '../OrderFormModal'
import { todayLocalYmd } from '../../lib/datetime'
import {
  getOrderCreateDraft,
  resetOrderCreateDraft,
  seedOrderCreateDraft,
  updateOrderCreateDraft,
} from '../../lib/orderCreateDraft'
import type { OrderRow, ProductRow, StoreRow } from '../../types/hw-api'

const NO_STORES: StoreRow[] = []

const MORCILLA: ProductRow = {
  id: 'p-mor',
  name: 'Morcilla',
  category: 'other',
  unit: 'unit',
  pluNumber: 12,
  price: 2500,
}

function sampleOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'o1',
    storeId: 's1',
    customerName: 'Pedido Juan',
    phone: null,
    items: 'Morcilla · 2 u',
    pickupDate: todayLocalYmd(),
    timeSlot: null,
    pickupTime: null,
    priority: false,
    status: 'pending',
    notes: null,
    depositAmount: 0,
    depositPayments: null,
    depositMethod: null,
    createdAt: '2026-10-11T12:00:00.000Z',
    createdBy: 'Ana',
    updatedAt: null,
    updatedBy: null,
    readyAt: null,
    readyBy: null,
    readyByName: null,
    budgetItems: [{
      productId: 'p-mor',
      name: 'Morcilla',
      unit: 'unit',
      pluNumber: 12,
      estimatedQty: 2,
      unitPrice: 2500,
    }],
    ...overrides,
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderModal(ui: ReactElement): Promise<RenderResult> {
  const view = render(ui)
  await settle()
  return view
}

function overlay(): HTMLElement {
  const el = document.querySelector('[data-modal-overlay]')
  if (!(el instanceof HTMLElement)) throw new Error('No está el overlay del modal')
  return el
}

function installHw(): { createOrder: ReturnType<typeof vi.fn>; updateOrder: ReturnType<typeof vi.fn> } {
  const createOrder = vi.fn().mockResolvedValue({ ok: true, data: sampleOrder({ id: 'new-1', customerName: 'Casa Lopez' }) })
  const updateOrder = vi.fn().mockResolvedValue({ ok: true, data: sampleOrder() })
  window.hw = {
    getProducts: vi.fn().mockResolvedValue({ ok: true, data: [MORCILLA] }),
    getPieceWeights: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    setPieceWeights: vi.fn().mockResolvedValue({ ok: true, data: { saved: 0 } }),
    getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createOrder,
    updateOrder,
  } as unknown as typeof window.hw
  return { createOrder, updateOrder }
}

function mockSuggestLayout(): void {
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
}

async function fillMinimum(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByPlaceholderText('Ej: Restaurante El Sol'), 'Casa Lopez')
  await user.type(screen.getByPlaceholderText('Buscar producto…'), 'Mor')
  await user.click(await screen.findByRole('button', { name: /Morcilla/ }))
  await user.type(screen.getByTitle('Cantidad'), '2')
}

describe('OrderFormModal — borrador de alta', () => {
  beforeEach(() => {
    resetOrderCreateDraft()
    installHw()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cerrar con Escape, Cancelar o la X no borra el borrador', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = await renderModal(
      <OrderFormModal
        open
        mode="create"
        onClose={onClose}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )

    const name = await screen.findByPlaceholderText('Ej: Restaurante El Sol')
    await user.type(name, 'Borrador Ana')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getOrderCreateDraft().customerName).toBe('Borrador Ana')

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(getOrderCreateDraft().customerName).toBe('Borrador Ana')

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(getOrderCreateDraft().customerName).toBe('Borrador Ana')

    rerender(
      <OrderFormModal
        open={false}
        mode="create"
        onClose={onClose}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )
    rerender(
      <OrderFormModal
        open
        mode="create"
        onClose={onClose}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )
    await settle()
    expect(await screen.findByPlaceholderText('Ej: Restaurante El Sol')).toHaveValue('Borrador Ana')
  })

  it('un clic que empieza y termina en el overlay cierra sin resetear', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    await renderModal(
      <OrderFormModal
        open
        mode="create"
        onClose={onClose}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )
    await user.type(await screen.findByPlaceholderText('Ej: Restaurante El Sol'), 'Borrador Ana')

    fireEvent.click(overlay())
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(overlay(), { button: 0 })
    fireEvent.pointerUp(overlay(), { button: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getOrderCreateDraft().customerName).toBe('Borrador Ana')
  })

  it('un arrastre que empieza adentro del modal no lo cierra', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    await renderModal(
      <OrderFormModal
        open
        mode="create"
        onClose={onClose}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )
    const name = await screen.findByPlaceholderText('Ej: Restaurante El Sol')
    await user.type(name, 'Borrador Ana')

    fireEvent.pointerDown(name, { button: 0 })
    fireEvent.pointerUp(overlay(), { button: 0 })
    fireEvent.click(overlay())

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Nuevo pedido' })).toBeInTheDocument()
    expect(getOrderCreateDraft().customerName).toBe('Borrador Ana')
  })

  it('Borrar borrador vacía el alta y deja el modal abierto', async () => {
    const user = userEvent.setup()
    await renderModal(
      <OrderFormModal
        open
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Borrar borrador' })).not.toBeInTheDocument()
    await user.type(await screen.findByPlaceholderText('Ej: Restaurante El Sol'), 'Borrador Ana')
    await user.click(screen.getByRole('button', { name: 'Borrar borrador' }))

    expect(screen.getByRole('dialog', { name: 'Nuevo pedido' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ej: Restaurante El Sol')).toHaveValue('')
    expect(screen.getByDisplayValue(todayLocalYmd())).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Borrar borrador' })).not.toBeInTheDocument()
    expect(getOrderCreateDraft().customerName).toBe('')
  })

  it('guardar limpia el borrador', async () => {
    mockSuggestLayout()
    const user = userEvent.setup()
    const { createOrder } = installHw()
    const onClose = vi.fn()
    const onSaved = vi.fn()
    await renderModal(
      <OrderFormModal
        open
        mode="create"
        onClose={onClose}
        onSaved={onSaved}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )

    await fillMinimum(user)
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }))

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1))
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      customerName: 'Casa Lopez',
      items: 'Morcilla · 2 u',
      pickupDate: todayLocalYmd(),
      budgetItems: [expect.objectContaining({ name: 'Morcilla', estimatedQty: 2, unit: 'unit' })],
    }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-1' }), 'create')
    expect(onClose).toHaveBeenCalled()
    expect(getOrderCreateDraft().customerName).toBe('')
    expect(getOrderCreateDraft().pickupDate).toBe('')
    expect(getOrderCreateDraft().budgetCart).toEqual([])
  })

  it('la seña pide confirmación y no se guarda hasta confirmar', async () => {
    mockSuggestLayout()
    const user = userEvent.setup()
    const { createOrder } = installHw()
    await renderModal(
      <OrderFormModal
        open
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )

    await fillMinimum(user)
    const efectivo = screen.getByText('Efectivo').parentElement?.querySelector('input')
    if (!(efectivo instanceof HTMLInputElement)) throw new Error('Falta el campo de seña en efectivo')
    await user.type(efectivo, '1500')
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }))

    expect(await screen.findByRole('dialog', { name: 'Confirmar pedido con seña' })).toBeInTheDocument()
    expect(createOrder).not.toHaveBeenCalled()
    expect(getOrderCreateDraft().customerName).toBe('Casa Lopez')

    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1))
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      depositAmount: 1500,
      depositPayments: [{ method: 'cash', amount: 1500 }],
    }))
    expect(getOrderCreateDraft().customerName).toBe('')
  })

  it('editar un pedido guardado no pisa el borrador de alta', async () => {
    const user = userEvent.setup()
    const { updateOrder } = installHw()
    seedOrderCreateDraft('s9')
    updateOrderCreateDraft(prev => ({ ...prev, customerName: 'Borrador Ana' }))

    const onClose = vi.fn()
    await renderModal(
      <OrderFormModal
        open
        mode="edit"
        editingOrder={sampleOrder()}
        onClose={onClose}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Editar pedido' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ej: Restaurante El Sol')).toHaveValue('Pedido Juan')
    expect(screen.queryByRole('button', { name: 'Borrar borrador' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(updateOrder).toHaveBeenCalledTimes(1))
    expect(updateOrder).toHaveBeenCalledWith(expect.objectContaining({
      id: 'o1',
      customerName: 'Pedido Juan',
    }))
    expect(onClose).toHaveBeenCalled()
    expect(getOrderCreateDraft().customerName).toBe('Borrador Ana')
    expect(getOrderCreateDraft().storeId).toBe('s9')
  })
})

describe('OrderFormModal — teclado de productos', () => {
  const ASADO: ProductRow = {
    id: 'p-asado',
    name: 'Asado',
    category: 'beef_cut',
    unit: 'kg',
    pluNumber: 5,
    price: 18000,
  }

  beforeEach(() => {
    resetOrderCreateDraft()
    installHw()
    mockSuggestLayout()
    window.hw.getProducts = vi.fn().mockResolvedValue({ ok: true, data: [MORCILLA, ASADO] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function openCreate(): Promise<void> {
    await renderModal(
      <OrderFormModal
        open
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        showStoreFilter={false}
        stores={NO_STORES}
      />,
    )
  }

  it('las flechas recorren las opciones y Enter agrega la marcada', async () => {
    const user = userEvent.setup()
    await openCreate()
    const search = await screen.findByPlaceholderText('Buscar producto…')
    await user.type(search, 'a')
    expect(await screen.findByRole('button', { name: /Morcilla/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Asado/ })).toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getByPlaceholderText('Observaciones del pedido…')).not.toHaveFocus()
    const marked = screen.getAllByRole('button').find(button => button.classList.contains('bg-accent-soft'))
    expect(marked).toBeTruthy()
    const added = marked?.textContent?.includes('Asado') ? 'Asado' : 'Morcilla'
    const qtyTitle = added === 'Asado' ? 'Peso estimado' : 'Cantidad'

    fireEvent.keyDown(search, { key: 'Enter' })
    expect(await screen.findByText(added)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTitle(qtyTitle)).toHaveFocus())
  })

  it('Tab pasa de kilos a unidades y de ahí a buscar', async () => {
    const user = userEvent.setup()
    await openCreate()
    const search = await screen.findByPlaceholderText('Buscar producto…')
    await user.type(search, 'Asa')
    fireEvent.keyDown(search, { key: 'Enter' })
    const kg = await screen.findByTitle('Peso estimado')
    await waitFor(() => expect(kg).toHaveFocus())

    await user.tab()
    expect(screen.getByTitle('Unidades pedidas (opcional). Vacío = pidió kilos.')).toHaveFocus()

    await user.tab()
    expect(search).toHaveFocus()
  })

  it('Enter en el peso vuelve a buscar y Supr quita la línea', async () => {
    const user = userEvent.setup()
    await openCreate()
    const search = await screen.findByPlaceholderText('Buscar producto…')
    await user.type(search, 'Mor')
    fireEvent.keyDown(search, { key: 'Enter' })
    const qty = await screen.findByTitle('Cantidad')

    fireEvent.keyDown(qty, { key: 'Enter' })
    expect(search).toHaveFocus()

    qty.focus()
    fireEvent.keyDown(qty, { key: 'Delete' })
    expect(screen.queryByTitle('Cantidad')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nuevo pedido' })).toBeInTheDocument()
  })

  it('Ctrl+Enter desde el nombre enfoca la búsqueda', async () => {
    await openCreate()
    const name = await screen.findByPlaceholderText('Ej: Restaurante El Sol')
    name.focus()
    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true })
    expect(screen.getByPlaceholderText('Buscar producto…')).toHaveFocus()
  })

  it('Escape cierra la lista y deja el pedido abierto', async () => {
    const user = userEvent.setup()
    await openCreate()
    const search = await screen.findByPlaceholderText('Buscar producto…')
    await user.type(search, 'Mor')
    expect(await screen.findByRole('button', { name: /Morcilla/ })).toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Morcilla/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nuevo pedido' })).toBeInTheDocument()
  })
})
