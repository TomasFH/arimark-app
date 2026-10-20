import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CatalogQuickSearch from '../CatalogQuickSearch'
import type { AdminProductRow } from '../../types/hw-api'

const PRODUCTS: AdminProductRow[] = [
  {
    id: 'p1',
    name: 'Asado',
    category: 'beef_cut',
    unit: 'kg',
    pluNumber: 10,
    active: true,
    price: 15000,
    available: true,
  },
  {
    id: 'p2',
    name: 'Asado de tira',
    category: 'beef_cut',
    unit: 'kg',
    pluNumber: 12,
    active: true,
    price: 16000,
    available: true,
  },
  {
    id: 'p3',
    name: 'Vacío',
    category: 'beef_cut',
    unit: 'unit',
    pluNumber: 20,
    active: true,
    price: 18000,
    available: false,
  },
]

function installHw() {
  const getAllProducts = vi.fn().mockResolvedValue({ ok: true, data: PRODUCTS })
  const createSale = vi.fn()
  window.hw = {
    getAllProducts,
    createSale,
    onCatalogSyncUpdated: vi.fn(() => () => {}),
  } as unknown as typeof window.hw
  return { getAllProducts, createSale }
}

function pressCtrlF(target: EventTarget = document) {
  return fireEvent.keyDown(target, { key: 'f', ctrlKey: true, code: 'KeyF' })
}

async function openSearch() {
  expect(pressCtrlF()).toBe(false)
  const input = await screen.findByRole('textbox', { name: 'Nombre o PLU' })
  await waitFor(() => expect(input).toHaveFocus())
  return input
}

describe('CatalogQuickSearch', () => {
  beforeEach(() => {
    installHw()
  })

  afterEach(() => {
    cleanup()
  })

  it('Ctrl+F abre y el campo queda con foco', async () => {
    render(<CatalogQuickSearch storeId="s1" />)
    await openSearch()
    expect(screen.getByRole('dialog', { name: 'Buscar en el catálogo' })).toBeInTheDocument()
  })

  it('Ctrl+F de nuevo, Escape y el clic en el fondo cierran', async () => {
    const under = vi.fn()
    render(
      <>
        <button type="button" onClick={under}>Cobrar</button>
        <CatalogQuickSearch storeId="s1" />
      </>,
    )
    const cobrar = screen.getByRole('button', { name: 'Cobrar' })
    cobrar.focus()

    await openSearch()
    expect(pressCtrlF()).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Buscar en el catálogo' })).not.toBeInTheDocument()
    expect(cobrar).toHaveFocus()

    cobrar.focus()
    await openSearch()
    expect(fireEvent.keyDown(document, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Buscar en el catálogo' })).not.toBeInTheDocument()
    expect(cobrar).toHaveFocus()

    await openSearch()
    fireEvent.click(document.querySelector('[data-catalog-search-backdrop]') as Element)
    expect(screen.queryByRole('dialog', { name: 'Buscar en el catálogo' })).not.toBeInTheDocument()
    expect(under).not.toHaveBeenCalled()
  })

  it('Escape no sigue hacia abajo', async () => {
    const bubble = vi.fn()
    document.addEventListener('keydown', bubble)
    render(<CatalogQuickSearch storeId="s1" />)
    await openSearch()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(bubble).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Buscar en el catálogo' })).not.toBeInTheDocument()
    document.removeEventListener('keydown', bubble)
  })

  it('la flecha abajo marca la siguiente fila', async () => {
    render(<CatalogQuickSearch storeId="s1" />)
    const input = await openSearch()
    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.change(input, { target: { value: 'asa' } })

    const asado = screen.getByText('Asado').closest('li')
    const tira = screen.getByText('Asado de tira').closest('li')
    expect(asado).toHaveAttribute('data-catalog-marked', 'true')
    expect(asado).toHaveClass('bg-accent-soft')
    expect(tira).not.toHaveClass('bg-accent-soft')

    fireEvent.keyDown(document, { key: 'ArrowDown' })

    expect(tira).toHaveAttribute('data-catalog-marked', 'true')
    expect(tira).toHaveClass('bg-accent-soft')
    expect(asado).not.toHaveClass('bg-accent-soft')
  })

  it('Enter no llama a nada que venda o confirme', async () => {
    const { createSale } = installHw()
    const confirm = vi.fn()
    document.addEventListener('keydown', confirm)
    render(
      <>
        <button type="button">Confirmar cobro</button>
        <CatalogQuickSearch storeId="s1" />
      </>,
    )
    const input = await openSearch()
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.change(input, { target: { value: 'asado' } })

    expect(fireEvent.keyDown(document, { key: 'Enter' })).toBe(false)

    expect(confirm).not.toHaveBeenCalled()
    expect(createSale).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Buscar en el catálogo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar cobro' })).toBeInTheDocument()
    document.removeEventListener('keydown', confirm)
  })

  it('sin sesión de cajera o sin local no abre', () => {
    const { getAllProducts } = installHw()
    const { unmount } = render(<p>Login</p>)

    expect(pressCtrlF()).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Buscar en el catálogo' })).not.toBeInTheDocument()

    unmount()
    render(<CatalogQuickSearch storeId={null} />)

    expect(pressCtrlF()).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Buscar en el catálogo' })).not.toBeInTheDocument()
    expect(getAllProducts).not.toHaveBeenCalled()
  })

  it('el producto no disponible sigue en la lista, en muted', async () => {
    render(<CatalogQuickSearch storeId="s1" />)
    const input = await openSearch()
    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.change(input, { target: { value: 'vacio' } })

    const row = screen.getByTitle('Vacío').closest('li')
    expect(row).toHaveTextContent('20')
    expect(row).toHaveTextContent('por unidad')
    expect(row).toHaveClass('text-muted')
  })
})
