import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-key', default_store_id: 'store-1' })),
}))

vi.mock('../../licensing/storeSync', () => ({
  ensureStoresSynced: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/employeeSync', () => ({
  ensureEmployeesSynced: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedEmployeeOps: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/catalogSync', () => ({
  pullCatalogFromFirestore: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/catalogPublish', () => ({
  publishCatalog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/providerSync', () => ({
  pushUnsyncedProviders: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedDebtEvents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/orderSync', () => ({
  ensureOrdersSynced: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedOrders: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/customerDebtSync', () => ({
  ensureCustomerDebtsSynced: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedCustomerDebtOps: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/specialCustomerSync', () => ({
  ensureSpecialCustomersSynced: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedSpecialCustomerOps: vi.fn().mockResolvedValue(undefined),
}))

import { ipcMain } from 'electron'
import { getActiveSession } from '../../activeSession'
import { ensureStoresSynced } from '../../licensing/storeSync'
import { ensureEmployeesSynced } from '../../licensing/employeeSync'
import { pullCatalogFromFirestore } from '../../licensing/catalogSync'
import { publishCatalog } from '../../licensing/catalogPublish'
import { registerRefreshHandlers } from '../refresh.handler'
import { IPC } from '../channels'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

describe('refresh.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerRefreshHandlers()
  })

  it('rechaza sin sesión activa', async () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const handler = getHandler(IPC.REFRESH_REMOTE_DATA)
    const result = await handler({}) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SESSION')
  })

  it('sincroniza stores, empleados y catálogo con sesión activa', async () => {
    vi.mocked(getActiveSession).mockReturnValue({
      userId: 'u1',
      storeId: 'local1',
      role: 'cashier',
      shiftId: null,
    })
    const handler = getHandler(IPC.REFRESH_REMOTE_DATA)
    const result = await handler({}) as { ok: boolean; data: { storeId: string | null } }

    expect(result.ok).toBe(true)
    expect(result.data.storeId).toBe('local1')
    expect(ensureStoresSynced).toHaveBeenCalledWith('test-key')
    expect(ensureEmployeesSynced).toHaveBeenCalledWith('test-key')
    expect(pullCatalogFromFirestore).toHaveBeenCalledWith('test-key', 'local1')
    expect(publishCatalog).toHaveBeenCalledWith('test-key', 'local1')
  })

  it('omite pull/publish de catálogo si no hay storeId en sesión', async () => {
    vi.mocked(getActiveSession).mockReturnValue({
      userId: 'u1',
      storeId: '',
      role: 'admin',
      shiftId: null,
    })
    const handler = getHandler(IPC.REFRESH_REMOTE_DATA)
    const result = await handler({}) as { ok: boolean; data: { storeId: string | null } }

    expect(result.ok).toBe(true)
    expect(result.data.storeId).toBeNull()
    expect(pullCatalogFromFirestore).not.toHaveBeenCalled()
    expect(publishCatalog).not.toHaveBeenCalled()
    expect(ensureStoresSynced).toHaveBeenCalled()
    expect(ensureEmployeesSynced).toHaveBeenCalled()
  })
})
