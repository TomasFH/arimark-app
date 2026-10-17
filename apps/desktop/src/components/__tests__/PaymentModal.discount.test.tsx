import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PaymentModal from '../PaymentModal'

const RULE_10_FROM_40K = { minAmount: 40000, percent: 10 }

async function confirmExactCash(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Paga justo/ }))
  await user.click(screen.getByRole('button', { name: /Confirmar cobro/ }))
}

describe('PaymentModal — descuento de esta venta', () => {
  it('en efectivo con umbral cumplido el tilde prende el descuento y el % se puede editar', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={40000}
        cashDiscountRule={RULE_10_FROM_40K}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    expect(screen.getByText(/Si cobrás con efectivo: 10%/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    const apply = screen.getByRole('checkbox', { name: 'Aplicar descuento' })
    expect(apply).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeInTheDocument()
    const percent = screen.getByLabelText('Descuento de esta venta')
    expect(percent).toHaveValue('10')
    expect(screen.getByText(/Desc\. efectivo: 10%/)).toBeInTheDocument()
    expect(screen.getAllByText(/36\.000/).length).toBeGreaterThan(0)

    await user.clear(percent)
    await user.type(percent, '20')
    expect(screen.getAllByText(/32\.000/).length).toBeGreaterThan(0)

    await user.click(apply)
    expect(screen.queryByLabelText('Descuento de esta venta')).not.toBeInTheDocument()
    expect(screen.queryByText(/32\.000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Desc\. efectivo/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/40\.000/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('checkbox', { name: 'Aplicar descuento' }))
    expect(screen.getByLabelText('Descuento de esta venta')).toHaveValue('20')
    expect(screen.getAllByText(/32\.000/).length).toBeGreaterThan(0)

    await confirmExactCash(user)
    expect(onConfirm.mock.calls[0]).toEqual([
      [{ paymentMethod: 'cash', amount: 32000 }],
      undefined,
      20,
    ])
  })

  it('confirma el % de la config cuando el tilde sigue prendido', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={40000}
        cashDiscountRule={RULE_10_FROM_40K}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    await confirmExactCash(user)
    expect(onConfirm.mock.calls[0]).toEqual([
      [{ paymentMethod: 'cash', amount: 36000 }],
      undefined,
      10,
    ])
  })

  it('destildar en efectivo devuelve el total sin descuento y confirma 0 sin excepción', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={40000}
        cashDiscountRule={RULE_10_FROM_40K}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    expect(screen.getAllByText(/36\.000/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('checkbox', { name: 'Aplicar descuento' }))
    expect(screen.queryByLabelText('Descuento de esta venta')).not.toBeInTheDocument()
    expect(screen.queryByText(/36\.000/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/40\.000/).length).toBeGreaterThan(0)

    await confirmExactCash(user)
    expect(onConfirm.mock.calls[0]).toEqual([
      [{ paymentMethod: 'cash', amount: 40000 }],
      undefined,
      0,
    ])
  })

  it('no muestra el porcentaje ni la línea si no llega al mínimo', async () => {
    const user = userEvent.setup()
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
    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeChecked()
    expect(screen.queryByText(/18\.000/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/20\.000/).length).toBeGreaterThan(0)
  })

  it('el tilde de excepción aplica el porcentaje aunque el medio no sea efectivo', async () => {
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
    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Si cobrás con efectivo/)).not.toBeInTheDocument()
    expect(screen.getByText(/Descuento: 10%/)).toBeInTheDocument()

    await user.clear(percent)
    await user.type(percent, '5')
    expect(screen.getAllByText(/19\.000/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Débito' }))
    await user.click(screen.getByRole('button', { name: /Confirmar cobro/ }))
    expect(onConfirm.mock.calls[0]).toEqual([
      [{ paymentMethod: 'debit', amount: 19000 }],
      undefined,
      5,
      true,
    ])
  })

  it('en un split el tilde de excepción descuenta aunque el cobro sea solo débito', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={80000}
        cashDiscountRule={RULE_10_FROM_40K}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Dividir en varios medios de pago/ }))
    const amounts = screen.getAllByPlaceholderText('0')
    await user.type(amounts[1], '80000')
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toHaveTextContent(/80\.000/)
    expect(screen.getByText('Total cubierto')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Descuento en esta venta' }))
    expect(screen.getByText(/Descuento: 10%/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toHaveTextContent(/72\.000/)
    expect(screen.getByText('Exceso')).toBeInTheDocument()
    expect(screen.getByText(/8\.000/)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Descuento en esta venta' }))
    expect(screen.queryByText('Exceso')).not.toBeInTheDocument()
    expect(screen.getByText('Total cubierto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toHaveTextContent(/80\.000/)
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

  it('pasar de efectivo a débito no arrastra el descuento', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={40000}
        cashDiscountRule={RULE_10_FROM_40K}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    await user.clear(screen.getByLabelText('Descuento de esta venta'))
    await user.type(screen.getByLabelText('Descuento de esta venta'), '20')
    expect(screen.getAllByText(/32\.000/).length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: 'Volver' })[0])
    await user.click(screen.getByRole('button', { name: 'Débito' }))

    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()
    const exception = screen.getByRole('checkbox', { name: 'Descuento en esta venta' })
    expect(exception).not.toBeChecked()
    expect(screen.queryByLabelText('Descuento de esta venta')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toHaveTextContent(/40\.000/)
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).not.toHaveTextContent(/32\.000/)

    await user.click(exception)
    expect(screen.getByLabelText('Descuento de esta venta')).toHaveValue('10')
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toHaveTextContent(/36\.000/)
    await user.click(exception)
    expect(screen.queryByLabelText('Descuento de esta venta')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toHaveTextContent(/40\.000/)

    await user.click(screen.getByRole('button', { name: /Confirmar cobro/ }))
    expect(onConfirm.mock.calls[0]).toEqual([
      [{ paymentMethod: 'debit', amount: 40000 }],
      undefined,
    ])
  })

  it('en un split con efectivo el tilde saca el descuento al instante', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <PaymentModal
        itemTotal={40000}
        cashDiscountRule={RULE_10_FROM_40K}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Dividir en varios medios de pago/ }))
    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()

    const amounts = screen.getAllByPlaceholderText('0')
    await user.type(amounts[0], '36000')
    expect(screen.getByRole('checkbox', { name: 'Aplicar descuento' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/36\.000/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /Confirmar cobro/ }))
    expect(onConfirm.mock.calls[0]).toEqual([
      [{ paymentMethod: 'cash', amount: 36000 }],
      undefined,
      10,
    ])
  })

  it('destildar el split con efectivo deja el total sin descuento', async () => {
    const user = userEvent.setup()
    render(
      <PaymentModal
        itemTotal={40000}
        cashDiscountRule={RULE_10_FROM_40K}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Dividir en varios medios de pago/ }))
    const amounts = screen.getAllByPlaceholderText('0')
    await user.type(amounts[0], '36000')
    expect(screen.getByText(/Desc\. efectivo/)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Aplicar descuento' }))
    expect(screen.queryByLabelText('Descuento de esta venta')).not.toBeInTheDocument()
    expect(screen.queryByText(/Desc\. efectivo/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cobro dividido' }).parentElement).toHaveTextContent(/40\.000/)
  })

  it('la seña digital no habilita el descuento de la regla', async () => {
    const user = userEvent.setup()
    render(
      <PaymentModal
        itemTotal={100000}
        depositAmount={20000}
        depositDigitalAmount={20000}
        cashDiscountRule={{ minAmount: 0, percent: 10 }}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )

    expect(screen.queryByText(/Si cobrás con efectivo/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    expect(screen.queryByRole('checkbox', { name: 'Aplicar descuento' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Descuento en esta venta' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Paga justo/ })).toHaveTextContent(/80\.000/)
    expect(screen.queryByText(/70\.000/)).not.toBeInTheDocument()
  })
})
