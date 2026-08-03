/**
 * IPC de vales / adelantos de salario.
 *
 * Canales:
 *   REGISTER_VALE            — turno activo; inserta vale + gasto (afecta cashInHand)
 *   LIST_VALES               — por empleado y rango opcional de fechas
 *   GET_WEEKLY_VALE_SUMMARY  — sueldo − vales de la semana
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { employees, employeeVales, expenses } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedExpenses } from '../licensing/expenseSync'
import { pushUnsyncedVales } from '../licensing/employeeSync'
import type {
  IpcResult,
  EmployeeValeRow,
  ValeItem,
  WeeklyValeSummary,
} from '../../src/types/hw-api'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const valeItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1).max(200),
  unit: z.enum(['kg', 'unit']),
  quantity: z.number().positive(),
  unitPrice: z.number().int().nonnegative(),
  subtotal: z.number().int().nonnegative(),
})

const registerSchema = z.object({
  employeeId: z.string().min(1),
  amount: z.number().int().positive().max(999_999_999),
  description: z.string().max(200).transform(s => s.trim()).optional().nullable(),
  items: z.array(valeItemSchema).max(50).optional().nullable(),
})

const listSchema = z.object({
  employeeId: z.string().min(1),
  weekStart: dateSchema.optional(),
  weekEnd: dateSchema.optional(),
})

const summarySchema = z.object({
  employeeId: z.string().min(1),
  weekStart: dateSchema,
})

function addDaysUtc(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function dayRangeBounds(start: string, end: string): { from: string; to: string } {
  return {
    from: `${start}T00:00:00.000Z`,
    to: `${end}T23:59:59.999Z`,
  }
}

function toValeRow(row: typeof employeeVales.$inferSelect): EmployeeValeRow {
  let parsedItems: EmployeeValeRow['items'] = null
  if (row.items) {
    try {
      parsedItems = JSON.parse(row.items) as EmployeeValeRow['items']
    } catch {
      parsedItems = null
    }
  }
  return {
    id: row.id,
    employeeId: row.employeeId,
    shiftId: row.shiftId,
    amount: row.amount,
    description: row.description ?? null,
    items: parsedItems,
    paidAt: row.paidAt,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
  }
}

export function registerValesHandlers(): void {
  // --------------------------------------------------------------------------
  // REGISTER_VALE
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.REGISTER_VALE, (_event, payload: unknown): IpcResult<EmployeeValeRow> => {
    const parsed = registerSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:register-vale] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) {
      return { ok: false, error: 'Se requiere un turno abierto para registrar un vale.', code: 'NO_SHIFT' }
    }

    const { employeeId, amount } = parsed.data
    const description = parsed.data.description === undefined
      ? null
      : (parsed.data.description || null)
    const items: ValeItem[] | null = parsed.data.items?.length
      ? (parsed.data.items as ValeItem[])
      : null

    try {
      const db = getDb()
      const employee = db.select().from(employees).where(eq(employees.id, employeeId)).all()[0]
      if (!employee) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
      if (!employee.active) {
        return { ok: false, error: 'El empleado está archivado.', code: 'CONFLICT' }
      }

      const now = new Date().toISOString()
      const valeId = uuidv4()
      const expenseId = uuidv4()
      const concept = `Vale: ${employee.name}`.slice(0, 80)

      db.transaction(tx => {
        tx.insert(employeeVales).values({
          id: valeId,
          employeeId,
          shiftId: session.shiftId,
          amount,
          description,
          items: items ? JSON.stringify(items) : null,
          paidAt: now,
          recordedBy: session.userId,
          createdAt: now,
          syncedAt: null,
        }).run()

        // Sale de efectivo de la caja del turno (GET_SHIFT_SUMMARY resta expenses).
        tx.insert(expenses).values({
          id: expenseId,
          storeId: session.storeId,
          shiftId: session.shiftId!,
          concept,
          providerId: null,
          amount,
          notes: description,
          createdAt: now,
          createdBy: session.userId,
          syncedAt: null,
        }).run()
      })

      const config = getBusinessConfig()
      pushUnsyncedExpenses(config.tenant_id).catch(err =>
        log.warn('[ipc:register-vale] pushUnsyncedExpenses falló (no bloqueante)', err),
      )
      pushUnsyncedVales(config.tenant_id).catch(err =>
        log.warn('[ipc:register-vale] pushUnsyncedVales falló (no bloqueante)', err),
      )

      log.info('[ipc:register-vale] Vale registrado', { valeId, employeeId, amount, expenseId })
      return {
        ok: true,
        data: {
          id: valeId,
          employeeId,
          shiftId: session.shiftId,
          amount,
          description,
          items,
          paidAt: now,
          recordedBy: session.userId,
          createdAt: now,
        },
      }
    } catch (err) {
      log.error('[ipc:register-vale] Error inesperado', err)
      return { ok: false, error: 'Error al registrar el vale.' }
    }
  })

  // --------------------------------------------------------------------------
  // LIST_VALES
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.LIST_VALES, (_event, payload: unknown): IpcResult<EmployeeValeRow[]> => {
    const parsed = listSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:list-vales] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { employeeId, weekStart, weekEnd } = parsed.data
    if ((weekStart && !weekEnd) || (!weekStart && weekEnd)) {
      return {
        ok: false,
        error: 'weekStart y weekEnd deben enviarse juntos.',
        code: 'INVALID_PAYLOAD',
      }
    }
    if (weekStart && weekEnd && weekStart > weekEnd) {
      return { ok: false, error: 'weekStart no puede ser posterior a weekEnd.', code: 'INVALID_PAYLOAD' }
    }

    try {
      const db = getDb()
      const conditions = [eq(employeeVales.employeeId, employeeId)]
      if (weekStart && weekEnd) {
        const { from, to } = dayRangeBounds(weekStart, weekEnd)
        conditions.push(gte(employeeVales.paidAt, from))
        conditions.push(lte(employeeVales.paidAt, to))
      }

      const rows = db.select().from(employeeVales).where(and(...conditions)).all()
      rows.sort((a, b) => a.paidAt.localeCompare(b.paidAt))
      return { ok: true, data: rows.map(toValeRow) }
    } catch (err) {
      log.error('[ipc:list-vales] Error inesperado', err)
      return { ok: false, error: 'Error al listar vales.' }
    }
  })

  // --------------------------------------------------------------------------
  // GET_WEEKLY_VALE_SUMMARY
  // --------------------------------------------------------------------------
  ipcMain.handle(
    IPC.GET_WEEKLY_VALE_SUMMARY,
    (_event, payload: unknown): IpcResult<WeeklyValeSummary> => {
      const parsed = summarySchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:get-weekly-vale-summary] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
      }

      const session = getActiveSession()
      if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

      const { employeeId, weekStart } = parsed.data
      const weekEnd = addDaysUtc(weekStart, 6)

      try {
        const db = getDb()
        const employee = db.select().from(employees).where(eq(employees.id, employeeId)).all()[0]
        if (!employee) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }

        const { from, to } = dayRangeBounds(weekStart, weekEnd)
        const [agg] = db
          .select({ total: sql<number>`coalesce(sum(${employeeVales.amount}), 0)` })
          .from(employeeVales)
          .where(and(
            eq(employeeVales.employeeId, employeeId),
            gte(employeeVales.paidAt, from),
            lte(employeeVales.paidAt, to),
          ))
          .all()

        const totalVales = Number(agg?.total ?? 0)
        const weeklyWage = employee.weeklyWage
        const netToPay = Math.max(0, weeklyWage - totalVales)

        return {
          ok: true,
          data: {
            employeeId,
            weekStart,
            weekEnd,
            totalVales,
            weeklyWage,
            netToPay,
          },
        }
      } catch (err) {
        log.error('[ipc:get-weekly-vale-summary] Error inesperado', err)
        return { ok: false, error: 'Error al calcular el resumen de vales.' }
      }
    },
  )
}
