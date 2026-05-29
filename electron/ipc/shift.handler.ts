import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { shifts } from '../db/schema'
import { getActiveSession, updateActiveShift } from '../activeSession'
import type { IpcResult, ShiftInfo } from '../../src/types/hw-api'

const openShiftSchema = z.object({
  shiftType: z.enum(['morning', 'evening']),
  openingCash: z.number().min(0),
})

export function registerShiftHandlers(): void {
  ipcMain.handle(IPC.GET_ACTIVE_SHIFT, (_event): IpcResult<ShiftInfo | null> => {
    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }

    try {
      const db = getDb()
      const shift = db
        .select()
        .from(shifts)
        .where(and(eq(shifts.storeId, session.storeId), isNull(shifts.closedAt)))
        .orderBy(desc(shifts.startedAt))
        .limit(1)
        .all()[0]

      if (!shift) {
        return { ok: true, data: null }
      }

      return {
        ok: true,
        data: {
          id: shift.id,
          storeId: shift.storeId,
          userId: shift.userId,
          shiftType: shift.shiftType,
          startedAt: shift.startedAt,
          openingCash: shift.openingCash,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-active-shift] Error inesperado', message)
      return { ok: false, error: 'Error al consultar el turno activo.' }
    }
  })

  ipcMain.handle(IPC.OPEN_SHIFT, (_event, payload: unknown): IpcResult<ShiftInfo> => {
    const parsed = openShiftSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:open-shift] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }

    try {
      const db = getDb()

      // Verificar que no haya ya un turno abierto para este local
      const existing = db
        .select()
        .from(shifts)
        .where(and(eq(shifts.storeId, session.storeId), isNull(shifts.closedAt)))
        .limit(1)
        .all()[0]

      if (existing) {
        return {
          ok: false,
          error: 'Ya existe un turno abierto para este local.',
          code: 'SHIFT_ALREADY_OPEN',
        }
      }

      const { shiftType, openingCash } = parsed.data
      const id = uuidv4()
      const now = new Date().toISOString()

      db.insert(shifts).values({
        id,
        storeId: session.storeId,
        userId: session.userId,
        shiftType,
        startedAt: now,
        openingCash,
      }).run()

      updateActiveShift(id)
      log.info('[ipc:open-shift] Turno abierto', { id, shiftType, openingCash })

      return {
        ok: true,
        data: { id, storeId: session.storeId, userId: session.userId, shiftType, startedAt: now, openingCash },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:open-shift] Error inesperado', message)
      return { ok: false, error: 'Error al abrir el turno.' }
    }
  })
}
