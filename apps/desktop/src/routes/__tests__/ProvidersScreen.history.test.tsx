import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProvidersScreen from '../ProvidersScreen'

const CAMARONES = 'a497ca07-3777-4855-be66-b6e47950886b'

describe('ProvidersScreen — historial de Oso', () => {
  beforeEach(() => {
    window.hw = {
      getProvidersWithDebt: vi.fn().mockResolvedValue({
        ok: true,
        data: [{
          id: '6f736f',
          name: 'Oso',
          total: 0,
          perStore: [{ storeId: CAMARONES, storeName: 'Camarones', balance: 0 }],
        }],
      }),
      getProviderDebtHistory: vi.fn().mockResolvedValue({
        ok: true,
        data: [{
          id: 'f2da4f63-78dc-4ac2-96d7-9b5630fda6c3',
          type: 'payment',
          amount: 255978,
          storeId: CAMARONES,
          storeName: 'Camarones',
          createdAt: '2026-11-25T19:19:45.844Z',
          createdByName: 'Admin Prueba',
          expenseId: null,
          notes: 'Ajuste de admin (Admin Prueba): dejó el saldo en $ 0',
        }],
      }),
      getStores: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: CAMARONES, name: 'Camarones', archivedAt: null }],
      }),
      getUiSettings: vi.fn().mockResolvedValue({ ok: true, data: { zoomFactor: 1, colorScheme: 'light' } }),
      setUiSettings: vi.fn().mockResolvedValue({ ok: true }),
      onUiSettingsChanged: vi.fn(() => () => undefined),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no se rompe si el historial llega como lista, sin openings', async () => {
    const user = userEvent.setup()
    render(<ProvidersScreen onBack={vi.fn()} onLogout={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Más acciones' }))
    await user.click(screen.getByRole('menuitem', { name: 'Historial' }))
    expect(await screen.findByText(/dejó el saldo en/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saldar deuda' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajustar deuda' })).toBeInTheDocument()
  })

  it('la cajera ve el saldo y no los botones de saldar, registrar ni ajustar', async () => {
    window.hw.getProviderDebtHistory = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        openings: [],
        events: [{
          id: 'deuda-oso',
          type: 'debt',
          amount: 5000,
          storeId: CAMARONES,
          storeName: 'Camarones',
          createdAt: '2026-11-26T11:20:49.286Z',
          createdByName: 'Ana',
          expenseId: null,
          notes: null,
        }],
      },
    })
    render(
      <ProvidersScreen
        onBack={vi.fn()}
        onLogout={vi.fn()}
        canManageDebt={false}
        focusAccount={{ providerId: '6f736f', providerName: 'Oso' }}
      />,
    )

    expect(await screen.findByText('Saldo actual (total)')).toBeInTheDocument()
    expect(screen.getAllByText(/5\.000/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Saldar deuda' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar deuda' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ajustar deuda' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Estado de los proveedores' })).not.toBeInTheDocument()
    expect(window.hw.getProvidersWithDebt).not.toHaveBeenCalled()
    expect(window.hw.getProviderDebtHistory).toHaveBeenCalledWith({ providerId: '6f736f' })
  })
})
