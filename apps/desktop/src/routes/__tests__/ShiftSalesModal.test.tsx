import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ShiftSalesModal from '../ShiftSalesModal'
import type { ShiftSaleRow } from '../../types/hw-api'

function sale(overrides: Partial<ShiftSaleRow> & Pick<ShiftSaleRow, 'id' | 'total'>): ShiftSaleRow {
  return {
    createdAt: '2026-10-19T13:00:00.000Z',
    status: 'confirmed',
    cashAmount: 0,
    digitalAmount: 0,
    paymentMethods: ['cash'],
    payments: [{ method: 'cash', amount: overrides.total }],
    isDebt: false,
    manualEntry: false,
    discountAmount: 0,
    items: [{
      productName: 'Asado',
      quantity: 1,
      unit: 'kg',
      unitPrice: overrides.total,
      subtotal: overrides.total,
    }],
    ...overrides,
  }
}

describe('ShiftSalesModal — precio de lista y columna digital', () => {
  it('tacha el precio de lista si hubo descuento y pinta el digital con su color', async () => {
    window.hw = {
      getShiftSales: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          sale({
            id: 'con-descuento',
            total: 90000,
            discountAmount: 10000,
            cashAmount: 50000,
            digitalAmount: 40000,
            paymentMethods: ['cash', 'debit'],
            payments: [
              { method: 'cash', amount: 50000 },
              { method: 'debit', amount: 40000 },
            ],
          }),
          sale({ id: 'sin-descuento', total: 3000, cashAmount: 3000, digitalAmount: 0 }),
          sale({
            id: 'anulada',
            total: 4000,
            discountAmount: 1000,
            status: 'cancelled',
            cashAmount: 0,
            digitalAmount: 4000,
            paymentMethods: ['debit'],
            payments: [{ method: 'debit', amount: 4000 }],
          }),
        ],
      }),
    } as unknown as typeof window.hw

    render(<ShiftSalesModal onClose={() => {}} />)
    expect(await screen.findByRole('dialog', { name: 'Ventas del turno' })).toBeInTheDocument()

    const listPrice = leafWithAmount(100000)
    expect(listPrice).toHaveClass('line-through', 'text-subtle')
    const charged = listPrice.parentElement?.querySelector('p:last-child')
    expect(digits(charged?.textContent ?? '')).toBe('90000')
    expect(charged).toHaveClass('text-ink')
    expect(charged).not.toHaveClass('line-through')

    const plain = leafWithAmount(3000).closest('tr')
    expect(plain?.querySelector('.line-through')).toBeNull()
    expect(plain?.querySelector('td.text-success')).toBeTruthy()
    expect(plain?.querySelector('td.text-pay-debit')).toBeTruthy()

    const digital = leavesWithAmount(40000).find(el => el.closest('td')?.classList.contains('text-pay-debit'))
    expect(digital?.closest('td')).toHaveClass('text-pay-debit')

    const cancelledList = leafWithAmount(5000)
    expect(cancelledList).toHaveClass('line-through', 'text-subtle')
    const cancelledDigital = leavesWithAmount(4000).find(el => el.closest('td')?.classList.contains('text-muted'))
    expect(cancelledDigital?.closest('td')).toHaveClass('text-muted', 'line-through')
    expect(cancelledDigital?.closest('td')).not.toHaveClass('text-pay-debit')
  })
})

function digits(text: string): string {
  return text.replace(/\D/g, '')
}

function leavesWithAmount(amount: number): HTMLElement[] {
  return screen.getAllByText((_, node) => {
    if (!node || node.children.length > 0) return false
    return digits(node.textContent ?? '') === String(amount)
  })
}

function leafWithAmount(amount: number): HTMLElement {
  const match = leavesWithAmount(amount)[0]
  if (!match) throw new Error(`No está el monto ${amount}`)
  return match
}