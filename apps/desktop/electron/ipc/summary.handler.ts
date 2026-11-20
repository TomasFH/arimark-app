/**
 * Resumen del admin: un local, un rango. La plata sale de la ficha del turno.
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import { getActiveSession } from '../activeSession'
import { getDb } from '../db/client'
import { stores, customers } from '../db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { isFirebaseAvailable } from '../licensing/firebase'
import { loadAdminSummary } from '../summary/loadAdminSummary'
import { loadCustomerHistory } from '../summary/customerHistory'
import { loadPeriodFiado } from '../summary/periodFiado'
import { loadSummaryExpenses } from '../summary/loadSummaryExpenses'
import type { IpcResult } from '../../src/types/hw-api'
import type { AdminSummaryData } from '../summary/loadAdminSummary'
import { storeLiveFiadoBalance, type CustomerHistoryPage, type PeriodFiadoAccount, type SummaryExpenseInput } from '@carniceria/shared'
import { getLiveCustomerPairs } from '../licensing/debtBalanceLive'

const summarySchema = z.object({
  storeId: z.string().min(1).max(128),
  startIso: z.string().min(10).max(40),
  endIso: z.string().min(10).max(40),
}).refine(data => data.startIso < data.endIso, { message: 'Rango inválido' })

const fiadoNowSchema = z.object({
  storeId: z.string().min(1).max(128),
})

const periodFiadoSchema = z.object({
  storeId: z.string().min(1).max(128),
  startIso: z.string().min(10).max(40),
  endIso: z.string().min(10).max(40),
}).refine(data => data.startIso < data.endIso, { message: 'Rango inválido' })

const summaryCustomersSchema = z.object({
  storeIds: z.array(z.string().min(1).max(128)).min(1).max(20),
})

const customerHistorySchema = z.object({
  customerId: z.string().min(1).max(128),
  storeId: z.string().min(1).max(128),
  more: z.boolean(),
})

const expenseShiftSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().min(1).max(128),
  startedAt: z.string().min(10).max(40),
})

const expenseDetailSchema = z.object({
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

  ipcMain.handle(IPC.GET_ADMIN_FIADO_NOW, async (_event, payload: unknown): Promise<IpcResult<{ debtNow: number | null }>> => {
    const parsed = fiadoNowSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-admin-fiado-now] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo los administradores pueden ver el resumen.', code: 'FORBIDDEN' }
    }

    const store = getDb().select({ id: stores.id, archivedAt: stores.archivedAt })
      .from(stores)
      .where(eq(stores.id, parsed.data.storeId))
      .get()
    if (!store || store.archivedAt) {
      return { ok: false, error: 'El local no existe.', code: 'NOT_FOUND' }
    }

    return {
      ok: true,
      data: { debtNow: storeLiveFiadoBalance(parsed.data.storeId, getLiveCustomerPairs()) },
    }
  })

  ipcMain.handle(IPC.GET_PERIOD_FIADO, async (_event, payload: unknown): Promise<IpcResult<PeriodFiadoAccount>> => {
    const parsed = periodFiadoSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-period-fiado] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo los administradores pueden ver el resumen.', code: 'FORBIDDEN' }
    }

    const store = getDb().select({ id: stores.id, archivedAt: stores.archivedAt })
      .from(stores)
      .where(eq(stores.id, parsed.data.storeId))
      .get()
    if (!store || store.archivedAt) {
      return { ok: false, error: 'El local no existe.', code: 'NOT_FOUND' }
    }
    if (!isFirebaseAvailable()) {
      return { ok: false, error: 'No se pudo leer el fiado del período.', code: 'OFFLINE' }
    }

    try {
      const data = await loadPeriodFiado(parsed.data)
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:get-period-fiado] Error inesperado', err)
      return { ok: false, error: 'No se pudo leer el fiado del período.' }
    }
  })

  ipcMain.handle(IPC.GET_SUMMARY_CUSTOMERS, (_event, payload: unknown): IpcResult<Array<{ id: string; name: string; storeId: string }>> => {
    const parsed = summaryCustomersSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-summary-customers] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo los administradores pueden ver el resumen.', code: 'FORBIDDEN' }
    }

    const ids = [...new Set(parsed.data.storeIds)]
    const db = getDb()
    const found = db.select({ id: stores.id, archivedAt: stores.archivedAt })
      .from(stores)
      .where(inArray(stores.id, ids))
      .all()
    const open = new Set(found.filter(store => !store.archivedAt).map(store => store.id))
    if (ids.some(id => !open.has(id))) {
      return { ok: false, error: 'El local no existe.', code: 'NOT_FOUND' }
    }

    const people = db.select({ id: customers.id, name: customers.name, storeId: customers.storeId })
      .from(customers)
      .where(inArray(customers.storeId, ids))
      .all()
      .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id))
    return { ok: true, data: people }
  })

  ipcMain.handle(IPC.GET_CUSTOMER_DEBT_HISTORY, async (_event, payload: unknown): Promise<IpcResult<CustomerHistoryPage>> => {
    const parsed = customerHistorySchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-customer-debt-history] Payload inválido', parsed.error)
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
    const customer = db.select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, parsed.data.customerId), eq(customers.storeId, parsed.data.storeId)))
      .get()
    if (!customer) {
      return { ok: false, error: 'El cliente no está en esta PC.', code: 'NOT_FOUND' }
    }
    if (!isFirebaseAvailable()) {
      return { ok: false, error: 'No se pudo leer el historial.', code: 'OFFLINE' }
    }

    try {
      const data = await loadCustomerHistory(parsed.data)
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:get-customer-debt-history] Error inesperado', err)
      return { ok: false, error: 'No se pudo leer el historial.' }
    }
  })
}
