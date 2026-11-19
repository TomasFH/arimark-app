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
import { loadSummaryExpenses } from '../summary/loadSummaryExpenses'
import { loadSummarySaleHours } from '../summary/loadSummarySaleHours'
import type { IpcResult } from '../../src/types/hw-api'
import type { AdminSummaryData } from '../summary/loadAdminSummary'
import type { SoldHourBucket, SummaryExpenseInput } from '@carniceria/shared'

const summarySchema = z.object({
  storeId: z.string().min(1).max(128),
  startIso: z.string().min(10).max(40),
  endIso: z.string().min(10).max(40),
}).refine(data => data.startIso < data.endIso, { message: 'Rango inválido' })

const expenseShiftSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().min(1).max(128),
  startedAt: z.string().min(10).max(40),
})

const expenseDetailSchema = z.object({
  shifts: z.array(expenseShiftSchema).max(400),
})

const saleHoursSchema = z.object({
  ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shifts: z.array(expenseShiftSchema).max(400),
})

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

  ipcMain.handle(IPC.GET_SUMMARY_EXPENSES, async (_event, payload: unknown): Promise<IpcResult<SummaryExpenseInput[]>> => {
    const parsed = expenseDetailSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-summary-expenses] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo los administradores pueden ver el resumen.', code: 'FORBIDDEN' }
    }

    const db = getDb()
    for (const storeId of new Set(parsed.data.shifts.map(shift => shift.storeId))) {
      const store = db.select({ id: stores.id, archivedAt: stores.archivedAt })
        .from(stores)
        .where(eq(stores.id, storeId))
        .get()
      if (!store || store.archivedAt) {
        return { ok: false, error: 'El local no existe.', code: 'NOT_FOUND' }
      }
    }

    try {
      const data = await loadSummaryExpenses(parsed.data.shifts)
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:get-summary-expenses] Error inesperado', err)
      return { ok: false, error: 'Error al leer los gastos.' }
    }
  })

  ipcMain.handle(IPC.GET_SUMMARY_SALE_HOURS, async (_event, payload: unknown): Promise<IpcResult<SoldHourBucket[]>> => {
    const parsed = saleHoursSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-summary-sale-hours] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo los administradores pueden ver el resumen.', code: 'FORBIDDEN' }
    }

    const db = getDb()
    for (const storeId of new Set(parsed.data.shifts.map(shift => shift.storeId))) {
      const store = db.select({ id: stores.id, archivedAt: stores.archivedAt })
        .from(stores)
        .where(eq(stores.id, storeId))
        .get()
      if (!store || store.archivedAt) {
        return { ok: false, error: 'El local no existe.', code: 'NOT_FOUND' }
      }
    }

    try {
      const data = await loadSummarySaleHours(parsed.data.shifts.map(shift => shift.id), parsed.data.ymd)
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:get-summary-sale-hours] Error inesperado', err)
      return { ok: false, error: 'Error al leer las ventas.' }
    }
  })
}
