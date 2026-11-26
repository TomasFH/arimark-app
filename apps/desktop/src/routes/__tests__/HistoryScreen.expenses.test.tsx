import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { clearHistoryDetailCache } from '../../lib/historyDetailCache'
import { clearHistoryVisitReturn } from '../../lib/historyVisitReturn'
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
  salesCount: null,
  totalRevenue: null,
  totalCashSales: null,
  totalExpenses: null,
  cashInHand: null,
  totalDeposits: null,
  totalsSealed: false,
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
    visitLines: [
      { name: 'Asado', quantityLabel: '2,500 kg', unitPrice: 4000, subtotal: 10000 },
      { name: 'Vacío', quantityLabel: '1 kg', unitPrice: 0, subtotal: 0 },
      { name: 'Matambre', quantityLabel: '1 kg', unitPrice: 0, subtotal: 0 },
      { name: 'Falda', quantityLabel: '1 kg', unitPrice: 0, subtotal: 0 },
    ],
    intakeId: 'visita-1',
    intakeCreatedAt: ROW.startedAt,
  }, {
    id: 'inj-1',
    createdAt: ROW.startedAt,
    concept: 'Aporte',
    amount: 500,
    notes: 'De la dueña',
    createdBy: 'Ana',
    kind: 'inject',
    injectReason: 'aporte',
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
    clearHistoryVisitReturn()
    clearHistoryDetailCache()
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
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} onOpenVisit={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /Ana/ }))
    await user.click(await screen.findByRole('button', { name: /Gastos \(1\)/ }))

    expect(screen.queryByText('Falda')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Guido/ }))
    expect(screen.getByText('Falda')).toBeInTheDocument()
    expect(screen.getAllByText('sin precio').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Ver visita' })).toBeInTheDocument()
    const notes = screen.getAllByText('Dejó el cuarto corte en el renglón')
    expect(notes.some(node => node.classList.contains('break-words'))).toBe(true)
    expect(screen.queryByText('De la dueña')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Ingresos \(1\)/ }))
    expect(screen.getByText('De la dueña')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Gastos \(1\)/ }))
    await user.click(screen.getByRole('button', { name: /Guido/ }))
    expect(screen.queryByText('Falda')).not.toBeInTheDocument()
  })

  it('la cajera no ve el formulario de corrección de un turno cerrado', async () => {
    window.hw.getHistoryShiftDetail = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...DETAIL,
        shift: { ...DETAIL.shift, closedAt: `${day}T20:00:00.000Z` },
      },
    })
    const user = userEvent.setup()
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} limitedToRecentWeeks />)
    await user.click(await screen.findByRole('button', { name: /Ana/ }))
    expect(screen.queryByRole('button', { name: 'Acciones del cierre' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Corregir cierre' })).not.toBeInTheDocument()
  })

  it('el admin ve la acción de corregir el cierre', async () => {
    window.hw.getHistoryShiftDetail = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...DETAIL,
        shift: { ...DETAIL.shift, closedAt: `${day}T20:00:00.000Z` },
      },
    })
    const user = userEvent.setup()
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /Ana/ }))
    expect(screen.getByRole('button', { name: 'Corregir cierre' })).toBeInTheDocument()
  })

  it('volver de ver visita deja abierto el mismo gasto', async () => {
    const user = userEvent.setup()
    const onOpenVisit = vi.fn()
    const view = render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} onOpenVisit={onOpenVisit} />)
    await user.click(await screen.findByRole('button', { name: /Ana/ }))
    await user.click(await screen.findByRole('button', { name: /Gastos \(1\)/ }))
    await user.click(screen.getByRole('button', { name: /Guido/ }))
    await user.click(screen.getByRole('button', { name: 'Ver visita' }))
    view.unmount()

    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} onOpenVisit={onOpenVisit} resumeAfterVisit />)
    expect(await screen.findByText('Falda')).toBeInTheDocument()
    expect(screen.getByText('Producto').closest('div')).toHaveClass('w-full')
  })

  it('muestra la media res y el delantero que no se pagaron acá', async () => {
    window.hw.getHistoryShiftDetail = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...DETAIL,
        unpaidArrivals: [{
          intakeId: 'visita-media',
          createdAt: ROW.startedAt,
          providerName: 'Frigorífico',
          lines: [
            { name: 'Media res', quantityLabel: '2 u · 130 kg' },
            { name: 'Delantero', quantityLabel: '1 u · 65 kg' },
          ],
        }],
      },
    })
    const user = userEvent.setup()
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /Ana/ }))
    expect(await screen.findByText('Entró y no se pagó acá')).toBeInTheDocument()
    expect(screen.getByText('Media res')).toBeInTheDocument()
    expect(screen.getByText('Delantero')).toBeInTheDocument()
    expect(screen.getByText(/No entra en la caja/)).toBeInTheDocument()
  })

  it('agrupa por día y muestra el local sin cortar el texto', async () => {
    window.hw.getStores = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 'store-a', name: 'Camarones' },
        { id: 'store-b', name: 'San Martín' },
      ],
    })
    window.hw.getHistoryShifts = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          ...ROW,
          id: 's1',
          storeId: 'store-a',
          startedAt: '2026-11-25T12:00:00.000Z',
          closedAt: '2026-11-25T16:00:00.000Z',
          cashierName: 'Ana María del turno largo',
          totalsSealed: true,
          totalRevenue: 1_250_000,
        },
        {
          ...ROW,
          id: 's2',
          storeId: 'store-b',
          shiftType: 'evening',
          startedAt: '2026-11-24T21:00:00.000Z',
          closedAt: '2026-11-24T23:00:00.000Z',
          cashierName: 'Luis',
        },
      ],
    })
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Miércoles 25/11' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Martes 24/11' })).toBeInTheDocument()
    const row = await screen.findByRole('button', { name: /Ana María del turno largo/ })
    expect(row).toHaveTextContent('Mañana')
    expect(row).toHaveTextContent('Camarones')
    expect(row).not.toHaveTextContent('25/11')
    expect(row.querySelector('.truncate')).toBeNull()
    expect(screen.getByRole('button', { name: /Luis/ })).toHaveTextContent('San Martín')
  })

  it('un turno abierto dice En curso', async () => {
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} />)
    expect(await screen.findByText('En curso')).toBeInTheDocument()
    expect(screen.queryByText('Sin dato')).not.toBeInTheDocument()
  })

  it('un turno cerrado sin ficha dice Sin dato', async () => {
    window.hw.getHistoryShifts = vi.fn().mockResolvedValue({
      ok: true,
      data: [{ ...ROW, closedAt: `${day}T20:00:00.000Z` }],
    })
    render(<HistoryScreen onBack={vi.fn()} onLogout={vi.fn()} />)
    expect(await screen.findByText('Sin dato')).toBeInTheDocument()
    expect(screen.queryByText('En curso')).not.toBeInTheDocument()
  })
})
