import { ipcMain, BrowserWindow } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'
import { setActiveSession } from '../activeSession'
import { signInWithRole, loginAdmin, logoutAdmin, getStoredAdminSession } from '../licensing/session'
import { activateInstallation, signInAnon } from '../licensing/installation'
import { getBusinessConfig } from '../businessConfig'
import { startRelayListener, stopRelayListener } from '../licensing/relay'
import type { IpcResult, SessionInfo } from '../../src/types/hw-api'

// ---------------------------------------------------------------------------
// Schemas de validación zod
// ---------------------------------------------------------------------------

const activatePayloadSchema = z.object({
  licenseKey: z.string().min(1),
  activationCode: z.string().min(1),
})

const cashierLoginSchema = z.object({
  email: z.string().email(),
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

    const APP_ENV = process.env['APP_ENV'] ?? 'dev'
    if (APP_ENV === 'dev') {
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

    const { email, password, storeId } = parsed.data
    const APP_ENV = process.env['APP_ENV'] ?? 'dev'

    try {
      const config = getBusinessConfig()
      const result = await signInWithRole(config.license_key, email, password, 'cashier')
      if (!result.ok) {
        return { ok: false, error: result.error }
      }

      const { profile } = result

      // En dev no hay perfil real en Firestore (bypass) — se salta la
      // verificación de local autorizado. En producción, la cajera solo
      // puede operar los locales que su perfil habilita explícitamente.
      if (APP_ENV !== 'dev' && !profile.authorizedStores.includes(storeId)) {
        log.warn('[ipc:login-cashier] Local no autorizado', { uid: profile.uid, storeId })
        return { ok: false, error: 'No autorizado para operar en este local.' }
      }

      const db = getDb()
      const existing = db
        .select()
        .from(users)
        .where(eq(users.firebaseUid, profile.uid))
        .limit(1)
        .all()[0]

      if (!existing) {
        db.insert(users)
          .values({
            id: profile.uid,
            storeId,
            name: profile.displayName,
            firebaseUid: profile.uid,
            role: 'cashier',
            active: true,
            createdAt: new Date().toISOString(),
          })
          .run()
        log.info('[ipc:login-cashier] Perfil local creado', { uid: profile.uid, storeId })
      } else if (!existing.active) {
        return { ok: false, error: 'Usuario desactivado. Contactar al administrador.' }
      } else if (existing.storeId !== storeId || existing.name !== profile.displayName) {
        db.update(users)
          .set({ storeId, name: profile.displayName })
          .where(eq(users.id, existing.id))
          .run()
      }

      setActiveSession({ userId: profile.uid, storeId, shiftId: null })

      // Iniciar listener de relay para recibir barcodes desde la PWA móvil.
      // Los dígitos aceptados se reenvían al renderer via IPC RELAY_SCAN,
      // usando el mismo camino que el lector USB físico.
      startRelayListener(config.license_key, storeId, (digits: string) => {
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send(IPC.RELAY_SCAN, digits)
        })
      })

      log.info('[ipc:login-cashier] Login exitoso', { email, storeId })
      return {
        ok: true,
        data: {
          role: 'cashier',
          userId: profile.uid,
          storeId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
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

    const config = getBusinessConfig()
    const result = await loginAdmin(config.license_key, parsed.data.email, parsed.data.password)
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

    const { role } = parsed.data

    if (role === 'cashier') {
      stopRelayListener()
      setActiveSession(null)
    } else if (role === 'admin') {
      await logoutAdmin()
    }

    return { ok: true, data: undefined }
  })
}

export { getStoredAdminSession }
