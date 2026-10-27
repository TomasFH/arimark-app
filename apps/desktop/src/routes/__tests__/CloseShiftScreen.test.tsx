import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CloseShiftScreen from '../CloseShiftScreen'
import type { CloseShiftPayload, ShiftSummary } from '../../types/hw-api'

const summary: ShiftSummary = {
  shiftId: 'sh1',
  shiftType: 'morning',
  startedAt: '2026-08-28T11:00:00.000Z',
  openingCash: 10000,
  salesCount: 2,
  totalRevenue: 25000,
  totalCashSales: 20000,
  totalDebitSales: 5000,
  totalWalletSales: 0,
  totalCreditSales: 0,
  cashSaleCount: 1,
  digitalSaleCount: 1,
  debitSaleCount: 1,
  walletSaleCount: 0,
  creditSaleCount: 0,
  totalExpenses: 0,
  totalCashInjects: 0,
  cashInHand: 30000,
  debtsCount: 0,
  totalDebts: 0,
  totalCashDebtPayments: 0,
  totalCashDeposits: 0,
  totalDebitDeposits: 0,
  totalWalletDeposits: 0,
  totalCreditDeposits: 0,
  totalDigitalDeposits: 0,
  depositsCount: 0,
}

function billQuantityInput(denomLabel: string): HTMLInputElement {
  const label = screen.getByText(denomLabel)
  const input = label.parentElement?.querySelector('input')
  if (!(input instanceof HTMLInputElement)) throw new Error(`Sin input para ${denomLabel}`)
  return input
}

function lastClosePayload(): CloseShiftPayload {
  const calls = vi.mocked(window.hw.closeShift).mock.calls
  const payload = calls[calls.length - 1]?.[0]
  if (!payload) throw new Error('closeShift no fue llamado')
  return payload
}

describe('CloseShiftScreen — monto que queda', () => {
  beforeEach(() => {
    window.hw = {
      getShiftSummary: vi.fn().mockResolvedValue({ ok: true, data: summary }),
      getDraftStockCount: vi.fn().mockResolvedValue({ ok: true, data: null }),
      closeShift: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exige el monto y no abre el cierre si el campo está vacío', async () => {
    const user = userEvent.setup()
    render(<CloseShiftScreen onConfirmed={vi.fn()} onCancel={() => {}} />)
    await screen.findByRole('heading', { name: 'Cerrar caja' })

    await user.click(screen.getByRole('button', { name: 'Cerrar caja' }))

    expect(screen.getByText('Ingresá cuánto queda en la caja.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '¿Cerrar el turno ahora?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '¿Caja vacía?' })).not.toBeInTheDocument()
    expect(window.hw.closeShift).not.toHaveBeenCalled()
  })

  it('con monto 0 cierra sin modal de caja vacía y sin billetes', async () => {
    const onConfirmed = vi.fn()
    const user = userEvent.setup()
    render(<CloseShiftScreen onConfirmed={onConfirmed} onCancel={() => {}} />)

    await screen.findByRole('heading', { name: 'Cerrar caja' })
    await user.type(screen.getByLabelText('Queda en la caja'), '0')
    expect(screen.getByText('Faltante $30.000')).toBeInTheDocument()
    expect(screen.getByText('Esperado $30.000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    expect(screen.queryByRole('heading', { name: '¿Caja vacía?' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '¿Cerrar el turno ahora?' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cerrar turno' }))

    expect(await screen.findByRole('heading', { name: 'Caja cerrada' })).toBeInTheDocument()
    expect(screen.getByText('Queda en la caja')).toBeInTheDocument()
    expect(screen.getByText('Faltante')).toBeInTheDocument()
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(lastClosePayload()).toMatchObject({ closingCash: 0 })
    expect(lastClosePayload().billDenominations).toBeUndefined()
    expect(lastClosePayload().confirmEmptyRegister).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Finalizar sesión' }))
    expect(onConfirmed).toHaveBeenCalledOnce()
  })

  it('el conteo completa el monto y, si después se edita, no guarda el desglose', async () => {
    const user = userEvent.setup()
    render(<CloseShiftScreen onConfirmed={vi.fn()} onCancel={() => {}} />)
    await screen.findByRole('heading', { name: 'Cerrar caja' })

    const left = screen.getByLabelText('Queda en la caja')
    await user.type(billQuantityInput('$1.000'), '2')
    expect(left).toHaveValue('2.000')

    await user.clear(left)
    await user.type(left, '1500')
    expect(left).toHaveValue('1.500')

    await user.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    await user.click(await screen.findByRole('button', { name: 'Cerrar turno' }))

    expect(lastClosePayload()).toMatchObject({ closingCash: 1500 })
    expect(lastClosePayload().billDenominations).toBeUndefined()
  })

  it('guarda el desglose cuando coincide con el monto declarado', async () => {
    const user = userEvent.setup()
    render(<CloseShiftScreen onConfirmed={vi.fn()} onCancel={() => {}} />)
    await screen.findByRole('heading', { name: 'Cerrar caja' })

    await user.type(billQuantityInput('$1.000'), '2')
    expect(screen.getByLabelText('Queda en la caja')).toHaveValue('2.000')

    await user.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    await user.click(await screen.findByRole('button', { name: 'Cerrar turno' }))

    expect(lastClosePayload()).toMatchObject({
      closingCash: 2000,
      billDenominations: [{ denomination: 1000, quantity: 2 }],
    })
  })

  it('la diferencia usa lo declarado contra el esperado menos la entrega', async () => {
    const user = userEvent.setup()
    render(<CloseShiftScreen onConfirmed={vi.fn()} onCancel={() => {}} />)
    await screen.findByRole('heading', { name: 'Cerrar caja' })

    await user.type(screen.getByLabelText('Queda en la caja'), '20000')
    const deliveryLabel = screen.getByText('Monto a entregar o depositar (opcional)')
    const delivery = deliveryLabel.parentElement?.querySelector('input')
    if (!(delivery instanceof HTMLInputElement)) throw new Error('Sin campo de entrega')
    await user.type(delivery, '5000')

    expect(screen.getByText('Esperado $25.000')).toBeInTheDocument()
    expect(screen.getByText('Faltante $5.000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    await user.click(await screen.findByRole('button', { name: 'Cerrar turno' }))

    expect(lastClosePayload()).toMatchObject({
      closingCash: 25000,
      deliveredAmount: 5000,
    })
    expect(lastClosePayload().billDenominations).toBeUndefined()
  })
})
