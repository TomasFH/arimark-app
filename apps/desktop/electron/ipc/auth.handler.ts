import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'
import { setActiveSession, getActiveSession } from '../activeSession'
import { signInWithRole, loginAdmin, logoutAdmin, getStoredAdminSession, signInAutoDetect } from '../licensing/session'
import { sendPasswordReset, changeOwnPassword } from '../licensing/passwordAuth'
import { cacheCredentials } from '../offlineAuth'
import { startOfflineSessionWatch, stopOfflineSessionWatch } from '../offlineSessionWatch'
import { activateInstallation, signInAnon } from '../licensing/installation'
import { getBusinessConfig } from '../businessConfig'
import { syncCatalogWithFirestore, syncAllStoreCatalogs, startCatalogSyncListener, stopCatalogSyncListener } from '../licensing/catalogSync'
import { startMobileSyncListener, stopMobileSyncListener } from '../licensing/mobileSync'
import {
  startProviderSyncListener,
  stopProviderSyncListener,
  pushUnsyncedProviders,
  pushUnsyncedDebtEvents,
} from '../licensing/providerSync'
import {
  stopStoreSyncListener,
  ensureStoresSynced,
} from '../licensing/storeSync'
import { pushUnsyncedEmployeeOps, ensureEmployeesSynced, stopEmployeeSyncListener } from '../licensing/employeeSync'
import { ensureOrdersSynced, stopOrderSyncListener } from '../licensing/orderSync'
import { ensureCustomerDebtsSynced, stopCustomerDebtSyncListener } from '../licensing/customerDebtSync'
import { ensureSpecialCustomersSynced, stopSpecialCustomerSyncListener } from '../licensing/specialCustomerSync'
import { ensureMerchRubrosSynced, stopMerchRubroSyncListener } from '../licensing/merchRubroSync'
import { startDebtCheckpointJob, stopDebtCheckpointJob } from '../licensing/debtCheckpointJob'
import { startDebtBalanceLiveSync, stopDebtBalanceLiveSync } from '../licensing/debtBalanceLive'
import { setSecret, SECRET_KEYS } from '../secureStorage'
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

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const logoutSchema = z.object({
  role: z.enum(['cashier', 'admin']),
  storeId: z.string().optional(),
})

