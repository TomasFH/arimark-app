import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import OpenShiftScreen from '../OpenShiftScreen'

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
})
