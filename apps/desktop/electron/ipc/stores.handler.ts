import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, ne, isNull } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { stores, users, shifts, orders, storeProducts } from '../db/schema'
import { getActiveSession, updateActiveStore, setActiveSession } from '../activeSession'
import { syncCatalogWithFirestore, startCatalogSyncListener } from '../licensing/catalogSync'
import { startMobileSyncListener } from '../licensing/mobileSync'
import {
  startProviderSyncListener,
  pushUnsyncedProviders,
  pushUnsyncedDebtEvents,
} from '../licensing/providerSync'
import {
  pushUnsyncedStores,
  ensureStoresSynced,
} from '../licensing/storeSync'
import { pushUnsyncedEmployeeOps, ensureEmployeesSynced } from '../licensing/employeeSync'
import { ensureOrdersSynced, pushUnsyncedOrders } from '../licensing/orderSync'
import { ensureCustomerDebtsSynced, pushUnsyncedCustomerDebtOps } from '../licensing/customerDebtSync'
import { ensureSpecialCustomersSynced, pushUnsyncedSpecialCustomerOps } from '../licensing/specialCustomerSync'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, StoreRow, SessionInfo } from '../../src/types/hw-api'
import {
  ALL_WEEKDAYS,
  hoursFieldsForSave,
  parseHoursSchedule,
  serializeHoursSchedule,
  validateShiftHours,
  validateWeekSchedule,
  type StoreHoursBlock,
} from '@carniceria/shared'

const selectStoreSchema = z.object({
  storeId: z.string().min(1),
})

const hhmmOrEmpty = z.union([
  z.string().regex(/^\d{2}:\d{2}$/),
  z.literal('').transform(() => null as string | null),
  z.null(),
])

const weekdaySchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3),
  z.literal(4), z.literal(5), z.literal(6),
])

const hoursBlockSchema = z.object({
  days: z.array(weekdaySchema).max(7),
  morningStart: hhmmOrEmpty.optional().transform(v => v ?? null),
  morningEnd: hhmmOrEmpty.optional().transform(v => v ?? null),
  afternoonStart: hhmmOrEmpty.optional().transform(v => v ?? null),
  afternoonEnd: hhmmOrEmpty.optional().transform(v => v ?? null),
})

const hoursFieldsSchema = {
  morningStart: hhmmOrEmpty.optional(),
  morningEnd: hhmmOrEmpty.optional(),
  afternoonStart: hhmmOrEmpty.optional(),
  afternoonEnd: hhmmOrEmpty.optional(),
  hoursSchedule: z.array(hoursBlockSchema).max(7).optional().nullable(),
}

const createStoreSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.trim()),
  address: z.string().max(200).optional().transform(s => s?.trim() || null),
  ...hoursFieldsSchema,
})

const updateStoreSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).transform(s => s.trim()).optional(),
  address: z.string().max(200).transform(s => s?.trim() || null).nullable().optional(),
  ...hoursFieldsSchema,
})

type HoursFields = {
  morningStart: string | null
  morningEnd: string | null
  afternoonStart: string | null
  afternoonEnd: string | null
  hoursSchedule: string | null
}

function resolvedHoursFromPayload(payload: {
  morningStart?: string | null
  morningEnd?: string | null
  afternoonStart?: string | null
  afternoonEnd?: string | null
  hoursSchedule?: StoreHoursBlock[] | null
}, existing?: HoursFields): { ok: true; data: HoursFields } | { ok: false; error: string } {
  if (payload.hoursSchedule !== undefined) {
    const schedule = payload.hoursSchedule ?? []
    const error = validateWeekSchedule(schedule)
    if (error) return { ok: false, error }
    const fields = hoursFieldsForSave(schedule)
    return {
      ok: true,
      data: {
        morningStart: fields.morningStart ?? null,
        morningEnd: fields.morningEnd ?? null,
        afternoonStart: fields.afternoonStart ?? null,
        afternoonEnd: fields.afternoonEnd ?? null,
        hoursSchedule: serializeHoursSchedule(fields.hoursSchedule),
      },
    }
  }

  const hoursTouched = payload.morningStart !== undefined
    || payload.morningEnd !== undefined
    || payload.afternoonStart !== undefined
    || payload.afternoonEnd !== undefined
  if (!hoursTouched) {
    return {
      ok: true,
      data: existing ?? {
        morningStart: null,
        morningEnd: null,
        afternoonStart: null,
        afternoonEnd: null,
        hoursSchedule: null,
      },
    }
  }

  const next: StoreHoursBlock = {
    days: [...ALL_WEEKDAYS],
    morningStart: payload.morningStart !== undefined ? payload.morningStart : (existing?.morningStart ?? null),
    morningEnd: payload.morningEnd !== undefined ? payload.morningEnd : (existing?.morningEnd ?? null),
    afternoonStart: payload.afternoonStart !== undefined ? payload.afternoonStart : (existing?.afternoonStart ?? null),
    afternoonEnd: payload.afternoonEnd !== undefined ? payload.afternoonEnd : (existing?.afternoonEnd ?? null),
  }
  const error = validateShiftHours(next)
  if (error) return { ok: false, error }
  const fields = hoursFieldsForSave([next])
  return {
    ok: true,
    data: {
      morningStart: fields.morningStart ?? null,
      morningEnd: fields.morningEnd ?? null,
      afternoonStart: fields.afternoonStart ?? null,
      afternoonEnd: fields.afternoonEnd ?? null,
      hoursSchedule: serializeHoursSchedule(fields.hoursSchedule),
    },
  }
}