const sendPasswordResetSchema = z.object({
  email: z.string().email().optional(),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
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

  ipcMain.handle(IPC.LOGIN, async (_event, payload: unknown): Promise<IpcResult<SessionInfo>> => {
    const parsed = loginSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:login] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const { email, password } = parsed.data
    const config = getBusinessConfig()

    try {
      const result = await signInAutoDetect(config.tenant_id, email, password)
      if (!result.ok) return { ok: false, error: result.error }

      const { profile } = result
      const offlineSession = result.offlineSession === true

      if (profile.role === 'admin') {
        // Flujo admin: guardar sesión en safeStorage
        const session = {
          uid: profile.uid,
          email: profile.email,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }
        await setSecret(SECRET_KEYS.ADMIN_SESSION_TOKEN, JSON.stringify(session))

        // Setear sesión activa con el local por defecto para que el admin
        // pueda operar turnos en modo cajera de emergencia sin error NO_SESSION.
        setActiveSession({
          userId: profile.uid,
          storeId: config.default_store_id,
          role: 'admin',
          shiftId: null,
          displayName: profile.displayName,
          email: profile.email,
          offlineSession,
        })

        // Upsert en la tabla users para que los FK de sales resuelvan cuando
        // el admin opera como cajera. El rol se guarda como 'cashier' porque
        // la tabla SQLite solo soporta ese rol; la identidad real (admin)
        // vive en Firestore. Ver AGENTS.md — "caché local de perfil".
        const db = getDb()
        const existing = db.select().from(users).where(eq(users.firebaseUid, profile.uid)).limit(1).all()[0]
        if (!existing) {
          db.insert(users).values({
            id: profile.uid,
            storeId: config.default_store_id,
            name: profile.displayName,
            firebaseUid: profile.uid,
            role: 'cashier',
            active: true,
            createdAt: new Date().toISOString(),
          }).run()
        } else if (existing.name !== profile.displayName) {
          db.update(users).set({ name: profile.displayName }).where(eq(users.id, existing.id)).run()
        }

        log.info('[ipc:login] Admin autenticado', { email, offlineSession })
        const adminConfig = getBusinessConfig()
        const runAdminRemoteSync = (): void => {
          startProviderSyncListener(adminConfig.tenant_id)
          pushUnsyncedProviders(adminConfig.tenant_id).catch(err =>
            log.warn('[ipc:login] pushUnsyncedProviders (admin) falló (no bloqueante)', err)
          )
          pushUnsyncedDebtEvents(adminConfig.tenant_id).catch(err =>
            log.warn('[ipc:login] pushUnsyncedDebtEvents (admin) falló (no bloqueante)', err)
          )
          pushUnsyncedEmployeeOps(adminConfig.tenant_id).catch(err =>
            log.warn('[ipc:login] pushUnsyncedEmployeeOps (admin) falló (no bloqueante)', err)
          )
          startCatalogSyncListener(adminConfig.tenant_id)
          startDebtBalanceLiveSync(adminConfig.tenant_id)
          startDebtCheckpointJob(adminConfig.tenant_id)
        }
        if (!offlineSession) {
          runAdminRemoteSync()
          try {
            await ensureStoresSynced(adminConfig.tenant_id)
          } catch (err) {
            log.warn('[ipc:login] ensureStoresSynced (admin) falló (no bloqueante)', err)
          }
          try {
            await ensureEmployeesSynced(adminConfig.tenant_id)
          } catch (err) {
            log.warn('[ipc:login] ensureEmployeesSynced (admin) falló (no bloqueante)', err)
          }
          try {
            await ensureOrdersSynced(adminConfig.tenant_id)
          } catch (err) {
            log.warn('[ipc:login] ensureOrdersSynced (admin) falló (no bloqueante)', err)
          }
          try {
            await ensureCustomerDebtsSynced(adminConfig.tenant_id)
          } catch (err) {
            log.warn('[ipc:login] ensureCustomerDebtsSynced (admin) falló (no bloqueante)', err)
          }
          try {
            await ensureSpecialCustomersSynced(adminConfig.tenant_id)
          } catch (err) {
            log.warn('[ipc:login] ensureSpecialCustomersSynced (admin) falló (no bloqueante)', err)
          }
          try {
            await ensureMerchRubrosSynced(adminConfig.tenant_id)
          } catch (err) {
            log.warn('[ipc:login] ensureMerchRubrosSynced (admin) falló (no bloqueante)', err)
          }
          try {
            await syncAllStoreCatalogs(adminConfig.tenant_id)
          } catch (err) {
            log.warn('[ipc:login] syncAllStoreCatalogs (admin) falló (no bloqueante)', err)
          }
        } else {
          startOfflineSessionWatch({
            licenseKey: config.tenant_id,
            email,
            password,
            onUpgraded: () => { runAdminRemoteSync() },
          })
        }
        return {
          ok: true,
          data: {
            role: 'admin',
            userId: profile.uid,
            expiresAt: session.expiresAt.toISOString(),
            displayName: profile.displayName,
            offlineSession,
          },
        }
      }

      // Flujo cajera: verificar estado activo si ya tiene perfil local
      // El storeId definitivo se establece en SELECT_STORE; aquí usamos el default temporalmente.
      const db = getDb()
      const existing = db
        .select()
        .from(users)
        .where(eq(users.firebaseUid, profile.uid))
        .limit(1)
        .all()[0]

      if (existing && !existing.active) {
        return { ok: false, error: 'Usuario desactivado. Contactar al administrador.' }
      }

      // Setear sesión parcial (storeId se actualizará en SELECT_STORE)
      setActiveSession({
        userId: profile.uid,
        storeId: config.default_store_id,
        role: 'cashier',
        shiftId: null,
        displayName: profile.displayName,
        email: profile.email,
        offlineSession,
      })

      if (!offlineSession) {
        // Crítico: bajar locales de Firestore ANTES de que el renderer llame getStores()
        // (el store picker / auto-select usa nombres de la cache SQLite).
        try {
          await ensureStoresSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:login] ensureStoresSynced (cajera) falló (no bloqueante)', err)
        }
        try {
          await ensureEmployeesSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:login] ensureEmployeesSynced (cajera) falló (no bloqueante)', err)
        }
        try {
          await ensureMerchRubrosSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:login] ensureMerchRubrosSynced (cajera) falló (no bloqueante)', err)
        }
        pushUnsyncedEmployeeOps(config.tenant_id).catch(err =>
          log.warn('[ipc:login] pushUnsyncedEmployeeOps (cajera) falló (no bloqueante)', err)
        )
        startCatalogSyncListener(config.tenant_id)
      } else {
        startOfflineSessionWatch({
          licenseKey: config.tenant_id,
          email,
          password,
          onUpgraded: () => {
            startCatalogSyncListener(config.tenant_id)
            ensureStoresSynced(config.tenant_id).catch(err =>
              log.warn('[ipc:login] ensureStoresSynced (upgrade) falló (no bloqueante)', err)
            )
          },
        })
      }

      log.info('[ipc:login] Cajera autenticada — pendiente selección de local', { email, offlineSession })
      return {
        ok: true,
        data: {
          role: 'cashier',
          userId: profile.uid,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          displayName: profile.displayName,
          offlineSession,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:login] Error inesperado', message)
      return { ok: false, error: 'Error interno al iniciar sesión.' }
    }
  })

  ipcMain.handle(IPC.LOGIN_CASHIER, async (_event, payload: unknown): Promise<IpcResult<SessionInfo>> => {
    const parsed = cashierLoginSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:login-cashier] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const { email, password, storeId } = parsed.data

    try {
      const config = getBusinessConfig()
      const result = await signInWithRole(config.tenant_id, email, password, 'cashier')
      if (!result.ok) {
        return { ok: false, error: result.error }
      }

      const { profile } = result
      const offlineSession = result.offlineSession === true

      // Las cajeras pueden operar en cualquier local activo.
      // No se verifica authorizedStores — la selección de local es libre.

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

      setActiveSession({
        userId: profile.uid,
        storeId,
        role: 'cashier',
        shiftId: null,
        displayName: profile.displayName,
        email: profile.email,
        offlineSession,
      })

      if (!offlineSession) {
      // Publicar o bajar catálogo según qué copia esté vigente.
      syncCatalogWithFirestore(config.tenant_id, storeId).catch(err =>
        log.warn('[ipc:login-cashier] syncCatalogWithFirestore falló (no bloqueante)', err)
      )
      startCatalogSyncListener(config.tenant_id)

      // Iniciar listener de importación de turnos móviles.
      startMobileSyncListener(config.tenant_id, storeId)

      // Iniciar sync de proveedores y pushear pendientes.
      startProviderSyncListener(config.tenant_id)
      pushUnsyncedProviders(config.tenant_id).catch(err =>
        log.warn('[ipc:login-cashier] pushUnsyncedProviders falló (no bloqueante)', err)
      )
      pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
        log.warn('[ipc:login-cashier] pushUnsyncedDebtEvents falló (no bloqueante)', err)
      )

      // Sync de locales (await: push pendientes + pull fresco + listener).
      try {
        await ensureStoresSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:login-cashier] ensureStoresSynced falló (no bloqueante)', err)
      }
      try {
        await ensureEmployeesSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:login-cashier] ensureEmployeesSynced falló (no bloqueante)', err)
      }
      try {
        await ensureOrdersSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:login-cashier] ensureOrdersSynced falló (no bloqueante)', err)
      }
      try {
        await ensureCustomerDebtsSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:login-cashier] ensureCustomerDebtsSynced falló (no bloqueante)', err)
      }
      try {
        await ensureSpecialCustomersSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:login-cashier] ensureSpecialCustomersSynced falló (no bloqueante)', err)
      }
      try {
        await ensureMerchRubrosSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:login-cashier] ensureMerchRubrosSynced falló (no bloqueante)', err)
      }
      pushUnsyncedEmployeeOps(config.tenant_id).catch(err =>
        log.warn('[ipc:login-cashier] pushUnsyncedEmployeeOps falló (no bloqueante)', err)
      )
      startDebtBalanceLiveSync(config.tenant_id)
      startDebtCheckpointJob(config.tenant_id)
      } else {
        startOfflineSessionWatch({
          licenseKey: config.tenant_id,
          email,
          password,
          onUpgraded: () => {
            startCatalogSyncListener(config.tenant_id)
            startMobileSyncListener(config.tenant_id, storeId)
          },
        })
      }

      log.info('[ipc:login-cashier] Login exitoso', { email, storeId, offlineSession })
      return {
        ok: true,
        data: {
          role: 'cashier',
          userId: profile.uid,
          storeId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          displayName: profile.displayName,
          offlineSession,
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
    const result = await loginAdmin(config.tenant_id, parsed.data.email, parsed.data.password)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }

    const offlineSession = result.offlineSession === true
    if (!offlineSession) {
    try {
      await syncAllStoreCatalogs(config.tenant_id)
    } catch (err) {
      log.warn('[ipc:login-admin] syncAllStoreCatalogs falló (no bloqueante)', err)
    }
    startCatalogSyncListener(config.tenant_id)
    } else {
      startOfflineSessionWatch({
        licenseKey: config.tenant_id,
        email: parsed.data.email,
        password: parsed.data.password,
        onUpgraded: () => { startCatalogSyncListener(config.tenant_id) },
      })
    }

    return {
      ok: true,
      data: {
        role: 'admin',
        userId: result.session.uid,
        expiresAt: result.session.expiresAt.toISOString(),
        offlineSession,
      },
    }
  })

  ipcMain.handle(IPC.LOGOUT, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = logoutSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const { role } = parsed.data

    stopOfflineSessionWatch()

    if (role === 'cashier') {
      stopMobileSyncListener()
      stopProviderSyncListener()
      stopStoreSyncListener()
      stopEmployeeSyncListener()
      stopOrderSyncListener()
      stopCustomerDebtSyncListener()
      stopSpecialCustomerSyncListener()
      stopMerchRubroSyncListener()
      stopCatalogSyncListener()
      stopDebtBalanceLiveSync()
      stopDebtCheckpointJob()
      setActiveSession(null)
    } else if (role === 'admin') {
      stopProviderSyncListener()
      stopStoreSyncListener()
      stopEmployeeSyncListener()
      stopOrderSyncListener()
      stopCustomerDebtSyncListener()
      stopSpecialCustomerSyncListener()
      stopMerchRubroSyncListener()
      stopCatalogSyncListener()
      stopDebtBalanceLiveSync()
      stopDebtCheckpointJob()
      await logoutAdmin()
    }

    return { ok: true, data: undefined }
  })

  ipcMain.handle(IPC.SEND_PASSWORD_RESET, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = sendPasswordResetSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:send-password-reset] Payload inválido', parsed.error)
      return { ok: false, error: 'Ingresá un email válido.', code: 'INVALID_PAYLOAD' }
    }

    const result = await sendPasswordReset(parsed.data.email)
    if (!result.ok) return { ok: false, error: result.error, code: result.code }
    return { ok: true, data: undefined }
  })

  ipcMain.handle(IPC.CHANGE_PASSWORD, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = changePasswordSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:change-password] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const { currentPassword, newPassword } = parsed.data
    if (currentPassword === newPassword) {
      return { ok: false, error: 'La nueva contraseña tiene que ser distinta a la actual.' }
    }

    const result = await changeOwnPassword(currentPassword, newPassword)
    if (!result.ok) return { ok: false, error: result.error, code: result.code }
    const session = getActiveSession()
    if (session?.email) {
      try {
        cacheCredentials(session.email, newPassword, {
          uid: session.userId,
          email: session.email,
          role: session.role,
          displayName: session.displayName ?? session.email,
          authorizedStores: [],
        })
      } catch (err) {
        log.warn('[ipc:change-password] No se pudo actualizar el hash offline', err)
      }
    }
    return { ok: true, data: undefined }
  })
}

export { getStoredAdminSession }
