import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  logoutAdmin: vi.fn(),
  getStoredAdminSession: vi.fn(),
}))

vi.mock('../../licensing/installation', () => ({
  activateInstallation: vi.fn(),
  signInAnon: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn().mockReturnValue({ tenant_id: 'TEST-LIC-001' }),
}))

vi.mock('../../licensing/employeeSync', () => ({
  pushUnsyncedEmployeeOps: vi.fn().mockResolvedValue(undefined),
  ensureEmployeesSynced: vi.fn().mockResolvedValue(undefined),
  stopEmployeeSyncListener: vi.fn(),
}))

vi.mock('../../licensing/orderSync', () => ({
  ensureOrdersSynced: vi.fn().mockResolvedValue(undefined),
  stopOrderSyncListener: vi.fn(),
}))

vi.mock('../../licensing/customerDebtSync', () => ({
  ensureCustomerDebtsSynced: vi.fn().mockResolvedValue(undefined),
  stopCustomerDebtSyncListener: vi.fn(),
}))

vi.mock('../../licensing/specialCustomerSync', () => ({
  ensureSpecialCustomersSynced: vi.fn().mockResolvedValue(undefined),
  stopSpecialCustomerSyncListener: vi.fn(),
}))

vi.mock('../../licensing/providerSync', () => ({
  startProviderSyncListener: vi.fn(),
  stopProviderSyncListener: vi.fn(),
  pushUnsyncedProviders: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedDebtEvents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/storeSync', () => ({
  startStoreSyncListener: vi.fn(),
  stopStoreSyncListener: vi.fn(),
  pushUnsyncedStores: vi.fn().mockResolvedValue(undefined),
  pullStoresFromFirestore: vi.fn().mockResolvedValue(undefined),
  ensureStoresSynced: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/catalogPublish', () => ({
  publishCatalog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/mobileSync', () => ({
  startMobileSyncListener: vi.fn(),
  stopMobileSyncListener: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  setActiveSession: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { signInWithRole, loginAdmin } from '../../licensing/session'
import { setActiveSession } from '../../activeSession'
import { registerAuthHandlers } from '../auth.handler'

type HandlerFn = (_event: unknown, payload: unknown) => Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

/** Mockea getDb() soportando select().from().where().limit().all(), insert().values().run() y update().set().where().run(). */
function mockDbWithUser(existingUser: Record<string, unknown> | undefined) {
  const rows = existingUser ? [existingUser] : []
  const selectChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(rows) }),
      }),
    }),
  }
  const insertChain = { values: vi.fn().mockReturnValue({ run: vi.fn() }) }
  const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }) }

  vi.mocked(getDb).mockReturnValue({
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
  } as unknown as ReturnType<typeof getDb>)

  return { insertChain, updateChain }
}

