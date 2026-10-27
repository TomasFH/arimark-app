import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OpenPriceModal from '../OpenPriceModal'
import type { ProductRow } from '../../types/hw-api'

const prueba: ProductRow = {
  id: 'p-998',
  pluNumber: 998,
  name: 'Corte de prueba con un nombre largo para el mostrador',
  category: 'beef_cut',
  unit: 'kg',
  price: 0,
}

const unidad: ProductRow = {
  id: 'p-950',
  pluNumber: 950,
  name: 'Confirmación',
  category: 'other',
  unit: 'unit',
  price: 0,
}

describe('OpenPriceModal', () => {
  it('no agrega la línea si el precio está vacío, ni con Escape o la X', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <OpenPriceModal product={prueba} ticketTotal={10000} onConfirm={onConfirm} onClose={onClose} />,
    )

    expect(screen.getByText(prueba.name)).toHaveAttribute('title', prueba.name)
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresá un precio entero mayor a cero.')
    expect(onConfirm).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    onClose.mockClear()
    rerender(
      <OpenPriceModal product={prueba} ticketTotal={10000} onConfirm={onConfirm} onClose={onClose} />,
    )
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirma el precio entero y muestra los kilos del ticket', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <OpenPriceModal product={prueba} ticketTotal={10000} onConfirm={onConfirm} onClose={() => {}} />,
    )
    await user.type(screen.getByLabelText('Precio por kilo ($)'), '20000')
    expect(screen.getByText(/0\.500 kg/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(onConfirm).toHaveBeenCalledWith(20000)
  })

  it('en un producto por unidad redondea la cantidad', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <OpenPriceModal product={unidad} ticketTotal={7000} onConfirm={onConfirm} onClose={() => {}} />,
    )
    await user.type(screen.getByLabelText('Precio por unidad ($)'), '6000')
    expect(screen.getByText(/1 u\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(onConfirm).toHaveBeenCalledWith(6000)
  })
})
