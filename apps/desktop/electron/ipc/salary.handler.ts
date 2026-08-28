/**
 * IPC de pago de salario semanal.
 *
 * Canales:
 *   PAY_WEEKLY_SALARY        — turno activo; inserta salary_payments + gasto (cashInHand)
 *   LIST_SALARY_PAYMENTS     — pagos locales de una semana (weekStart = lunes)
 *   GET_REMOTE_SALARY_WEEK   — pagos + vales de esa semana en Firestore (recorte, no colección entera)
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { employees, expenses, salaryPayments } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { weekStartMondayLocalYmd } from '../../src/lib/datetime'
import { pushUnsyncedExpenses } from '../licensing/expenseSync'
import { pushUnsyncedSalaryPayments } from '../licensing/employeeSync'
import {
  fetchSalaryPaymentsByWeekStart,
  fetchValesInPaidAtRange,
  firestorePaidAtBounds,
} from '../licensing/salaryFirestore'
import type {
  IpcResult,
  RemoteSalaryWeek,
  SalaryPaymentRow,
  SalaryValeSnapshotItem,
} from '../../src/types/hw-api'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const valeSnapshotItemSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().positive().max(999_999_999),
  description: z.string().max(200).nullable().optional(),
  paidAt: z.string().min(1).max(40),
})

const paySchema = z.object({
  employeeId: z.string().min(1),
  weekStart: dateSchema,
  /** Monto bruto de la liquidación (sueldo de la semana). */
  amount: z.number().int().positive().max(999_999_999),
  /** Vales a descontar de esa semana. */
  valesDeducted: z.number().int().min(0).max(999_999_999),
  notes: z.string().max(200).transform(s => s.trim()).optional().nullable(),
  valesSnapshot: z.array(valeSnapshotItemSchema).max(100).optional().nullable(),
}).refine(d => d.valesDeducted <= d.amount, {
  message: 'valesDeducted no puede superar amount.',
  path: ['valesDeducted'],
}).refine(d => {
  if (!d.valesSnapshot || d.valesSnapshot.length === 0) return true
  const sum = d.valesSnapshot.reduce((s, v) => s + v.amount, 0)
  return sum === d.valesDeducted
}, {
  message: 'valesSnapshot no coincide con valesDeducted.',
  path: ['valesSnapshot'],
})

const weekSchema = z.object({
  weekStart: dateSchema,
})

function addDaysYmd(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function parseSnapshot(raw: string | null): SalaryValeSnapshotItem[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed as SalaryValeSnapshotItem[]
  } catch {
    return null
  }
}

function toPaymentRow(row: typeof salaryPayments.$inferSelect): SalaryPaymentRow {
  return {
    id: row.id,
    employeeId: row.employeeId,
    shiftId: row.shiftId,
    amount: row.amount,
    weekStart: row.weekStart,
    valesDeducted: row.valesDeducted,
    netPaid: row.netPaid,
    recordedBy: row.recordedBy,
    paidAt: row.paidAt,
    notes: row.notes,
    valesSnapshot: parseSnapshot(row.valesSnapshot),
  }
}