describe('auth.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'production'
    registerAuthHandlers()
  })

  describe('ACTIVATE_INSTALLATION', () => {
    it('retorna ok en dev sin llamar Firebase', async () => {
      process.env['APP_ENV'] = 'dev'
      const handler = getHandler('ipc:activate-installation')
      const result = await handler({}, { licenseKey: 'LIC', activationCode: '1234' })
      expect(result).toMatchObject({ ok: true })
    })

    it('rechaza payload malformado', async () => {
      const handler = getHandler('ipc:activate-installation')
      const result = await handler({}, { licenseKey: '' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })
  })

  describe('LOGIN_CASHIER', () => {
    it('rechaza payload malformado (email inválido)', async () => {
      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { email: 'no-es-email', password: 'pw', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza si signInWithRole falla (credenciales inválidas o rol incorrecto)', async () => {
      vi.mocked(signInWithRole).mockResolvedValue({ ok: false, error: 'Credenciales incorrectas o sin conexión.' })

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { email: 'cajera1@negocio.com', password: 'wrong', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: false })
    })

    it('login exitoso crea el perfil local si no existía y retorna SessionInfo', async () => {
      const { insertChain } = mockDbWithUser(undefined)
      vi.mocked(signInWithRole).mockResolvedValue({
        ok: true,
        profile: { uid: 'uid-1', email: 'cajera1@negocio.com', role: 'cashier', authorizedStores: ['store-1'], displayName: 'Cajera Uno', active: true },
      })

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { email: 'cajera1@negocio.com', password: 'correct', storeId: 'store-1' }) as { ok: boolean; data: { role: string; userId: string } }

      expect(result.ok).toBe(true)
      expect(result.data.role).toBe('cashier')
      expect(result.data.userId).toBe('uid-1')
      expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ id: 'uid-1', firebaseUid: 'uid-1', storeId: 'store-1' }))
      expect(setActiveSession).toHaveBeenCalledWith({ userId: 'uid-1', storeId: 'store-1', role: 'cashier', shiftId: null, displayName: 'Cajera Uno' })
    })

    it('login exitoso reutiliza el perfil local existente sin volver a insertar', async () => {
      const { insertChain } = mockDbWithUser({ id: 'uid-1', storeId: 'store-1', name: 'Cajera Uno', active: true })
      vi.mocked(signInWithRole).mockResolvedValue({
        ok: true,
        profile: { uid: 'uid-1', email: 'cajera1@negocio.com', role: 'cashier', authorizedStores: ['store-1'], displayName: 'Cajera Uno', active: true },
      })

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { email: 'cajera1@negocio.com', password: 'correct', storeId: 'store-1' }) as { ok: boolean }

      expect(result.ok).toBe(true)
      expect(insertChain.values).not.toHaveBeenCalled()
    })

    it('rechaza si el perfil local existente está desactivado', async () => {
      mockDbWithUser({ id: 'uid-1', storeId: 'store-1', name: 'Cajera Uno', active: false })
      vi.mocked(signInWithRole).mockResolvedValue({
        ok: true,
        profile: { uid: 'uid-1', email: 'cajera1@negocio.com', role: 'cashier', authorizedStores: ['store-1'], displayName: 'Cajera Uno', active: true },
      })

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { email: 'cajera1@negocio.com', password: 'correct', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: false })
    })

    it('en dev omite la verificación de local autorizado', async () => {
      process.env['APP_ENV'] = 'dev'
      mockDbWithUser(undefined)
      vi.mocked(signInWithRole).mockResolvedValue({
        ok: true,
        profile: { uid: 'dev-cashier-x@dev.local', email: 'x@dev.local', role: 'cashier', authorizedStores: [], displayName: 'x', active: true },
      })

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { email: 'x@dev.local', password: 'cualquiera', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: true })
    })
  })

  describe('LOGIN_ADMIN', () => {
    it('retorna ok con credenciales correctas', async () => {
      vi.mocked(loginAdmin).mockResolvedValue({
        ok: true,
        session: { uid: 'admin-uid', email: 'admin@test.com', expiresAt: new Date() },
      })

      const handler = getHandler('ipc:login-admin')
      const result = await handler({}, { email: 'admin@test.com', password: 'pw123' }) as { ok: boolean; data: { role: string } }
      expect(result.ok).toBe(true)
      expect(result.data.role).toBe('admin')
    })

    it('retorna error con email inválido', async () => {
      const handler = getHandler('ipc:login-admin')
      const result = await handler({}, { email: 'not-an-email', password: 'pw' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('retorna error si el rol del perfil no es admin', async () => {
      vi.mocked(loginAdmin).mockResolvedValue({ ok: false, error: 'Esta cuenta no tiene el permiso necesario.' })

      const handler = getHandler('ipc:login-admin')
      const result = await handler({}, { email: 'cajera@test.com', password: 'pw123' })
      expect(result).toMatchObject({ ok: false })
    })
  })

  describe('LOGOUT', () => {
    it('rechaza payload sin role', async () => {
      const handler = getHandler('ipc:logout')
      const result = await handler({}, { storeId: 'store-1' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('retorna ok para logout de cajera y limpia la sesión activa', async () => {
      const handler = getHandler('ipc:logout')
      const result = await handler({}, { role: 'cashier', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: true })
      expect(setActiveSession).toHaveBeenCalledWith(null)
    })
  })
})
