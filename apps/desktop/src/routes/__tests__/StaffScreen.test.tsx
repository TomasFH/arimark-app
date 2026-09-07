import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffScreen from '../StaffScreen'

describe('StaffScreen — acceso celular del carnicero', () => {
  beforeEach(() => {
    window.hw = {
      listCashiers: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      listEmployees: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            id: 'emp-1',
            name: 'Carnicero Uno',
            weeklyWage: 100000,
            active: true,
            createdAt: '2026-09-01T00:00:00.000Z',
            kind: 'butcher',
            homeStoreId: null,
            firebaseUid: null,
          },
          {
            id: 'emp-2',
            name: 'Carnicero Con Acceso',
            weeklyWage: 100000,
            active: true,
            createdAt: '2026-09-01T00:00:00.000Z',
            kind: 'butcher',
            homeStoreId: null,
            firebaseUid: 'uid-abc',
          },
        ],
      }),
      getStores: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      listVales: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      grantButcherAccess: vi.fn(),
      revokeButcherAccess: vi.fn(),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('en la ficha del carnicero ofrece Dar acceso y Revocar según tenga cuenta', async () => {
    const user = userEvent.setup()
    render(<StaffScreen onBack={() => {}} />)

    expect(await screen.findByText('Carnicero Uno')).toBeInTheDocument()
    expect(screen.getByText('Acceso celular')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Carnicero Uno/ }))
    expect(await screen.findByRole('button', { name: 'Dar acceso al celular' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revocar acceso' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    await user.click(screen.getByRole('button', { name: /Carnicero Con Acceso/ }))
    expect(await screen.findByRole('button', { name: 'Revocar acceso' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dar acceso al celular' })).not.toBeInTheDocument()
  })

  it('restablece el acceso existente sin pedir email', async () => {
    const user = userEvent.setup()
    vi.mocked(window.hw.grantButcherAccess).mockResolvedValue({ ok: true, data: { uid: 'uid-abc' } })
    render(<StaffScreen onBack={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /Carnicero Uno/ }))
    await user.click(await screen.findByRole('button', { name: 'Dar acceso al celular' }))

    expect(window.hw.grantButcherAccess).toHaveBeenCalledWith({ employeeId: 'emp-1' })
    expect(screen.queryByPlaceholderText('nombre@ejemplo.com')).not.toBeInTheDocument()
  })

  it('pide email solo si no hay cuenta previa', async () => {
    const user = userEvent.setup()
    vi.mocked(window.hw.grantButcherAccess).mockResolvedValue({
      ok: false,
      error: 'Ingresá el email para crear la cuenta.',
      code: 'EMAIL_REQUIRED',
    })
    render(<StaffScreen onBack={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /Carnicero Uno/ }))
    await user.click(await screen.findByRole('button', { name: 'Dar acceso al celular' }))

    expect(await screen.findByPlaceholderText('nombre@ejemplo.com')).toBeInTheDocument()
  })
})
