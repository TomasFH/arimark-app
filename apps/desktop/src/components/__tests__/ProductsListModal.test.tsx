import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductsListModal from '../ProductsListModal'

const PRODUCT = {
  id: 'p1',
  name: 'Asado',
  category: 'beef_cut' as const,
  unit: 'kg' as const,
  pluNumber: 1,
  active: true,
  price: 18000,
  available: true,
}

function mockHw(overrides?: Partial<typeof window.hw>) {
  window.hw = {
    getAllProducts: vi.fn().mockResolvedValue({ ok: true, data: [PRODUCT] }),
    getStores: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 's1', name: 'San Martín' }] }),
    onCatalogSyncUpdated: vi.fn(() => () => {}),
    setProductAvailability: vi.fn().mockImplementation(() => new Promise(() => {})),
    listCatalogAudit: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getProductPriceHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    ...overrides,
  } as unknown as typeof window.hw
}

describe('ProductsListModal — catálogo en POS', () => {
  beforeEach(() => {
    mockHw()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('muestra alta, cargar en balanza y no muestra Versiones', async () => {
    render(<ProductsListModal storeId="s1" storeName="San Martín" onClose={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'Catálogo de productos' })).toBeInTheDocument()
    expect(await screen.findByText('Asado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar en balanza' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Nuevo producto' })).toBeInTheDocument()
    expect(screen.queryByText('Versiones')).not.toBeInTheDocument()
    expect(screen.queryByText('Quitar del catálogo (libera el PLU en todos los locales)')).not.toBeInTheDocument()
  })

  it('ignora un segundo clic en disponibilidad mientras el IPC no responde', async () => {
    const user = userEvent.setup()
    render(<ProductsListModal storeId="s1" storeName="San Martín" onClose={() => {}} />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.click(toggle)
    expect(window.hw.setProductAvailability).toHaveBeenCalledTimes(1)
    expect(toggle).toBeDisabled()

    await user.click(toggle)
    expect(window.hw.setProductAvailability).toHaveBeenCalledTimes(1)
  })
})
