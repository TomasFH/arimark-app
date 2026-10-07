import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminScreen, { ProductFormModal } from '../AdminScreen'
import type { AdminProductRow, SessionInfo } from '../../types/hw-api'

const CASHIER: SessionInfo = {
  role: 'cashier',
  userId: 'u-cashier',
  storeId: 's1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  displayName: 'Cajera',
}

const ADMIN: SessionInfo = {
  role: 'admin',
  userId: 'u-admin',
  storeId: 's1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  displayName: 'Admin',
}

function mockHw() {
  window.hw = {
    getStores: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 's1', name: 'Local A' },
        { id: 's2', name: 'Local B' },
      ],
    }),
    getAllProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    onCatalogSyncUpdated: vi.fn(() => () => {}),
    listCatalogAudit: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getProductPriceHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  } as unknown as typeof window.hw
}

describe('AdminScreen — permisos de catálogo', () => {
  beforeEach(() => {
    mockHw()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cajera ve Nuevo producto, no Versiones, y Cargar en balanza en el menú', async () => {
    const user = userEvent.setup()
    render(<AdminScreen session={CASHIER} onLogout={() => {}} onReturnToHub={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'Catálogo' })).toBeInTheDocument()
    expect(await screen.findByText('No hay productos cargados.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Nuevo producto' })).toBeInTheDocument()
    expect(screen.queryByText('Versiones')).not.toBeInTheDocument()
    expect(screen.queryByText('Administración — Productos')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Más acciones' }))
    expect(screen.getByRole('menuitem', { name: 'Cargar en balanza' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Versiones' })).not.toBeInTheDocument()
  })

  it('admin ve Cargar en balanza y Versiones en el menú', async () => {
    const user = userEvent.setup()
    render(<AdminScreen session={ADMIN} onLogout={() => {}} onReturnToHub={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'Administración — Productos' })).toBeInTheDocument()
    expect(await screen.findByText('No hay productos cargados.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Nuevo producto' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Más acciones' }))
    expect(screen.getByRole('menuitem', { name: 'Versiones' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Cargar en balanza' })).toBeInTheDocument()
  })
})

describe('ProductFormModal — historial plegado', () => {
  const PRODUCT: AdminProductRow = {
    id: 'p1',
    name: 'Prueba 1',
    category: 'beef_cut',
    unit: 'kg',
    pluNumber: 555,
    active: true,
    price: 55556,
    available: true,
    purchasePackLabel: null,
    purchasePackContents: null,
  }

  beforeEach(() => {
    mockHw()
    window.hw.getAllProducts = vi.fn().mockResolvedValue({ ok: true, data: [PRODUCT] })
    window.hw.listCatalogAudit = vi.fn().mockResolvedValue({
      ok: true,
      data: [{
        id: 'a1',
        productId: 'p1',
        storeId: null,
        action: 'create',
        actorUserId: 'u-admin',
        actorName: 'Admin Prueba',
        summary: 'Alta: Prueba 1 (555)',
        createdAt: '2026-09-02T03:37:00.000Z',
      }],
    })
    window.hw.getProductPriceHistory = vi.fn().mockResolvedValue({
      ok: true,
      data: [{
        id: 'h1',
        price: 55556,
        validFrom: '2026-09-02T03:40:00.000Z',
        validTo: null,
        createdBy: 'Cajera Uno',
      }],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no muestra ficha ni precios hasta pulsar Historial', async () => {
    const user = userEvent.setup()
    render(
      <ProductFormModal
        storeId="s1"
        stores={[{ id: 's1', name: 'Local A' }]}
        product={PRODUCT}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Historial' })).toBeInTheDocument()
    expect(screen.queryByText('Alta: Prueba 1 (555)')).not.toBeInTheDocument()
    expect(screen.queryByText(/Por Cajera Uno/)).not.toBeInTheDocument()
    expect(window.hw.listCatalogAudit).not.toHaveBeenCalled()
    expect(window.hw.getProductPriceHistory).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Historial' }))

    expect(await screen.findByText('Alta: Prueba 1 (555)')).toBeInTheDocument()
    expect(screen.getByText(/Por Cajera Uno/)).toBeInTheDocument()
    expect(window.hw.listCatalogAudit).toHaveBeenCalledWith({ productId: 'p1', storeId: 's1' })
    expect(window.hw.getProductPriceHistory).toHaveBeenCalledWith({ productId: 'p1', storeId: 's1' })
  })
})

describe('ProductFormModal — bolsas en unidad', () => {
  beforeEach(() => {
    mockHw()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function categorySelect() {
    return screen.getAllByRole('combobox')[0] as HTMLSelectElement
  }

  function unitSelect() {
    return screen.getAllByRole('combobox')[1] as HTMLSelectElement
  }

  it('al elegir Bolsas fija Unidad y no deja kg; al salir se puede elegir de nuevo', async () => {
    const user = userEvent.setup()
    render(
      <ProductFormModal
        storeId="s1"
        stores={[{ id: 's1', name: 'Local A' }]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )

    expect(unitSelect()).toHaveValue('kg')
    expect(unitSelect()).toBeEnabled()
    expect(screen.getByRole('option', { name: 'kg (pesable)' })).toBeInTheDocument()

    await user.selectOptions(categorySelect(), 'bags')

    expect(unitSelect()).toHaveValue('unit')
    expect(unitSelect()).toBeDisabled()
    expect(screen.queryByRole('option', { name: 'kg (pesable)' })).not.toBeInTheDocument()

    await user.selectOptions(categorySelect(), 'other')

    expect(unitSelect()).toBeEnabled()
    expect(unitSelect()).toHaveValue('unit')
    expect(screen.getByRole('option', { name: 'kg (pesable)' })).toBeInTheDocument()
    await user.selectOptions(unitSelect(), 'kg')
    expect(unitSelect()).toHaveValue('kg')
  })

  it('el alta de bolsas envía unidad', async () => {
    const user = userEvent.setup()
    window.hw.createProduct = vi.fn().mockResolvedValue({ ok: true, data: { id: 'new-id' } })
    const onSaved = vi.fn()
    render(
      <ProductFormModal
        storeId="s1"
        stores={[{ id: 's1', name: 'Local A' }]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    )

    await user.type(screen.getByPlaceholderText('Nombre del producto'), 'Bolsa camiseta')
    await user.selectOptions(categorySelect(), 'bags')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(window.hw.createProduct).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Bolsa camiseta',
      category: 'bags',
      unit: 'unit',
    }))
    expect(onSaved).toHaveBeenCalled()
  })
})
