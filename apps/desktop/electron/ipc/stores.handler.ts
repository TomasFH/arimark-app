import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { stores, users } from '../db/schema'
import { getActiveSession, updateActiveStore } from '../activeSession'
import { publishCatalog } from '../licensing/catalogPublish'
import { startMobileSyncListener } from '../licensing/mobileSync'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, StoreRow, SessionInfo } from '../../src/types/hw-api'

const selectStoreSchema = z.object({
  storeId: z.string().uuid(),
})

const createStoreSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.trim()),
  address: z.string().max(200).optional().transform(s => s?.trim() || null),
})

export function registerStoresHandlers(): void {
  // --------------------------------------------------------------------------
  // SELECT_STORE — finaliza la sesión con el local elegido por el usuario
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.SELECT_STORE, async (_event, payload: unknown): Promise<IpcResult<SessionInfo>> => {
    const parsed = selectStoreSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:select-store] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { storeId } = parsed.data

    try {
      const db = getDb()

      // Verificar que el local existe
      const store = db.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).all()[0]
      if (!store) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      // Actualizar sesión activa con el local elegido
      updateActiveStore(storeId)

      // Upsert del usuario en la tabla local (caché de perfil) con el storeId seleccionado
      const existing = db.select().from(users).where(eq(users.id, session.userId)).all()[0]
      if (existing) {
        if (existing.storeId !== storeId) {
          db.update(users).set({ storeId }).where(eq(users.id, session.userId)).run()
        }
      } else {
        db.insert(users).values({
          id: session.userId,
          storeId,
          name: session.userId,
          firebaseUid: session.userId,
          role: 'cashier',
          active: true,
          createdAt: new Date().toISOString(),
        }).run()
      }

      // Para cajeras: iniciar sincronización con el local seleccionado
      if (session.role === 'cashier') {
        const config = getBusinessConfig()
        publishCatalog(config.license_key, storeId).catch(err =>
          log.warn('[ipc:select-store] publishCatalog falló (no bloqueante)', err)
        )
        startMobileSyncListener(config.license_key, storeId)
      }

      log.info('[ipc:select-store] Local seleccionado', { storeId, role: session.role })
      return {
        ok: true,
        data: {
          role: session.role,
          userId: session.userId,
          storeId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      }
    } catch (err) {
      log.error('[ipc:select-store] Error inesperado', err)
      return { ok: false, error: 'Error al seleccionar el local.' }
    }
  })

  // --------------------------------------------------------------------------
  // CREATE_STORE — solo admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.CREATE_STORE, (_event, payload: unknown): IpcResult<StoreRow> => {
    const parsed = createStoreSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-store] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden crear locales.', code: 'FORBIDDEN' }

    const { name, address } = parsed.data

    try {
      const db = getDb()

      // No permitir nombres duplicados
      const existing = db.select({ id: stores.id }).from(stores).where(eq(stores.name, name)).all()[0]
      if (existing) return { ok: false, error: `Ya existe un local con el nombre "${name}".`, code: 'CONFLICT' }

      const id = uuidv4()
      db.insert(stores).values({
        id,
        name,
        address: address ?? null,
        createdAt: new Date().toISOString(),
      }).run()

      log.info('[ipc:create-store] Local creado', { id, name })
      return { ok: true, data: { id, name } }
    } catch (err) {
      log.error('[ipc:create-store] Error inesperado', err)
      return { ok: false, error: 'Error al crear el local.' }
    }
  })
}
