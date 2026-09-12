import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { ceboEntries, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedCebo, pullCeboForStoreWeek } from '../licensing/ceboSync'
import { mondayWeekRange } from '@carniceria/shared'
import type { IpcResult } from '../../src/types/hw-api'

export const CEBO_NOTES_MAX = 300

export interface CeboEntryRow {
  id: string
  quantityKg: number
  notes: string | null
  createdById: string
  createdByName: string
  createdAt: string
  updatedByName: string | null
  updatedAt: string | null
  canEdit: boolean
}

const listSchema = z.object({
  weekOffset: z.number().int().min(-104).max(0).optional(),
})

const registerSchema = z.object({
  quantityKg: z.number().positive().max(9_999),
  notes: z.string().max(CEBO_NOTES_MAX).optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  quantityKg: z.number().positive().max(9_999),
  notes: z.string().max(CEBO_NOTES_MAX).optional(),
})

function canEditCebo(
  role: 'cashier' | 'admin',
  userId: string,
  createdBy: string,
): boolean {
  return role === 'admin' || createdBy === userId
}

function namesById(db: ReturnType<typeof getDb>, ids: string[]): Map<string, string> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const rows = db.select({ id: users.id, name: users.name }).from(users).all()
    .filter(u => unique.includes(u.id))
  return new Map(rows.map(u => [u.id, u.name]))
}

export function registerCeboHandlers(): void {
  ipcMain.handle(IPC.LIST_SHIFT_CEBO, async (_event, payload: unknown): Promise<IpcResult<CeboEntryRow[]>> => {
    const parsed = listSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:list-shift-cebo] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const storeId = session.storeId
    const bounds = mondayWeekRange(parsed.data.weekOffset ?? 0)

    function mapRows(
      db: ReturnType<typeof getDb>,
      sessionRole: 'cashier' | 'admin',
      sessionUserId: string,
    ): CeboEntryRow[] {
      const rows = db
        .select()
        .from(ceboEntries)
        .where(and(
          eq(ceboEntries.storeId, storeId),
          gte(ceboEntries.createdAt, bounds.startIso),
          lt(ceboEntries.createdAt, bounds.endIso),
        ))
        .orderBy(desc(ceboEntries.createdAt))
        .all()

      const nameMap = namesById(db, [
        ...rows.map(r => r.createdBy),
        ...rows.map(r => r.updatedBy ?? ''),
      ])

      return rows.map(r => ({
        id: r.id,
        quantityKg: r.quantityKg,
        notes: r.notes,
        createdById: r.createdBy,
        createdByName: nameMap.get(r.createdBy) ?? r.createdBy,
        createdAt: r.createdAt,
        updatedByName: r.updatedBy ? (nameMap.get(r.updatedBy) ?? r.updatedBy) : null,
        updatedAt: r.updatedAt,
        canEdit: canEditCebo(sessionRole, sessionUserId, r.createdBy),
      }))
    }

    try {
      const db = getDb()
      let data = mapRows(db, session.role, session.userId)
      if (data.length === 0) {
        const config = getBusinessConfig()
        try {
          await pullCeboForStoreWeek(config.tenant_id, session.storeId, bounds.startIso, bounds.endIso)
        } catch (err) {
          log.warn('[ipc:list-shift-cebo] pullCeboForStoreWeek falló', err)
        }
        data = mapRows(db, session.role, session.userId)
      }
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:list-shift-cebo] Error inesperado', err)
      return { ok: false, error: 'Error al listar el cebo.' }
    }
  })

  ipcMain.handle(IPC.REGISTER_CEBO, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = registerSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:register-cebo] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    const id = uuidv4()
    const now = new Date().toISOString()
    const notes = parsed.data.notes?.trim() || null

    try {
      const db = getDb()
      db.insert(ceboEntries).values({
        id,
        storeId: session.storeId,
        shiftId: session.shiftId,
        quantityKg: parsed.data.quantityKg,
        notes,
        createdBy: session.userId,
        createdAt: now,
        syncedAt: null,
      }).run()

      const config = getBusinessConfig()
      pushUnsyncedCebo(config.tenant_id).catch(err =>
        log.warn('[ipc:register-cebo] pushUnsyncedCebo falló', err),
      )

      log.info('[ipc:register-cebo] Cebo registrado', { id, quantityKg: parsed.data.quantityKg })
      return { ok: true, data: { id } }
    } catch (err) {
      log.error('[ipc:register-cebo] Error inesperado', err)
      return { ok: false, error: 'Error al registrar el cebo.' }
    }
  })

  ipcMain.handle(IPC.UPDATE_CEBO, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = updateSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-cebo] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    try {
      const db = getDb()
      const existing = db.select().from(ceboEntries).where(eq(ceboEntries.id, parsed.data.id)).get()
      if (!existing) return { ok: false, error: 'Registro no encontrado.', code: 'NOT_FOUND' }
      if (existing.storeId !== session.storeId) {
        return { ok: false, error: 'Registro no encontrado.', code: 'NOT_FOUND' }
      }
      if (!canEditCebo(session.role, session.userId, existing.createdBy)) {
        return { ok: false, error: 'Solo podés editar el cebo que cargaste.', code: 'FORBIDDEN' }
      }

      const now = new Date().toISOString()
      db.update(ceboEntries).set({
        quantityKg: parsed.data.quantityKg,
        notes: parsed.data.notes?.trim() || null,
        updatedBy: session.userId,
        updatedAt: now,
        syncedAt: null,
      }).where(eq(ceboEntries.id, parsed.data.id)).run()

      const config = getBusinessConfig()
      pushUnsyncedCebo(config.tenant_id).catch(err =>
        log.warn('[ipc:update-cebo] pushUnsyncedCebo falló', err),
      )

      log.info('[ipc:update-cebo] Cebo actualizado', { id: parsed.data.id })
      return { ok: true, data: { id: parsed.data.id } }
    } catch (err) {
      log.error('[ipc:update-cebo] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el cebo.' }
    }
  })
}
