import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PaymentModal from '../PaymentModal'

describe('PaymentModal — descuento de esta venta', () => {
  it('cambia el porcentaje solo en el cobro con efectivo, incluso a cero', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={100000}
        cashDiscountRule={{ minAmount: 0, percent: 10 }}
        products={[]}
        cartLines={[]}
        onAddBag={() => {}}
        onRemoveBag={() => {}}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    expect(screen.queryByLabelText('Descuento de esta venta')).not.toBeInTheDocument()
    expect(screen.getByText(/Si cobrás con efectivo: 10%/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /Aplicar descuento/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    const percent = screen.getByLabelText('Descuento de esta venta')
    expect(percent).toHaveValue('10')
    expect(screen.getAllByText(/90\.000/).length).toBeGreaterThan(0)

    await user.clear(percent)
    await user.type(percent, '0')
    expect(screen.queryByText(/Si cobrás con efectivo/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/100\.000/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Paga justo/ }))
    await user.click(screen.getByRole('button', { name: /Confirmar cobro/ }))
    expect(onConfirm).toHaveBeenCalledWith(
      [{ paymentMethod: 'cash', amount: 100000 }],
      undefined,
      0,
    )
  })

  it('no muestra el porcentaje ni la línea si no llega al mínimo', () => {
    render(
      <PaymentModal
        itemTotal={20000}
        cashDiscountRule={{ minAmount: 50000, percent: 10 }}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )

    expect(screen.queryByLabelText('Descuento de esta venta')).not.toBeInTheDocument()
    expect(screen.queryByText(/Si cobrás con efectivo/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Descuento en esta venta' })).toBeInTheDocument()
  })

  it('el tilde aplica el porcentaje aunque el medio no sea efectivo', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={20000}
        cashDiscountRule={{ minAmount: 50000, percent: 10 }}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Descuento en esta venta' }))
    const percent = screen.getByLabelText('Descuento de esta venta')
    expect(percent).toHaveValue('10')
    expect(screen.queryByText(/Si cobrás con efectivo/)).not.toBeInTheDocument()
    expect(screen.getByText(/Descuento 10%/)).toBeInTheDocument()

    await user.clear(percent)
    await user.type(percent, '5')
    expect(screen.getAllByText(/19\.000/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Débito' }))
    await user.click(screen.getByRole('button', { name: /Confirmar cobro/ }))
    expect(onConfirm).toHaveBeenCalledWith(
      [{ paymentMethod: 'debit', amount: 19000 }],
      undefined,
      5,
      true,
    )
  })

  it('recalcula el descuento si cambia el total', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PaymentModal
        itemTotal={100000}
        cashDiscountRule={{ minAmount: 0, percent: 10 }}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    expect(screen.getAllByText(/90\.000/).length).toBeGreaterThan(0)

    rerender(
      <PaymentModal
        itemTotal={110000}
        cashDiscountRule={{ minAmount: 0, percent: 10 }}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getAllByText(/99\.000/).length).toBeGreaterThan(0)
  })
})
