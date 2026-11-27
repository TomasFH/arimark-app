import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProvidersScreen from '../ProvidersScreen'

const CAMARONES = 'a497ca07-3777-4855-be66-b6e47950886b'
const SAN_MARTIN = 'b5a1e2c0-1111-4222-8333-444455556666'

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

  it('el corte se lee como saldo anterior a la fecha en que arranca la lista', async () => {
    window.hw.getProviderDebtHistory = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        openings: [{
          storeId: CAMARONES,
          storeName: 'Camarones',
          balance: 1000,
          hasCheckpoint: true,
          checkpointAt: '2026-11-20T00:00:00.000Z',
        }],
        events: [{
          id: 'deuda-oso',
          type: 'debt',
          amount: 5000,
          storeId: CAMARONES,
          storeName: 'Camarones',
          createdAt: '2026-11-26T15:00:00.000Z',
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
    expect(await screen.findByText('Saldo anterior al 26/11')).toBeInTheDocument()
  })

  it('desde Mercadería recibida abre en el local de la sesión y se puede cambiar', async () => {
    const user = userEvent.setup()
    window.hw.getStores = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: SAN_MARTIN, name: 'San Martín', archivedAt: null },
        { id: CAMARONES, name: 'Camarones', archivedAt: null },
      ],
    })
    window.hw.getProviderDebtHistory = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        openings: [],
        events: [
          {
            id: 'deuda-sm',
            type: 'debt',
            amount: 1000,
            storeId: SAN_MARTIN,
            storeName: 'San Martín',
            createdAt: '2026-11-26T11:00:00.000Z',
            createdByName: 'Ana',
            expenseId: null,
            notes: null,
          },
          {
            id: 'deuda-cam',
            type: 'debt',
            amount: 2000,
            storeId: CAMARONES,
            storeName: 'Camarones',
            createdAt: '2026-11-26T12:00:00.000Z',
            createdByName: 'Ana',
            expenseId: null,
            notes: null,
          },
        ],
      },
    })
    render(
      <ProvidersScreen
        onBack={vi.fn()}
        onLogout={vi.fn()}
        canManageDebt={false}
        sessionStoreId={SAN_MARTIN}
        focusAccount={{ providerId: '6f736f', providerName: 'Oso' }}
      />,
    )

    const tabs = await screen.findByRole('tablist', { name: 'Local del historial' })
    expect(within(tabs).getByRole('tab', { name: 'San Martín' })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Saldo — San Martín')).toBeInTheDocument()

    await user.click(within(tabs).getByRole('tab', { name: 'Todos' }))
    expect(within(tabs).getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: 'San Martín' })).toHaveAttribute('aria-selected', 'false')
  })

  it('el admin desde el hub abre el historial en Todos', async () => {
    const user = userEvent.setup()
    window.hw.getStores = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: SAN_MARTIN, name: 'San Martín', archivedAt: null },
        { id: CAMARONES, name: 'Camarones', archivedAt: null },
      ],
    })
    render(<ProvidersScreen onBack={vi.fn()} onLogout={vi.fn()} sessionStoreId={CAMARONES} />)
    await user.click(await screen.findByRole('button', { name: 'Más acciones' }))
    await user.click(screen.getByRole('menuitem', { name: 'Historial' }))

    const tabs = await screen.findByRole('tablist', { name: 'Local del historial' })
    expect(within(tabs).getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: 'Camarones' })).toHaveAttribute('aria-selected', 'false')
  })
})