function toStoreRow(row: {
  id: string
  name: string
  address: string | null
  archivedAt?: string | null
  morningStart: string | null
  morningEnd: string | null
  afternoonStart: string | null
  afternoonEnd: string | null
  hoursSchedule: string | null
}): StoreRow {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? null,
    archivedAt: row.archivedAt ?? null,
    morningStart: row.morningStart ?? null,
    morningEnd: row.morningEnd ?? null,
    afternoonStart: row.afternoonStart ?? null,
    afternoonEnd: row.afternoonEnd ?? null,
    hoursSchedule: parseHoursSchedule(row.hoursSchedule),
  }
}

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
      if (store.archivedAt) return { ok: false, error: 'El local está eliminado y no puede seleccionarse.', code: 'STORE_ARCHIVED' }

      // Actualizar sesión activa con el local elegido
      updateActiveStore(storeId)

      // Upsert del usuario en la tabla local (caché de perfil) con el storeId seleccionado
      const existing = db.select().from(users).where(eq(users.id, session.userId)).all()[0]
      const resolvedDisplayName = (session.displayName?.trim() || existing?.name || '').trim()
      const latest = getActiveSession()
      if (latest && resolvedDisplayName && latest.displayName !== resolvedDisplayName) {
        setActiveSession({ ...latest, displayName: resolvedDisplayName })
      }
      if (existing) {
        const needsUpdate = existing.storeId !== storeId ||
          (resolvedDisplayName && existing.name !== resolvedDisplayName)
        if (needsUpdate) {
          db.update(users)
            .set({
              storeId,
              ...(resolvedDisplayName ? { name: resolvedDisplayName } : {}),
            })
            .where(eq(users.id, session.userId))
            .run()
        }
      } else {
        db.insert(users).values({
          id: session.userId,
          storeId,
          name: resolvedDisplayName || session.userId,
          firebaseUid: session.userId,
          role: 'cashier',
          active: true,
          createdAt: new Date().toISOString(),
        }).run()
      }

      // Catálogo: publica si esta PC es la vigente; baja solo si SQLite está vacío o Firestore es más nuevo.
      {
        const config = getBusinessConfig()
        try {
          await syncCatalogWithFirestore(config.tenant_id, storeId)
        } catch (err) {
          log.warn('[ipc:select-store] syncCatalogWithFirestore falló (no bloqueante)', err)
        }
        startCatalogSyncListener(config.tenant_id)
      }

      // Para cajeras: iniciar listeners de sincronización adicionales
      if (session.role === 'cashier') {
        const config = getBusinessConfig()
        startMobileSyncListener(config.tenant_id, storeId)

        // Sync de proveedores y pushear pendientes.
        startProviderSyncListener(config.tenant_id)
        pushUnsyncedProviders(config.tenant_id).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedProviders falló (no bloqueante)', err)
        )
        pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedDebtEvents falló (no bloqueante)', err)
        )
      }

      // Sync de locales: push + pull fresco + listener (ambos roles)
      {
        const config = getBusinessConfig()
        try {
          await ensureStoresSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:select-store] ensureStoresSynced falló (no bloqueante)', err)
        }
        try {
          await ensureEmployeesSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:select-store] ensureEmployeesSynced falló (no bloqueante)', err)
        }
        pushUnsyncedEmployeeOps(config.tenant_id).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedEmployeeOps falló (no bloqueante)', err)
        )
      }

      // Tras catálogo: pedidos / fiados / clientes especiales (precios especiales necesitan productos)
      {
        const config = getBusinessConfig()
        try {
          await ensureOrdersSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:select-store] ensureOrdersSynced falló (no bloqueante)', err)
        }
        try {
          await ensureCustomerDebtsSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:select-store] ensureCustomerDebtsSynced falló (no bloqueante)', err)
        }
        try {
          await ensureSpecialCustomersSynced(config.tenant_id)
        } catch (err) {
          log.warn('[ipc:select-store] ensureSpecialCustomersSynced falló (no bloqueante)', err)
        }
        pushUnsyncedOrders(config.tenant_id).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedOrders falló (no bloqueante)', err),
        )
        pushUnsyncedCustomerDebtOps(config.tenant_id).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedCustomerDebtOps falló (no bloqueante)', err),
        )
        pushUnsyncedSpecialCustomerOps(config.tenant_id).catch(err =>
          log.warn('[ipc:select-store] pushUnsyncedSpecialCustomerOps falló (no bloqueante)', err),
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
          displayName: resolvedDisplayName || session.displayName,
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
    const hours = resolvedHoursFromPayload(parsed.data)
    if (!hours.ok) return { ok: false, error: hours.error, code: 'INVALID_PAYLOAD' }

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
        morningStart: hours.data.morningStart,
        morningEnd: hours.data.morningEnd,
        afternoonStart: hours.data.afternoonStart,
        afternoonEnd: hours.data.afternoonEnd,
        hoursSchedule: hours.data.hoursSchedule,
      }).run()

      const config = getBusinessConfig()
      pushUnsyncedStores(config.tenant_id).catch(err =>
        log.warn('[ipc:create-store] pushUnsyncedStores falló (no bloqueante)', err)
      )

      log.info('[ipc:create-store] Local creado', { id, name })
      return {
        ok: true,
        data: toStoreRow({
          id,
          name,
          address: address ?? null,
          archivedAt: null,
          ...hours.data,
        }),
      }
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

      const hours = resolvedHoursFromPayload(parsed.data, {
        morningStart: existing.morningStart ?? null,
        morningEnd: existing.morningEnd ?? null,
        afternoonStart: existing.afternoonStart ?? null,
        afternoonEnd: existing.afternoonEnd ?? null,
        hoursSchedule: existing.hoursSchedule ?? null,
      })
      if (!hours.ok) return { ok: false, error: hours.error, code: 'INVALID_PAYLOAD' }

      const updatedName = name ?? existing.name
      const updatedAddress = address !== undefined ? address : existing.address

      db.update(stores).set({
        name: updatedName,
        address: updatedAddress ?? null,
        morningStart: hours.data.morningStart,
        morningEnd: hours.data.morningEnd,
        afternoonStart: hours.data.afternoonStart,
        afternoonEnd: hours.data.afternoonEnd,
        hoursSchedule: hours.data.hoursSchedule,
        syncedAt: null,
      }).where(eq(stores.id, id)).run()

      const config = getBusinessConfig()
      pushUnsyncedStores(config.tenant_id).catch(err =>
        log.warn('[ipc:update-store] pushUnsyncedStores falló (no bloqueante)', err)
      )

      log.info('[ipc:update-store] Local actualizado', { id, name: updatedName })
      return {
        ok: true,
        data: toStoreRow({
          id,
          name: updatedName,
          address: updatedAddress ?? null,
          archivedAt: existing.archivedAt ?? null,
          ...hours.data,
        }),
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
  ipcMain.handle(IPC.ARCHIVE_STORE, async (_event, payload: unknown): Promise<IpcResult<StoreRow>> => {
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
      if (existing.archivedAt) return { ok: false, error: 'El local ya está eliminado.', code: 'CONFLICT' }

      // No permitir archivar el único local activo
      const activeStores = db.select({ id: stores.id }).from(stores).where(isNull(stores.archivedAt)).all()
      if (activeStores.length <= 1) {
        return { ok: false, error: 'No se puede archivar el único local activo.', code: 'CONFLICT' }
      }

      const archivedAt = new Date().toISOString()
      db.update(stores).set({ archivedAt, syncedAt: null }).where(eq(stores.id, id)).run()

      try {
        const config = getBusinessConfig()
        await pushUnsyncedStores(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:archive-store] pushUnsyncedStores falló (no bloqueante)', err)
      }

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
  ipcMain.handle(IPC.UNARCHIVE_STORE, async (_event, payload: unknown): Promise<IpcResult<StoreRow>> => {
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
      if (!existing.archivedAt) return { ok: false, error: 'El local no está eliminado.', code: 'CONFLICT' }

      db.update(stores).set({ archivedAt: null, syncedAt: null }).where(eq(stores.id, id)).run()

      try {
        const config = getBusinessConfig()
        await pushUnsyncedStores(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:unarchive-store] pushUnsyncedStores falló (no bloqueante)', err)
      }

      log.info('[ipc:unarchive-store] Local desarchivado', { id, name: existing.name })
      return { ok: true, data: { id, name: existing.name, address: existing.address, archivedAt: null } }
    } catch (err) {
      log.error('[ipc:unarchive-store] Error inesperado', err)
      return { ok: false, error: 'Error al desarchivar el local.' }
    }
  })
}
