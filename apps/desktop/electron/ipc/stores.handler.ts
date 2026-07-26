import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, ne, isNull } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { stores, users, shifts, orders, storeProducts } from '../db/schema'
import { getActiveSession, updateActiveStore } from '../activeSession'
import { publishCatalog } from '../licensing/catalogPublish'
import { startMobileSyncListener } from '../licensing/mobileSync'
import {
  startProviderSyncListener,
  pushUnsyncedProviders,
  pushUnsyncedDebtEvents,
} from '../licensing/providerSync'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, StoreRow, SessionInfo } from '../../src/types/hw-api'

const selectStoreSchema = z.object({
  storeId: z.string().min(1),
})

const createStoreSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.trim()),
  address: z.string().max(200).optional().transform(s => s?.trim() || null),
})

const updateStoreSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).transform(s => s.trim()).optional(),
  address: z.string().max(200).transform(s => s?.trim() || null).nullable().optional(),
  morningStart: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  morningEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  afternoonStart: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  afternoonEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
})

const storeIdSchema = z.object({
  id: z.string().min(1),
})

/** Comprueba si un local tiene datos asociados (turnos, pedidos o productos configurados). */
function storeHasData(db: ReturnType<typeof getDb>, storeId: string): boolean {
  const hasShifts = db.select({ id: shifts.id }).from(shifts).where(eq(shifts.storeId, storeId)).all().length > 0
  if (hasShifts) return true
  const hasOrders = db.select({ id: orders.id }).from(orders).where(eq(orders.storeId, storeId)).all().length > 0
  if (hasOrders) return true
  const hasProducts = db.select({ storeId: storeProducts.storeId }).from(storeProducts).where(eq(storeProducts.storeId, storeId)).all().length > 0
  return hasProducts
}

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

      // Verificar que el local existe y no está archivado
      const store = db.select({ id: stores.id, archivedAt: stores.archivedAt })
        .from(stores).where(eq(stores.id, storeId)).all()[0]
      if (!store) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }
      if (store.archivedAt) return { ok: false, error: 'El local está archivado y no puede seleccionarse.', code: 'STORE_ARCHIVED' }

      // Actualizar sesión activa con el local elegido
      updateActiveStore(storeId)

      // Upsert del usuario en la tabla local (caché de perfil) con el storeId seleccionado
      const existing = db.select().from(users).where(eq(users.id, session.userId)).all()[0]
      if (existing) {
        const needsUpdate = existing.storeId !== storeId ||
          (session.displayName && existing.name !== session.displayName)
        if (needsUpdate) {
          db.update(users)
            .set({
              storeId,
              ...(session.displayName ? { name: session.displayName } : {}),
            })
            .where(eq(users.id, session.userId))
            .run()
        }
      } else {
        db.insert(users).values({
          id: session.userId,
          storeId,
          name: session.displayName ?? session.userId,
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

        // Iniciar sync de proveedores y pushear pendientes.
        startProviderSyncListener(config.license_key)
        pushUnsyncedProviders(config.license_key).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedProviders falló (no bloqueante)', err)
        )
        pushUnsyncedDebtEvents(config.license_key).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedDebtEvents falló (no bloqueante)', err)
        )
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
  // GET_STORES — lista locales activos (no archivados) por defecto
  // --------------------------------------------------------------------------
  // Este handler ya existe en catalogAdmin.handler.ts como GET_STORES.
  // No se duplica aquí.

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

      // No permitir nombres duplicados entre locales activos
      const existing = db.select({ id: stores.id }).from(stores)
        .where(and(eq(stores.name, name), isNull(stores.archivedAt)))
        .all()[0]
      if (existing) return { ok: false, error: `Ya existe un local con el nombre "${name}".`, code: 'CONFLICT' }

      const id = uuidv4()
      db.insert(stores).values({
        id,
        name,
        address: address ?? null,
        createdAt: new Date().toISOString(),
      }).run()

      log.info('[ipc:create-store] Local creado', { id, name })
      return { ok: true, data: { id, name, address: address ?? null } }
    } catch (err) {
      log.error('[ipc:create-store] Error inesperado', err)
      return { ok: false, error: 'Error al crear el local.' }
    }
  })

  // --------------------------------------------------------------------------
  // UPDATE_STORE — solo admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATE_STORE, (_event, payload: unknown): IpcResult<StoreRow> => {
    const parsed = updateStoreSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-store] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden editar locales.', code: 'FORBIDDEN' }

    const { id, name, address } = parsed.data
    const { morningStart, morningEnd, afternoonStart, afternoonEnd } = parsed.data

    try {
      const db = getDb()

      const existing = db.select().from(stores).where(eq(stores.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      // Verificar que el nuevo nombre no esté en uso por otro local activo
      if (name) {
        const duplicate = db.select({ id: stores.id }).from(stores)
          .where(and(eq(stores.name, name), ne(stores.id, id), isNull(stores.archivedAt)))
          .all()[0]
        if (duplicate) return { ok: false, error: `Ya existe otro local con el nombre "${name}".`, code: 'CONFLICT' }
      }

      const updatedName = name ?? existing.name
      const updatedAddress = address !== undefined ? address : existing.address
      const updatedMorningStart = morningStart !== undefined ? morningStart : existing.morningStart
      const updatedMorningEnd = morningEnd !== undefined ? morningEnd : existing.morningEnd
      const updatedAfternoonStart = afternoonStart !== undefined ? afternoonStart : existing.afternoonStart
      const updatedAfternoonEnd = afternoonEnd !== undefined ? afternoonEnd : existing.afternoonEnd

      db.update(stores).set({
        name: updatedName,
        address: updatedAddress ?? null,
        morningStart: updatedMorningStart ?? null,
        morningEnd: updatedMorningEnd ?? null,
        afternoonStart: updatedAfternoonStart ?? null,
        afternoonEnd: updatedAfternoonEnd ?? null,
      }).where(eq(stores.id, id)).run()

      log.info('[ipc:update-store] Local actualizado', { id, name: updatedName })
      return {
        ok: true,
        data: {
          id,
          name: updatedName,
          address: updatedAddress ?? null,
          morningStart: updatedMorningStart ?? null,
          morningEnd: updatedMorningEnd ?? null,
          afternoonStart: updatedAfternoonStart ?? null,
          afternoonEnd: updatedAfternoonEnd ?? null,
        },
      }
    } catch (err) {
      log.error('[ipc:update-store] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el local.' }
    }
  })

  // --------------------------------------------------------------------------
  // DELETE_STORE — solo admin; solo si el local está vacío (sin datos)
  // Si tiene datos, el cliente debe usar ARCHIVE_STORE en su lugar.
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.DELETE_STORE, (_event, payload: unknown): IpcResult => {
    const parsed = storeIdSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:delete-store] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden eliminar locales.', code: 'FORBIDDEN' }

    const { id } = parsed.data

    try {
      const db = getDb()

      const existing = db.select().from(stores).where(eq(stores.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      // No permitir eliminar el único local activo
      const activeStores = db.select({ id: stores.id }).from(stores).where(isNull(stores.archivedAt)).all()
      if (activeStores.length <= 1 && !existing.archivedAt) {
        return { ok: false, error: 'No se puede eliminar el único local activo.', code: 'CONFLICT' }
      }

      // Bloquear si tiene datos; en ese caso el cliente debe ofrecer archivar
      if (storeHasData(db, id)) {
        return { ok: false, error: 'El local tiene datos registrados. Archivalo en su lugar para preservar el historial.', code: 'STORE_HAS_DATA' }
      }

      db.delete(stores).where(eq(stores.id, id)).run()

      log.info('[ipc:delete-store] Local eliminado', { id, name: existing.name })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:delete-store] Error inesperado', err)
      return { ok: false, error: 'Error al eliminar el local.' }
    }
  })

  // --------------------------------------------------------------------------
  // ARCHIVE_STORE — marca el local como archivado; preserva todos sus datos
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.ARCHIVE_STORE, (_event, payload: unknown): IpcResult<StoreRow> => {
    const parsed = storeIdSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:archive-store] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden archivar locales.', code: 'FORBIDDEN' }

    const { id } = parsed.data

    try {
      const db = getDb()

      const existing = db.select().from(stores).where(eq(stores.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }
      if (existing.archivedAt) return { ok: false, error: 'El local ya está archivado.', code: 'CONFLICT' }

      // No permitir archivar el único local activo
      const activeStores = db.select({ id: stores.id }).from(stores).where(isNull(stores.archivedAt)).all()
      if (activeStores.length <= 1) {
        return { ok: false, error: 'No se puede archivar el único local activo.', code: 'CONFLICT' }
      }

      const archivedAt = new Date().toISOString()
      db.update(stores).set({ archivedAt }).where(eq(stores.id, id)).run()

      log.info('[ipc:archive-store] Local archivado', { id, name: existing.name })
      return { ok: true, data: { id, name: existing.name, address: existing.address, archivedAt } }
    } catch (err) {
      log.error('[ipc:archive-store] Error inesperado', err)
      return { ok: false, error: 'Error al archivar el local.' }
    }
  })

  // --------------------------------------------------------------------------
  // UNARCHIVE_STORE — reactiva un local archivado
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UNARCHIVE_STORE, (_event, payload: unknown): IpcResult<StoreRow> => {
    const parsed = storeIdSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:unarchive-store] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden desarchivar locales.', code: 'FORBIDDEN' }

    const { id } = parsed.data

    try {
      const db = getDb()

      const existing = db.select().from(stores).where(eq(stores.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }
      if (!existing.archivedAt) return { ok: false, error: 'El local no está archivado.', code: 'CONFLICT' }

      db.update(stores).set({ archivedAt: null }).where(eq(stores.id, id)).run()

      log.info('[ipc:unarchive-store] Local desarchivado', { id, name: existing.name })
      return { ok: true, data: { id, name: existing.name, address: existing.address, archivedAt: null } }
    } catch (err) {
      log.error('[ipc:unarchive-store] Error inesperado', err)
      return { ok: false, error: 'Error al desarchivar el local.' }
    }
  })
}
