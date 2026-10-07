import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
