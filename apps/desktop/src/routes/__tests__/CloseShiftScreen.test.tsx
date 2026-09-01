import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CloseShiftScreen from '../CloseShiftScreen'
import type { ShiftSummary } from '../../types/hw-api'

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

describe('CloseShiftScreen — resumen post-cierre', () => {
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

  it('después de confirmar muestra el modal de resumen, no solo la pregunta', async () => {
    const onConfirmed = vi.fn()
    const user = userEvent.setup()
    render(<CloseShiftScreen onConfirmed={onConfirmed} onCancel={() => {}} />)

    await screen.findByRole('heading', { name: 'Cerrar caja' })

    await user.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    expect(await screen.findByRole('heading', { name: '¿Cerrar el turno ahora?' })).toBeInTheDocument()
    expect(screen.queryByText('Caja cerrada')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cerrar turno' }))

    expect(await screen.findByRole('heading', { name: 'Caja cerrada' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '¿Cerrar el turno ahora?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cerrar caja' })).not.toBeInTheDocument()
    expect(screen.getByText('Resumen del cierre')).toBeInTheDocument()
    expect(screen.getByText('Total vendido')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar sesión' })).toBeInTheDocument()
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(window.hw.closeShift).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Finalizar sesión' }))
    expect(onConfirmed).toHaveBeenCalledOnce()
  })
})
