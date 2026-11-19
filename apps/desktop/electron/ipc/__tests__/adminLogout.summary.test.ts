import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../licensing/session', () => ({
  signInWithRole: vi.fn(),
  loginAdmin: vi.fn(),
  logoutAdmin: vi.fn().mockResolvedValue(undefined),
  getStoredAdminSession: vi.fn(),
  signInAutoDetect: vi.fn(),
}))

vi.mock('../../licensing/passwordAuth', () => ({
  sendPasswordReset: vi.fn(),
  changeOwnPassword: vi.fn(),
}))

vi.mock('../../licensing/installation', () => ({
  activateInstallation: vi.fn(),
  signInAnon: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn().mockReturnValue({ tenant_id: 'TEST-LIC-001', default_store_id: 'store-1' }),
}))

vi.mock('../../licensing/employeeSync', () => ({
  pushUnsyncedEmployeeOps: vi.fn(),
  ensureEmployeesSynced: vi.fn(),
  stopEmployeeSyncListener: vi.fn(),
}))

vi.mock('../../licensing/orderSync', () => ({
  ensureOrdersSynced: vi.fn(),
  stopOrderSyncListener: vi.fn(),
}))

vi.mock('../../licensing/customerDebtSync', () => ({
  ensureCustomerDebtsSynced: vi.fn(),
  stopCustomerDebtSyncListener: vi.fn(),
}))

vi.mock('../../licensing/specialCustomerSync', () => ({
  ensureSpecialCustomersSynced: vi.fn(),
  stopSpecialCustomerSyncListener: vi.fn(),
}))

vi.mock('../../licensing/merchRubroSync', () => ({
  ensureMerchRubrosSynced: vi.fn(),
  stopMerchRubroSyncListener: vi.fn(),
}))

vi.mock('../../licensing/providerSync', () => ({
  startProviderSyncListener: vi.fn(),
  stopProviderSyncListener: vi.fn(),
  pushUnsyncedProviders: vi.fn(),
  pushUnsyncedDebtEvents: vi.fn(),
}))

vi.mock('../../licensing/storeSync', () => ({
  startStoreSyncListener: vi.fn(),
  stopStoreSyncListener: vi.fn(),
  pushUnsyncedStores: vi.fn(),
  pullStoresFromFirestore: vi.fn(),
  ensureStoresSynced: vi.fn(),
  publishButcherStoreList: vi.fn(),
}))

vi.mock('../../licensing/catalogSync', () => ({
  syncCatalogWithFirestore: vi.fn(),
  syncAllStoreCatalogs: vi.fn(),
  startCatalogSyncListener: vi.fn(),
  stopCatalogSyncListener: vi.fn(),
  ensureCatalogSynced: vi.fn(),
}))

vi.mock('../../licensing/mobileSync', () => ({
  startMobileSyncListener: vi.fn(),
  stopMobileSyncListener: vi.fn(),
}))

vi.mock('../../licensing/debtCheckpointJob', () => ({
  startDebtCheckpointJob: vi.fn(),
  stopDebtCheckpointJob: vi.fn(),
}))

vi.mock('../../licensing/debtBalanceLive', () => ({
  startDebtBalanceLiveSync: vi.fn(),
  stopDebtBalanceLiveSync: vi.fn(),
}))

vi.mock('../../secureStorage', () => ({
  setSecret: vi.fn(),
  SECRET_KEYS: { ADMIN_SESSION_TOKEN: 'admin-session' },
}))

vi.mock('../../offlineAuth', () => ({
  cacheCredentials: vi.fn(),
}))

vi.mock('../../offlineSessionWatch', () => ({
  startOfflineSessionWatch: vi.fn(),
  stopOfflineSessionWatch: vi.fn(),
}))

import { ipcMain } from 'electron'
import { IPC } from '../channels'
import { setActiveSession, getActiveSession } from '../../activeSession'
import { registerAuthHandlers } from '../auth.handler'
import { registerSummaryHandlers } from '../summary.handler'

type HandlerFn = (_event: unknown, payload: unknown) => Promise<{ ok: boolean; code?: string }>

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

describe('cierre de sesión del admin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActiveSession({
      userId: 'admin-1',
      storeId: 'store-1',
      role: 'admin',
      shiftId: null,
    })
    registerAuthHandlers()
    registerSummaryHandlers()
  })

  afterEach(() => {
    setActiveSession(null)
  })

  it('después de cerrar sesión, Resumen deja de autorizar', async () => {
    expect(getActiveSession()?.role).toBe('admin')

    const logout = await getHandler(IPC.LOGOUT)({}, { role: 'admin' })
    expect(logout).toMatchObject({ ok: true })
    expect(getActiveSession()).toBeNull()

    const summary = await getHandler(IPC.GET_ADMIN_SUMMARY)({}, {
      storeId: 'store-1',
      startIso: '2026-11-01T03:00:00.000Z',
      endIso: '2026-11-02T03:00:00.000Z',
    })
    const expenses = await getHandler(IPC.GET_SUMMARY_EXPENSES)({}, { shifts: [] })

    expect(summary).toMatchObject({ ok: false, code: 'NO_SESSION' })
    expect(expenses).toMatchObject({ ok: false, code: 'NO_SESSION' })
  })
})
