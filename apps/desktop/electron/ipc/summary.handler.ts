/**
 * Resumen del admin: un local, un rango. La plata sale de la ficha del turno.
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import { getActiveSession } from '../activeSession'
import { getDb } from '../db/client'
import { stores } from '../db/schema'
import { eq } from 'drizzle-orm'
import { loadAdminSummary } from '../summary/loadAdminSummary'
import type { IpcResult } from '../../src/types/hw-api'
import type { AdminSummaryData } from '../summary/loadAdminSummary'

const summarySchema = z.object({
  storeId: z.string().min(1).max(128),
  startIso: z.string().min(10).max(40),
  endIso: z.string().min(10).max(40),
}).refine(data => data.startIso < data.endIso, { message: 'Rango inválido' })

export function registerSummaryHandlers(): void {
  ipcMain.handle(IPC.GET_ADMIN_SUMMARY, async (_event, payload: unknown): Promise<IpcResult<AdminSummaryData>> => {
    const parsed = summarySchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-admin-summary] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo los administradores pueden ver el resumen.', code: 'FORBIDDEN' }
    }

    const db = getDb()
    const store = db.select({ id: stores.id, archivedAt: stores.archivedAt })
      .from(stores)
      .where(eq(stores.id, parsed.data.storeId))
      .get()
    if (!store || store.archivedAt) {
      return { ok: false, error: 'El local no existe.', code: 'NOT_FOUND' }
    }

    try {
      const data = await loadAdminSummary(parsed.data)
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:get-admin-summary] Error inesperado', err)
      return { ok: false, error: 'Error al armar el resumen.' }
    }
  })
}
