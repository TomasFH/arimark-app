import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminScreen from '../AdminScreen'
import type { SessionInfo } from '../../types/hw-api'

const CASHIER: SessionInfo = {
  role: 'cashier',
  userId: 'u-cashier',
  storeId: 's1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  displayName: 'Cajera',
}

const ADMIN: SessionInfo = {
  role: 'admin',
  userId: 'u-admin',
  storeId: 's1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  displayName: 'Admin',
}

function mockHw() {
  window.hw = {
    getStores: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: 's1', name: 'Local A' },
        { id: 's2', name: 'Local B' },
      ],
    }),
    getAllProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    onCatalogSyncUpdated: vi.fn(() => () => {}),
    listCatalogAudit: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  } as unknown as typeof window.hw
}

describe('AdminScreen — permisos de catálogo', () => {
  beforeEach(() => {
    mockHw()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cajera no ve Cargar en balanza ni Versiones, y el título no dice Administración', async () => {
    render(<AdminScreen session={CASHIER} onLogout={() => {}} onReturnToHub={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'Catálogo' })).toBeInTheDocument()
    expect(await screen.findByText('No hay productos cargados.')).toBeInTheDocument()
    expect(screen.queryByText('Cargar en balanza')).not.toBeInTheDocument()
    expect(screen.queryByText('Versiones')).not.toBeInTheDocument()
    expect(screen.queryByText('Administración — Productos')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Nuevo producto' })).toBeInTheDocument()
  })

  it('admin ve Cargar en balanza, Versiones y el título de administración', async () => {
    render(<AdminScreen session={ADMIN} onLogout={() => {}} onReturnToHub={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'Administración — Productos' })).toBeInTheDocument()
    expect(await screen.findByText('No hay productos cargados.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar en balanza' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Versiones' })).toBeInTheDocument()
  })
})
