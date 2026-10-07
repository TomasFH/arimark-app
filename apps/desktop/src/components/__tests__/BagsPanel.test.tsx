import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BagsPanel from '../BagsPanel'
import type { ProductRow } from '../../types/hw-api'

const bag: ProductRow = {
  id: 'bag-1',
  pluNumber: 80,
  name: 'Bolsa chica',
  category: 'bags',
  unit: 'unit',
  price: 200,
}

const bagLarge: ProductRow = {
  id: 'bag-2',
  pluNumber: 81,
  name: 'Bolsa grande con nombre largo para el mostrador',
  category: 'bags',
  unit: 'unit',
  price: 500,
}

const meat: ProductRow = {
  id: 'meat-1',
  pluNumber: 10,
  name: 'Asado',
  category: 'beef_cut',
  unit: 'kg',
  price: 8000,
}

describe('BagsPanel', () => {
  it('avisa si no hay bolsas cargadas', async () => {
    const user = userEvent.setup()
    render(<BagsPanel products={[]} lines={[]} onAdd={() => {}} onRemove={() => {}} />)
    const toggle = screen.getByRole('button', { name: 'Añadir bolsas' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('No hay bolsas en el catálogo.')).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByText('No hay bolsas en el catálogo.')).not.toBeInTheDocument()
  })

  it('muestra todas las bolsas y suma o saca de a una', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onRemove = vi.fn()
    render(
      <BagsPanel
        products={[meat, bag, bagLarge]}
        lines={[{ productId: 'bag-1', weightKg: 2, unit: 'unit' }]}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Añadir bolsas' }))

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Asado')).not.toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Bolsas' })
    expect(list).toHaveClass('max-h-48', 'overflow-y-auto')

    const longName = screen.getByText(bagLarge.name)
    expect(longName).toHaveClass('truncate')
    expect(longName).toHaveAttribute('title', bagLarge.name)
    const chica = screen.getByText('Bolsa chica').closest('li')
    const grande = longName.closest('li')
    if (!chica || !grande) throw new Error('falta la fila de la bolsa')
    expect(chica).toHaveTextContent(/\$\s*200/)
    expect(within(chica).getByLabelText('Cantidad de Bolsa chica')).toHaveTextContent(/^2$/)
    expect(grande).toHaveTextContent(/\$\s*500/)
    expect(within(grande).getByLabelText(`Cantidad de ${bagLarge.name}`)).toHaveTextContent(/^0$/)
    expect(screen.getByRole('button', { name: `Sacar ${bagLarge.name}` })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Sumar Bolsa chica' }))
    expect(onAdd).toHaveBeenCalledWith(bag, 1)
    await user.click(screen.getByRole('button', { name: 'Sacar Bolsa chica' }))
    expect(onRemove).toHaveBeenCalledWith('bag-1', 1)
    await user.click(screen.getByRole('button', { name: `Sumar ${bagLarge.name}` }))
    expect(onAdd).toHaveBeenCalledWith(bagLarge, 1)
  })

  it('no suma una bolsa sin precio de lista', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const noPrice: ProductRow = { ...bag, id: 'bag-free', name: 'Bolsa sin precio', price: null }
    const zeroPrice: ProductRow = { ...bag, id: 'bag-zero', name: 'Bolsa a cero', price: 0 }
    render(
      <BagsPanel
        products={[noPrice, zeroPrice]}
        lines={[]}
        onAdd={onAdd}
        onRemove={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Añadir bolsas' }))
    expect(screen.getAllByText('Sin precio')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Sumar Bolsa sin precio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sumar Bolsa a cero' })).toBeDisabled()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
