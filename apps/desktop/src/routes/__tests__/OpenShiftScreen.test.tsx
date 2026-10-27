import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OpenShiftScreen from '../OpenShiftScreen'
import type { CashHandoverSnapshot } from '../../types/hw-api'

const OWN_SHIFT = {
  id: 'shift-001',
  storeId: 'store-1',
  userId: 'user-1',
  shiftType: 'morning' as const,
  startedAt: '2026-01-01T08:00:00.000Z',
  openingCash: 500,
}

describe('OpenShiftScreen — retomar turno propio', () => {
  beforeEach(() => {
    window.hw = {
      getActiveShift: vi.fn(),
      getStoreOpenShift: vi.fn(),
      getCashHandover: vi.fn(),
      getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      openShift: vi.fn(),
    } as unknown as typeof window.hw
  })

  it('si hay turno propio abierto llama onShiftOpened y no pide efectivo', async () => {
    vi.mocked(window.hw.getActiveShift).mockResolvedValue({ ok: true, data: OWN_SHIFT })
    const onShiftOpened = vi.fn()
    render(
      <OpenShiftScreen
        onShiftOpened={onShiftOpened}
        storeId="store-1"
        userId="user-1"
      />,
    )

    expect(screen.getByText('Comprobando turno abierto…')).toBeInTheDocument()
    await waitFor(() => expect(onShiftOpened).toHaveBeenCalledWith(OWN_SHIFT))
    expect(screen.queryByText('Efectivo inicial en caja')).not.toBeInTheDocument()
    expect(window.hw.openShift).not.toHaveBeenCalled()
  })

  it('si no hay turno propio muestra el formulario de apertura', async () => {
    vi.mocked(window.hw.getActiveShift).mockResolvedValue({ ok: true, data: null })
    vi.mocked(window.hw.getStoreOpenShift).mockResolvedValue({ ok: true, data: null })
    vi.mocked(window.hw.getCashHandover).mockResolvedValue({ ok: true, data: null })

    render(
      <OpenShiftScreen
        onShiftOpened={vi.fn()}
        storeId="store-1"
        userId="user-1"
      />,
    )

    expect(await screen.findByText('Efectivo inicial en caja')).toBeInTheDocument()
    expect(screen.getByText('Turno')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeInTheDocument()

    const denominations = document.querySelector('[data-bill-columns="2"]')
    expect(denominations).toHaveClass('grid-cols-2')

    const form = document.querySelector('form')
    expect(form).toHaveClass('items-stretch', 'md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]')

    const turno = screen.getByText('Turno')
    const conteo = screen.getByText('Lo que encontré en la registradora')
    const efectivo = screen.getByText('Efectivo inicial en caja')
    const abrir = screen.getByRole('button', { name: 'Abrir turno' })
    expect(turno.compareDocumentPosition(conteo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(turno.compareDocumentPosition(efectivo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const turnoCard = efectivo.closest('div.rounded-xl')
    expect(turnoCard).toHaveClass('bg-raised', 'border-line', 'h-full')
    expect(conteo.closest('div.rounded-xl')).toHaveClass('h-full')
    expect(efectivo.compareDocumentPosition(abrir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('precarga el efectivo con lo que quedó y la grilla si hay billetes', async () => {
    const handover: CashHandoverSnapshot = {
      fromShiftId: 'prev',
      fromUserId: 'user-9',
      fromCashierName: 'Ana',
      fromClosedAt: '2026-09-11T16:00:00.000Z',
      bills: [{ denomination: 1000, quantity: 3 }],
      counted: true,
      cashLeft: 12500,
    }
    vi.mocked(window.hw.getActiveShift).mockResolvedValue({ ok: true, data: null })
    vi.mocked(window.hw.getStoreOpenShift).mockResolvedValue({ ok: true, data: null })
    vi.mocked(window.hw.getCashHandover).mockResolvedValue({ ok: true, data: handover })

    render(
      <OpenShiftScreen
        onShiftOpened={vi.fn()}
        storeId="store-1"
        userId="user-1"
      />,
    )

    expect(await screen.findByLabelText('Efectivo inicial en caja')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Efectivo inicial en caja')).toHaveValue('12.500')
    })
    expect(screen.getByText('Precargado con lo que dejó Ana. Corregí si no coincide — no se pisa el cierre anterior.')).toBeInTheDocument()
    expect(screen.getByText('Dejó Ana al cerrar')).toBeInTheDocument()
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
  })

  it('no pisa el efectivo si ya se tipeó antes de que llegue el handover', async () => {
    let resolveHandover: (value: { ok: true; data: CashHandoverSnapshot }) => void = () => {}
    const pending = new Promise<{ ok: true; data: CashHandoverSnapshot }>(resolve => {
      resolveHandover = resolve
    })
    vi.mocked(window.hw.getActiveShift).mockResolvedValue({ ok: true, data: null })
    vi.mocked(window.hw.getStoreOpenShift).mockResolvedValue({ ok: true, data: null })
    vi.mocked(window.hw.getCashHandover).mockReturnValue(pending)

    const user = userEvent.setup()
    render(
      <OpenShiftScreen
        onShiftOpened={vi.fn()}
        storeId="store-1"
        userId="user-1"
      />,
    )

    const cash = await screen.findByLabelText('Efectivo inicial en caja')
    await user.type(cash, '9')

    resolveHandover({
      ok: true,
      data: {
        fromShiftId: 'prev',
        fromUserId: 'user-9',
        fromCashierName: 'Ana',
        fromClosedAt: '2026-09-11T16:00:00.000Z',
        bills: [{ denomination: 1000, quantity: 3 }],
        counted: true,
        cashLeft: 50000,
      },
    })

    await screen.findByText('Dejó Ana al cerrar')
    expect(cash).toHaveValue('9')
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
  })
})
