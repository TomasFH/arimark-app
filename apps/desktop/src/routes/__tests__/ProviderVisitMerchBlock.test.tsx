import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '../../components/ui'
import ProviderVisitMerchBlock, { formLineFromProduct, type VisitCatalogProduct } from '../ProviderVisitMerchBlock'
import type { MerchVisitFormLine } from '@carniceria/shared'

const aguja: VisitCatalogProduct = { id: 'aguja', name: 'Aguja', unit: 'kg', pluNumber: 6 }
const asado: VisitCatalogProduct = { id: 'asado', name: 'Asado', unit: 'kg', pluNumber: 5 }

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

function renderSearch(products: VisitCatalogProduct[], onChange = vi.fn()) {
  mockSuggestLayout()
  const view = render(
    <Modal open onClose={() => {}} title="Gasto">
      <ProviderVisitMerchBlock products={products} memory={{}} lines={[]} onChange={onChange} />
    </Modal>,
  )
  return { ...view, onChange }
}

describe('ProviderVisitMerchBlock — búsqueda de lo que llegó', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('las flechas marcan la fila, Enter la agrega y la fila pide scroll', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSearch([aguja, asado])
    const field = screen.getByPlaceholderText('Buscar producto…') as HTMLInputElement
    await user.type(field, 'a')

    expect(await screen.findByRole('button', { name: /Aguja/ })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: /Asado/ })).toHaveAttribute('tabindex', '-1')
    expect(document.querySelector('[data-merch-marked="true"]')).toHaveTextContent('Aguja')

    field.setSelectionRange(0, 0)
    const calls: HTMLElement[] = []
    const seen: Array<boolean | ScrollIntoViewOptions | undefined> = []
    const previousScroll = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, arg?: boolean | ScrollIntoViewOptions) {
      calls.push(this)
      seen.push(arg)
    }
    function onKey(event: Event): void {
      if (!(event instanceof KeyboardEvent) || event.defaultPrevented) return
      if (event.key === 'ArrowUp') field.setSelectionRange(0, 0)
      if (event.key === 'ArrowDown') field.setSelectionRange(field.value.length, field.value.length)
    }
    field.addEventListener('keydown', onKey)
    try {
      expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(false)
      expect(field.selectionStart).toBe(0)
      const marked = document.querySelector<HTMLElement>('[data-merch-marked="true"]')
      expect(marked).toHaveTextContent('Asado')
      expect(marked).toHaveClass('w-full', 'bg-accent-soft')
      expect(calls.at(-1)).toBe(marked)
      expect(seen.at(-1)).toEqual({ block: 'nearest' })

      expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
      expect(onChange).toHaveBeenCalledTimes(1)
      const added = onChange.mock.calls[0][0] as MerchVisitFormLine[]
      expect(added).toHaveLength(1)
      expect(added[0].name).toBe('Asado')
      expect(added[0].productId).toBe('asado')
    } finally {
      field.removeEventListener('keydown', onKey)
      HTMLElement.prototype.scrollIntoView = previousScroll
    }
  })

  it('Escape cierra la lista y no el modal; la flecha siguiente elige «No se vende»', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onChange = vi.fn()
    mockSuggestLayout()
    render(
      <Modal open onClose={onClose} title="Gasto">
        <ProviderVisitMerchBlock products={[aguja]} memory={{}} lines={[]} onChange={onChange} />
      </Modal>,
    )
    const field = screen.getByPlaceholderText('Buscar producto…')
    await user.type(field, 'hueso')
    expect(await screen.findByRole('button', { name: /Agregar «hueso»/ })).toBeInTheDocument()

    expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Agregar «hueso»/ })).not.toBeInTheDocument()

    await user.type(field, 's')
    expect(await screen.findByRole('button', { name: /Agregar «huesos»/ })).toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(document.querySelector('[data-merch-marked="true"]')).toHaveTextContent('No se vende')
    fireEvent.keyDown(field, { key: 'Enter' })
    const added = onChange.mock.calls[0][0] as MerchVisitFormLine[]
    expect(added[0].name).toBe('huesos')
    expect(added[0].notForSale).toBe(true)
  })

  it('Ctrl+Enter desde la línea enfoca la búsqueda y no agrega otra', () => {
    const onChange = vi.fn()
    mockSuggestLayout()
    render(
      <Modal open onClose={() => {}} title="Gasto">
        <ProviderVisitMerchBlock
          products={[aguja]}
          memory={{}}
          lines={[formLineFromProduct(aguja)]}
          onChange={onChange}
        />
      </Modal>,
    )
    const kilos = screen.getByLabelText('Kilos')
    kilos.focus()
    expect(fireEvent.keyDown(kilos, { key: 'Enter', ctrlKey: true })).toBe(false)
    expect(screen.getByPlaceholderText('Buscar producto…')).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })
})
