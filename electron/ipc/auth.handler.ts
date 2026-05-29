import { ipcMain } from 'electron'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'
import { setActiveSession } from '../activeSession'
import {
  startCashierSession,
  endCashierSession,
  loginAdmin,
  logoutAdmin,
  getStoredAdminSession,
} from '../licensing/session'
import { activateInstallation, signInAnon } from '../licensing/installation'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, SessionInfo } from '../../src/types/hw-api'

// ---------------------------------------------------------------------------
// Schemas de validación zod
// ---------------------------------------------------------------------------

const activatePayloadSchema = z.object({
  licenseKey: z.string().min(1),
  activationCode: z.string().min(1),
})

const cashierLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  storeId: z.string().min(1),
})

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const logoutSchema = z.object({
  role: z.enum(['cashier', 'admin']),
  storeId: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function registerAuthHandlers(): void {

  ipcMain.handle(IPC.ACTIVATE_INSTALLATION, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = activatePayloadSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:activate-installation] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
    if (APP_ENV === 'sandbox') {
      return { ok: true, data: undefined }
    }

    try {
      const uid = await signInAnon()
      const result = await activateInstallation(
        parsed.data.licenseKey,
        uid,
        parsed.data.activationCode
      )
      if (!result.ok) return { ok: false, error: result.error ?? 'Error de activación' }
      return { ok: true, data: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(IPC.LOGIN_CASHIER, async (_event, payload: unknown): Promise<IpcResult<SessionInfo>> => {
    const parsed = cashierLoginSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:login-cashier] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const { username, password, storeId } = parsed.data

    try {
      const db = getDb()
      const user = db.select().from(users).where(eq(users.username, username)).limit(1).all()[0]

      if (!user) {
        return { ok: false, error: 'Usuario no encontrado.' }
      }

      if (!user.active) {
        return { ok: false, error: 'Usuario desactivado. Contactar al administrador.' }
      }

      const valid = await bcrypt.compare(password, user.passwordHash)
      if (!valid) {
        return { ok: false, error: 'Contraseña incorrecta.' }
      }

      const config = getBusinessConfig()
      const sessionResult = await startCashierSession(config.license_key, storeId, user.id)

      if (!sessionResult.ok) {
        return { ok: false, error: sessionResult.error }
      }

      setActiveSession({ userId: user.id, storeId, shiftId: null })
      log.info('[ipc:login-cashier] Login exitoso', { username, storeId })
      return {
        ok: true,
        data: {
          role: 'cashier',
          userId: user.id,
          storeId,
          expiresAt: sessionResult.session.expiresAt.toISOString(),
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:login-cashier] Error inesperado', message)
      return { ok: false, error: 'Error interno al iniciar sesión.' }
    }
  })

  ipcMain.handle(IPC.LOGIN_ADMIN, async (_event, payload: unknown): Promise<IpcResult<SessionInfo>> => {
    const parsed = adminLoginSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:login-admin] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const result = await loginAdmin(parsed.data.email, parsed.data.password)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }

    return {
      ok: true,
      data: {
        role: 'admin',
        userId: result.session.uid,
        expiresAt: result.session.expiresAt.toISOString(),
      },
    }
  })

  ipcMain.handle(IPC.LOGOUT, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = logoutSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const { role, storeId } = parsed.data

    if (role === 'cashier' && storeId) {
      const config = getBusinessConfig()
      await endCashierSession(config.license_key, storeId)
      setActiveSession(null)
    } else if (role === 'admin') {
      await logoutAdmin()
    }

    return { ok: true, data: undefined }
  })
}

export { getStoredAdminSession }
