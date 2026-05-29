import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../licensing/session', () => ({
  startCashierSession: vi.fn(),
  endCashierSession: vi.fn(),
  loginAdmin: vi.fn(),
  logoutAdmin: vi.fn(),
  getStoredAdminSession: vi.fn(),
}))

vi.mock('../../licensing/installation', () => ({
  activateInstallation: vi.fn(),
  signInAnon: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn().mockReturnValue({ license_key: 'TEST-LIC-001' }),
}))

import { ipcMain } from 'electron'
import bcrypt from 'bcryptjs'
import { getDb } from '../../db/client'
import { startCashierSession, loginAdmin } from '../../licensing/session'
import { registerAuthHandlers } from '../auth.handler'

type HandlerFn = (_event: unknown, payload: unknown) => Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

describe('auth.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'sandbox'
    registerAuthHandlers()
  })

  describe('ACTIVATE_INSTALLATION', () => {
    it('retorna ok en sandbox sin llamar Firebase', async () => {
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
    it('rechaza si el usuario no existe', async () => {
      vi.mocked(getDb).mockReturnValue({
        query: { users: { findFirst: vi.fn().mockReturnValue(undefined) } },
      } as unknown as ReturnType<typeof getDb>)

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { username: 'noexiste', password: 'pw', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: false })
    })

    it('rechaza si la contraseña es incorrecta', async () => {
      vi.mocked(getDb).mockReturnValue({
        query: { users: { findFirst: vi.fn().mockReturnValue({ id: 'u1', active: true, passwordHash: 'hash' }) } },
      } as unknown as ReturnType<typeof getDb>)
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never)

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { username: 'cajera1', password: 'wrong', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: false })
    })

    it('login exitoso retorna SessionInfo', async () => {
      vi.mocked(getDb).mockReturnValue({
        query: { users: { findFirst: vi.fn().mockReturnValue({
          id: 'user-001', username: 'cajera1', active: true, passwordHash: 'hash',
        }) } },
      } as unknown as ReturnType<typeof getDb>)
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
      vi.mocked(startCashierSession).mockResolvedValue({
        ok: true,
        session: { token: 'tok', userId: 'user-001', storeId: 'store-1', expiresAt: new Date() },
      })

      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { username: 'cajera1', password: 'correct', storeId: 'store-1' }) as {ok: boolean, data: {role: string}}
      expect(result.ok).toBe(true)
      expect(result.data.role).toBe('cashier')
    })

    it('rechaza payload malformado', async () => {
      const handler = getHandler('ipc:login-cashier')
      const result = await handler({}, { username: '', password: 'pw', storeId: '' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })
  })

  describe('LOGIN_ADMIN', () => {
    it('retorna ok con credenciales correctas', async () => {
      vi.mocked(loginAdmin).mockResolvedValue({
        ok: true,
        session: { uid: 'admin-uid', email: 'admin@test.com', expiresAt: new Date() },
        user: {} as never,
      })

      const handler = getHandler('ipc:login-admin')
      const result = await handler({}, { email: 'admin@test.com', password: 'pw123' }) as {ok: boolean, data: {role: string}}
      expect(result.ok).toBe(true)
      expect(result.data.role).toBe('admin')
    })

    it('retorna error con email inválido', async () => {
      const handler = getHandler('ipc:login-admin')
      const result = await handler({}, { email: 'not-an-email', password: 'pw' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })
  })

  describe('LOGOUT', () => {
    it('rechaza payload sin role', async () => {
      const handler = getHandler('ipc:logout')
      const result = await handler({}, { storeId: 'store-1' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('retorna ok para logout de cajera', async () => {
      vi.mocked(startCashierSession)
      const handler = getHandler('ipc:logout')
      const result = await handler({}, { role: 'cashier', storeId: 'store-1' })
      expect(result).toMatchObject({ ok: true })
    })
  })
})
