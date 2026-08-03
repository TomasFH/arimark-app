/**
 * IPC de pago de salario semanal.
 *
 * Canal:
 *   PAY_WEEKLY_SALARY — turno activo; inserta salary_payments + gasto (cashInHand)
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
import { pushUnsyncedExpenses } from '../licensing/expenseSync'
import { pushUnsyncedSalaryPayments } from '../licensing/employeeSync'
import type { IpcResult, SalaryPaymentRow } from '../../src/types/hw-api'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const paySchema = z.object({
  employeeId: z.string().min(1),
  weekStart: dateSchema,
  /** Monto bruto de la liquidación (sueldo de la semana). */
  amount: z.number().int().positive().max(999_999_999),
  /** Vales a descontar de esa semana. */
  valesDeducted: z.number().int().min(0).max(999_999_999),
}).refine(d => d.valesDeducted <= d.amount, {
  message: 'valesDeducted no puede superar amount.',
  path: ['valesDeducted'],
})

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

    const { employeeId, weekStart, amount, valesDeducted } = parsed.data
    const netPaid = amount - valesDeducted

    try {
      const db = getDb()
      const employee = db.select().from(employees).where(eq(employees.id, employeeId)).all()[0]
      if (!employee) return { ok: false, error: 'Empleado no encontrado.', code: 'NOT_FOUND' }
      if (!employee.active) {
        return { ok: false, error: 'El empleado está archivado.', code: 'CONFLICT' }
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

      const now = new Date().toISOString()
      const paymentId = uuidv4()
      const expenseId = uuidv4()
      const concept = `Salario: ${employee.name}`.slice(0, 80)
      const notes = valesDeducted > 0
        ? `Semana ${weekStart}. Bruto ${amount}, vales ${valesDeducted}, neto ${netPaid}.`
        : `Semana ${weekStart}. Neto ${netPaid}.`

      db.transaction(tx => {
        tx.insert(salaryPayments).values({
          id: paymentId,
          employeeId,
          shiftId: session.shiftId,
          amount,
          weekStart,
          valesDeducted,
          netPaid,
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
            notes,
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
        },
      }
    } catch (err) {
      log.error('[ipc:pay-weekly-salary] Error inesperado', err)
      return { ok: false, error: 'Error al registrar el pago de salario.' }
    }
  })
}
