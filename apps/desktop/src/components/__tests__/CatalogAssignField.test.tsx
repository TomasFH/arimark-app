import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CatalogAssignField from '../CatalogAssignField'
import type { ProductRow } from '../../types/hw-api'

const products: ProductRow[] = [
  { id: 'a', pluNumber: 5, name: 'Vacío', category: 'beef_cut', unit: 'kg', price: 21000 },
  { id: 'b', pluNumber: 999, name: 'Otros', category: 'other', unit: 'kg', price: null },
]

describe('CatalogAssignField', () => {
  it('sugiere por la primera letra y por el primer número', async () => {
    const user = userEvent.setup()
    const onAssign = vi.fn()
    render(<CatalogAssignField products={products} onAssign={onAssign} />)
    const input = screen.getByRole('textbox')

    await user.type(input, 'v')
    expect(screen.getByRole('button', { name: /Vacío/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Otros/ })).not.toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '9')
    expect(screen.getByRole('button', { name: /Otros/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Otros/ }))
    expect(onAssign).toHaveBeenCalledWith(products[1])
  })

  it('las flechas marcan sin mover el cursor, Enter asigna y la fila pide scroll', async () => {
    const user = userEvent.setup()
    const onAssign = vi.fn()
    const aguja: ProductRow = { id: 'aguja', pluNumber: 6, name: 'Aguja', category: 'beef_cut', unit: 'kg', price: 16000 }
    const asado: ProductRow = { id: 'asado', pluNumber: 5, name: 'Asado', category: 'beef_cut', unit: 'kg', price: 18000 }
    render(<CatalogAssignField products={[aguja, asado]} onAssign={onAssign} />)
    const input = screen.getByRole('textbox')
    await user.type(input, 'a')
    expect(await screen.findByRole('button', { name: /Aguja/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aguja/ })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: /Asado/ })).toHaveAttribute('tabindex', '-1')

    const field = input as HTMLInputElement
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
      const marked = document.querySelector<HTMLElement>('[data-assign-marked="true"]')
      expect(marked).toHaveTextContent('Asado')
      expect(marked).toHaveClass('w-full', 'bg-accent-soft')
      expect(calls.at(-1)).toBe(marked)
      expect(seen.at(-1)).toEqual({ block: 'nearest' })

      fireEvent.keyDown(field, { key: 'Tab' })
      expect(document.querySelector('[data-assign-marked="true"]')).toHaveTextContent('Asado')

      calls.length = 0
      field.setSelectionRange(field.value.length, field.value.length)
      expect(fireEvent.keyDown(field, { key: 'ArrowUp' })).toBe(false)
      expect(field.selectionStart).toBe(field.value.length)
      const back = document.querySelector<HTMLElement>('[data-assign-marked="true"]')
      expect(back).toHaveTextContent('Aguja')
      expect(calls.at(-1)).toBe(back)

      expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
      expect(onAssign).toHaveBeenCalledWith(aguja)
    } finally {
      field.removeEventListener('keydown', onKey)
      HTMLElement.prototype.scrollIntoView = previousScroll
    }
  })
})