export function registerSalaryHandlers(): void {
  ipcMain.handle(IPC.PAY_WEEKLY_SALARY, (_event, payload: unknown): IpcResult<SalaryPaymentRow> => {
    const parsed = paySchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:pay-weekly-salary] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) {
      return {
        ok: false,
        error: 'Se requiere un turno abierto para pagar el salario.',
        code: 'NO_SHIFT',
      }
    }

    const { employeeId, weekStart, amount, valesDeducted, notes, valesSnapshot } = parsed.data
    const netPaid = amount - valesDeducted
    const note = notes && notes.length > 0 ? notes : null
    const snapshotItems: SalaryValeSnapshotItem[] | null = valesSnapshot && valesSnapshot.length > 0
      ? valesSnapshot.map(v => ({
          id: v.id,
          amount: v.amount,
          description: v.description ?? null,
          paidAt: v.paidAt,
        }))
      : null

    try {
      const db = getDb()
      const employee = db.select().from(employees).where(eq(employees.id, employeeId)).all()[0]
      if (!employee) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
      if (!employee.active) {
        return { ok: false, error: 'El empleado está eliminado.', code: 'CONFLICT' }
      }

      const alreadyPaid = db.select({ id: salaryPayments.id }).from(salaryPayments)
        .where(and(
          eq(salaryPayments.employeeId, employeeId),
          eq(salaryPayments.weekStart, weekStart),
        ))
        .all()[0]
      if (alreadyPaid) {
        return {
          ok: false,
          error: 'Ya se registró el pago de salario para esa semana.',
          code: 'CONFLICT',
        }
      }

      if (weekStart !== weekStartMondayLocalYmd()) {
        return {
          ok: false,
          error: 'Solo se puede pagar la semana en curso (lunes a domingo). Las semanas anteriores son archivo.',
          code: 'CONFLICT',
        }
      }

      const now = new Date().toISOString()
      const paymentId = uuidv4()
      const expenseId = uuidv4()
      const concept = `Salario: ${employee.name}`.slice(0, 80)
      const baseNotes = valesDeducted > 0
        ? `Semana ${weekStart}. Bruto ${amount}, vales ${valesDeducted}, neto ${netPaid}.`
        : `Semana ${weekStart}. Neto ${netPaid}.`
      const expenseNotes = note ? `${baseNotes} ${note}`.slice(0, 500) : baseNotes

      db.transaction(tx => {
        tx.insert(salaryPayments).values({
          id: paymentId,
          employeeId,
          shiftId: session.shiftId,
          amount,
          weekStart,
          valesDeducted,
          netPaid,
          notes: note,
          valesSnapshot: snapshotItems ? JSON.stringify(snapshotItems) : null,
          recordedBy: session.userId,
          paidAt: now,
          syncedAt: null,
        }).run()

        // Solo sale efectivo si el neto es > 0.
        if (netPaid > 0) {
          tx.insert(expenses).values({
            id: expenseId,
            storeId: session.storeId,
            shiftId: session.shiftId!,
            concept,
            providerId: null,
            amount: netPaid,
            notes: expenseNotes,
            createdAt: now,
            createdBy: session.userId,
            syncedAt: null,
          }).run()
        }
      })

      const config = getBusinessConfig()
      if (netPaid > 0) {
        pushUnsyncedExpenses(config.tenant_id).catch(err =>
          log.warn('[ipc:pay-weekly-salary] pushUnsyncedExpenses falló (no bloqueante)', err),
        )
      }
      pushUnsyncedSalaryPayments(config.tenant_id).catch(err =>
        log.warn('[ipc:pay-weekly-salary] pushUnsyncedSalaryPayments falló (no bloqueante)', err),
      )

      log.info('[ipc:pay-weekly-salary] Salario pagado', {
        paymentId,
        employeeId,
        weekStart,
        amount,
        valesDeducted,
        netPaid,
      })

      return {
        ok: true,
        data: {
          id: paymentId,
          employeeId,
          shiftId: session.shiftId,
          amount,
          weekStart,
          valesDeducted,
          netPaid,
          recordedBy: session.userId,
          paidAt: now,
          notes: note,
          valesSnapshot: snapshotItems,
        },
      }
    } catch (err) {
      log.error('[ipc:pay-weekly-salary] Error inesperado', err)
      return { ok: false, error: 'Error al registrar el pago de salario.' }
    }
  })

  ipcMain.handle(IPC.LIST_SALARY_PAYMENTS, (_event, payload: unknown): IpcResult<SalaryPaymentRow[]> => {
    const parsed = weekSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:list-salary-payments] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const rows = db.select().from(salaryPayments)
        .where(eq(salaryPayments.weekStart, parsed.data.weekStart))
        .all()
      return { ok: true, data: rows.map(toPaymentRow) }
    } catch (err) {
      log.error('[ipc:list-salary-payments] Error inesperado', err)
      return { ok: false, error: 'Error al listar pagos de salario.' }
    }
  })

  ipcMain.handle(
    IPC.GET_REMOTE_SALARY_WEEK,
    async (_event, payload: unknown): Promise<IpcResult<RemoteSalaryWeek>> => {
      const parsed = weekSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:get-remote-salary-week] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
      }

      const session = getActiveSession()
      if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

      const { weekStart } = parsed.data
      const weekEnd = addDaysYmd(weekStart, 6)
      const bounds = firestorePaidAtBounds(weekStart, weekEnd)

      try {
        const [payments, vales] = await Promise.all([
          fetchSalaryPaymentsByWeekStart(weekStart),
          fetchValesInPaidAtRange(bounds.from, bounds.to),
        ])
        return { ok: true, data: { payments, vales } }
      } catch (err) {
        log.error('[ipc:get-remote-salary-week] Error inesperado', err)
        return { ok: false, error: 'Error al leer la liquidación remota.' }
      }
    },
  )
}
