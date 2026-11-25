import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExpenseModal from '../ExpenseModal'

function mockRects(): void {
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

describe('ExpenseModal — teclado de las listas', () => {
  const onCancel = vi.fn()

  beforeEach(() => {
    onCancel.mockReset()
    mockRects()
    window.hw = {
      listProviders: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: 'guido', name: 'Guido', intakeKind: null },
          { id: 'gustavo', name: 'Gustavo', intakeKind: null },
        ],
      }),
      getExpenseCategories: vi.fn().mockResolvedValue({ ok: true, data: ['Bolsas', 'Limpieza'] }),
      getInitStatus: vi.fn().mockResolvedValue({ ok: true, data: { businessName: 'Nombre del negocio' } }),
      getUserOpenShift: vi.fn().mockResolvedValue({ ok: false }),
      getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getMerchVisitDraft: vi.fn().mockResolvedValue({ ok: true, data: null }),
      getProviderDebt: vi.fn().mockResolvedValue({ ok: true, data: { balance: 0 } }),
      getProviderPurchasePrices: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getAllProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      discardMerchVisitDraft: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('elige el proveedor con flechas y Enter, y Escape cierra la lista', async () => {
    const user = userEvent.setup()
    render(<ExpenseModal onRegistered={vi.fn()} onCancel={onCancel} />)
    const field = await screen.findByPlaceholderText('Nombre del proveedor…')
    await user.type(field, 'g')

    expect(await screen.findByText('Guido')).toBeInTheDocument()
    expect(document.querySelector('[data-suggest-marked="true"]')).toHaveTextContent('Guido')
    expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(false)
    expect(document.querySelector('[data-suggest-marked="true"]')).toHaveTextContent('Gustavo')
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
    expect(field).toHaveValue('Gustavo')
    expect(screen.queryByText('Guido')).not.toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'g')
    expect(await screen.findByText('Guido')).toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByText('Guido')).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Escape' })
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
  })

  it('la mercadería que no se pagó acá pide piezas y kilos, no plata', async () => {
    const user = userEvent.setup()
    render(<ExpenseModal onRegistered={vi.fn()} onCancel={onCancel} />)
    const field = await screen.findByPlaceholderText('Nombre del proveedor…')
    await user.type(field, 'g')
    expect(await screen.findByText('Guido')).toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'Enter' })

    await user.click(await screen.findByRole('tab', { name: 'Entró y no se pagó acá' }))
    expect(screen.getByText('Unidades')).toBeInTheDocument()
    expect(screen.queryByText('Entregado al proveedor ($)')).not.toBeInTheDocument()
    expect(screen.queryByText(/Total de la visita/)).not.toBeInTheDocument()
  })

  it('elige el concepto de Otros con el teclado', async () => {
    const user = userEvent.setup()
    render(<ExpenseModal onRegistered={vi.fn()} onCancel={onCancel} />)
    await screen.findByPlaceholderText('Nombre del proveedor…')
    await user.click(screen.getByRole('tab', { name: 'Otros' }))
    const field = screen.getByPlaceholderText('Bolsas, limpieza…')
    await user.type(field, 'bol')
    expect(await screen.findByText('Bolsas')).toBeInTheDocument()
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
    expect(field).toHaveValue('Bolsas')
  })

  it('elige el concepto de insumos con el teclado', async () => {
    const user = userEvent.setup()
    vi.mocked(window.hw.listProviders).mockResolvedValue({
      ok: true,
      data: [{ id: 'papel', name: 'Papelera', intakeKind: 'insumos' }],
    })
    render(<ExpenseModal onRegistered={vi.fn()} onCancel={onCancel} />)
    const provider = await screen.findByPlaceholderText('Nombre del proveedor…')
    await user.type(provider, 'pap')
    expect(await screen.findByText('Papelera')).toBeInTheDocument()
    fireEvent.keyDown(provider, { key: 'Enter' })
    expect(provider).toHaveValue('Papelera')

    const concept = screen.getAllByPlaceholderText('Bolsas, limpieza…')
      .find(field => field.closest('[aria-hidden="true"]') == null)
    expect(concept).toBeTruthy()
    await user.type(concept!, 'bol')
    expect(await screen.findByText('Bolsas')).toBeInTheDocument()
    fireEvent.keyDown(concept!, { key: 'Enter' })
    expect(concept).toHaveValue('Bolsas')
  })
})
