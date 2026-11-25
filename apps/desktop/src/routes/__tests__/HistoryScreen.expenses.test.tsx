import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistoryScreen from '../HistoryScreen'
import { todayLocalYmd } from '../../lib/datetime'
import type { HistoryShiftDetail, HistoryShiftRow } from '../../types/hw-api'

const day = todayLocalYmd()

const ROW: HistoryShiftRow = {
  id: 'shift-1',
  shiftType: 'morning',
  startedAt: `${day}T12:00:00.000Z`,
  closedAt: null,
  cashierName: 'Ana',
  salesCount: 0,
  totalRevenue: 0,
  totalCashSales: 0,
  totalExpenses: 1000,
  cashInHand: 0,
  totalDeposits: 0,
}

const DETAIL: HistoryShiftDetail = {
  shift: {
    id: 'shift-1',
    shiftType: 'morning',
    startedAt: ROW.startedAt,
    closedAt: null,
    cashierName: 'Ana',
    openingCash: 0,
    closingCash: null,
    deliveredAmount: null,
    deliveredTo: null,
    notes: null,
  },
  sales: [],
  debts: [],
  deposits: [],
  vales: [],
  expenses: [{
    id: 'exp-1',
    createdAt: ROW.startedAt,
    provider: 'Guido',
    concept: 'Mercadería: Asado, Vacío, Matambre…',
    amount: 1000,
    notes: 'Dejó el cuarto corte en el renglón',
    createdBy: 'Ana',
    lineNames: ['Asado', 'Vacío', 'Matambre', 'Falda'],
  }],
  summary: {
    salesCount: 0,
    totalRevenue: 0,
    totalCashSales: 0,
    totalDebitSales: 0,
    totalWalletSales: 0,
    totalCreditSales: 0,
    totalExpenses: 1000,
    totalCashInjects: 0,
    cashDeposits: 0,
    digitalDeposits: 0,
    cashInHand: 0,
    debtsCount: 0,
    totalDebts: 0,
  },
}

describe('HistoryScreen — gastos del turno', () => {
  beforeEach(() => {
    window.hw = {
      getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getHistoryShifts: vi.fn().mockResolvedValue({ ok: true, data: [ROW] }),
      getHistoryShiftDetail: vi.fn().mockResolvedValue({ ok: true, data: DETAIL }),
      getUiSettings: vi.fn().mockResolvedValue({ ok: true, data: { zoomFactor: 1, colorScheme: 'light' } }),
      setUiSettings: vi.fn().mockResolvedValue({ ok: true }),
      onUiSettingsChanged: vi.fn(() => () => undefined),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('abre el gasto y muestra el renglón que el concepto no guardó', async () => {
    const user = userEvent.setup()
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /Ana/ }))
    await user.click(await screen.findByRole('button', { name: /Gastos \(1\)/ }))

    expect(screen.queryByText('Falda')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Guido/ }))
    expect(screen.getByText('Falda')).toBeInTheDocument()
    const notes = screen.getAllByText('Dejó el cuarto corte en el renglón')
    expect(notes.some(node => node.classList.contains('break-words'))).toBe(true)
    await user.click(screen.getByRole('button', { name: /Guido/ }))
    expect(screen.queryByText('Falda')).not.toBeInTheDocument()
  })
})
