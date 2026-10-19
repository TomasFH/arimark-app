import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PaymentModal from '../PaymentModal'
import type { ProductRow } from '../../types/hw-api'

function renderModal(itemTotal = 15000) {
  const onConfirm = vi.fn()
  render(
    <PaymentModal
      itemTotal={itemTotal}
      onConfirm={onConfirm}
      onClose={() => {}}
    />,
  )
  return { onConfirm }
}

describe('PaymentModal — atajos de cobro', () => {
  it('F2 deja débito sin confirmar', () => {
    const { onConfirm } = renderModal()

    expect(screen.getByRole('button', { name: 'Efectivo' })).toHaveTextContent('(F1)')
    expect(screen.getByRole('button', { name: 'Débito' })).toHaveTextContent('(F2)')
    expect(screen.getByRole('button', { name: 'Billetera Virtual' })).toHaveTextContent('(F3)')
    expect(screen.getByRole('button', { name: /Crédito/ })).toHaveTextContent('(F9)')
    expect(screen.getByRole('button', { name: /Dividir en varios medios de pago/ })).toHaveTextContent('(F5)')

    fireEvent.keyDown(document, { key: 'F2' })

    expect(screen.getByRole('dialog')).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Confirmar cobro — Débito' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar cobro/ })).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter en efectivo vacío confirma el total y F1 no confirma solo', () => {
    const { onConfirm } = renderModal(15000)

    fireEvent.keyDown(document, { key: 'F1' })

    expect(screen.getByRole('heading', { name: 'Cobro en efectivo' })).toBeInTheDocument()
    const amount = screen.getByPlaceholderText('Monto recibido')
    expect(amount).toHaveValue('')
    expect(amount).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(
      [{ paymentMethod: 'cash', amount: 15000 }],
      undefined,
    )
  })

  it('Enter en efectivo con un monto menor al total no confirma', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal(15000)

    fireEvent.keyDown(document, { key: 'F1' })
    const amount = screen.getByPlaceholderText('Monto recibido')
    await user.type(amount, '1000')
    fireEvent.keyDown(amount, { key: 'Enter' })

    expect(amount).toHaveValue('1.000')
    expect(screen.getByText(/El cliente debe pagar al menos/)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('el botón Efectivo y un cobro que ya abre en efectivo dejan el foco en el monto', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <PaymentModal
        itemTotal={15000}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('dialog')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    expect(screen.getByPlaceholderText('Monto recibido')).toHaveFocus()

    unmount()
    render(
      <PaymentModal
        itemTotal={15000}
        initialMethod="cash"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByPlaceholderText('Monto recibido')).toHaveFocus()
    expect(screen.getByRole('dialog')).not.toHaveFocus()
  })

  it('el vuelto usa borde gris y fondo verde con color-mix', async () => {
    const user = userEvent.setup()
    renderModal(15000)
    await user.click(screen.getByRole('button', { name: 'Efectivo' }))
    await user.type(screen.getByPlaceholderText('Monto recibido'), '20000')
    const box = screen.getByText('Vuelto a entregar').parentElement?.parentElement
    expect(box).toHaveClass('border-line-strong')
    expect(box?.className ?? '').toContain('color-mix(in_srgb,var(--success)')
    expect(box?.className ?? '').not.toContain('border-success/30')
    expect(box?.className ?? '').not.toContain('bg-success/10')
  })

  it('F9 abre crédito y F4 no lo abre', () => {
    const { onConfirm } = renderModal()

    fireEvent.keyDown(document, { key: 'F4' })
    expect(screen.queryByRole('heading', { name: 'Cobro con crédito' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'F9' })

    expect(screen.getByRole('heading', { name: 'Cobro con crédito' })).toBeInTheDocument()
    expect(screen.getByText('¿En cuántas cuotas?')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('con las bolsas abiertas Enter confirma el cobro y no suma una bolsa', () => {
    const onConfirm = vi.fn()
    const onAddBag = vi.fn()
    const onRemoveBag = vi.fn()
    const bolsa: ProductRow = {
      id: 'bag-1',
      pluNumber: 80,
      name: 'Bolsa chica',
      category: 'bags',
      unit: 'unit',
      price: 200,
    }
    render(
      <PaymentModal
        itemTotal={15000}
        products={[bolsa]}
        cartLines={[{ productId: 'bag-1', weightKg: 1, unit: 'unit' }]}
        onAddBag={onAddBag}
        onRemoveBag={onRemoveBag}
        onConfirm={onConfirm}
        onClose={() => {}}
        initialMethod="debit"
      />,
    )

    fireEvent.keyDown(document, { key: 'F7' })
    expect(screen.getByRole('list', { name: 'Bolsas' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onAddBag).toHaveBeenCalledWith(bolsa, 1)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(onRemoveBag).toHaveBeenCalledWith('bag-1', 1)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onAddBag).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('list', { name: 'Bolsas' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Confirmar cobro — Débito' })).toBeInTheDocument()
  })

  it('F5 pasa a dividir y evita la recarga de la ventana', () => {
    const { onConfirm } = renderModal()

    expect(fireEvent.keyDown(document, { key: 'F5' })).toBe(false)

    expect(screen.getByRole('heading', { name: 'Cobro dividido' })).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('0').length).toBeGreaterThan(0)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
