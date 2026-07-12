import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, isNull, desc, count, sum } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { shifts, sales, salePayments, expenses, billDenominations } from '../db/schema'
import { getActiveSession, updateActiveShift } from '../activeSession'
import { startDaemon, stopDaemon, dismissWarning } from './inactivityDaemon'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, ShiftInfo, ShiftSummary } from '../../src/types/hw-api'

const openShiftSchema = z.object({
  shiftType: z.enum(['morning', 'evening']),
  openingCash: z.number().min(0),
})

const billDenominationSchema = z.object({
  denomination: z.number().positive(),
  quantity: z.number().int().min(0),
})

const closeShiftSchema = z.object({
  closingCash: z.number().min(0).optional(),
  safeAmount: z.number().min(0).optional(),
  deliveredAmount: z.number().min(0).optional(),
  deliveredTo: z.string().optional(),
  notes: z.string().optional(),
  billDenominations: z.array(billDenominationSchema).optional(),
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
        .where(and(
          eq(shifts.storeId, session.storeId),
          eq(shifts.userId, session.userId),
          isNull(shifts.closedAt),
          eq(shifts.source, 'desktop')
        ))
        .orderBy(desc(shifts.startedAt))
        .limit(1)
        .all()[0]

      if (!shift) {
        return { ok: true, data: null }
      }

      // Sincronizar la sesión en memoria con el turno que ya estaba abierto en DB.
      // Esto cubre el caso en que el usuario hace login cuando ya hay un turno abierto
      // (no pasó por OPEN_SHIFT) y el hook de tickets necesita saber el shiftId.
      updateActiveShift(shift.id)

      // Iniciar el daemon de inactividad para el turno reanudado.
      const thresholdHours = _getInactivityThreshold()
      startDaemon(thresholdHours)

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

      // Verificar que el mismo usuario no tenga ya un turno abierto.
      // Dos usuarios distintos pueden tener turnos abiertos simultáneamente
      // en el mismo local (caso de traspaso, admin en modo cajera, etc.).
      const existing = db
        .select()
        .from(shifts)
        .where(and(
          eq(shifts.storeId, session.storeId),
          eq(shifts.userId, session.userId),
          isNull(shifts.closedAt),
          eq(shifts.source, 'desktop')
        ))
        .limit(1)
        .all()[0]

      if (existing) {
        return {
          ok: false,
          error: 'Ya tenés un turno abierto. Cerralo antes de abrir uno nuevo.',
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
        source: 'desktop',
      }).run()

      updateActiveShift(id)
      log.info('[ipc:open-shift] Turno abierto', { id, shiftType, openingCash })

      // Iniciar daemon de inactividad para el turno recién abierto.
      const thresholdHours = _getInactivityThreshold()
      startDaemon(thresholdHours)

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

  ipcMain.handle(IPC.GET_SHIFT_SUMMARY, (_event): IpcResult<ShiftSummary> => {
    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }
    if (!session.shiftId) {
      return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }
    }

    try {
      const db = getDb()

      const shift = db
        .select()
        .from(shifts)
        .where(eq(shifts.id, session.shiftId))
        .limit(1)
        .all()[0]

      if (!shift) {
        return { ok: false, error: 'Turno no encontrado.', code: 'NOT_FOUND' }
      }

      // Ventas confirmadas del turno
      const [salesStats] = db
        .select({
          salesCount: count(sales.id),
          totalRevenue: sum(sales.total),
        })
        .from(sales)
        .where(and(
          eq(sales.shiftId, session.shiftId),
          eq(sales.status, 'confirmed')
        ))
        .all()

      // Total cobrado en efectivo: join sales → sale_payments donde paymentMethod = 'cash'
      const [cashStats] = db
        .select({ totalCash: sum(salePayments.amount) })
        .from(salePayments)
        .innerJoin(sales, eq(salePayments.saleId, sales.id))
        .where(and(
          eq(sales.shiftId, session.shiftId),
          eq(sales.status, 'confirmed'),
          eq(salePayments.paymentMethod, 'cash')
        ))
        .all()

      // Totales por tipo de pago digital (débito / billetera / crédito)
      const digitalStats = db
        .select({ method: salePayments.paymentMethod, total: sum(salePayments.amount) })
        .from(salePayments)
        .innerJoin(sales, eq(salePayments.saleId, sales.id))
        .where(and(
          eq(sales.shiftId, session.shiftId),
          eq(sales.status, 'confirmed'),
        ))
        .groupBy(salePayments.paymentMethod)
        .all()

      const digitalByMethod: Record<string, number> = {}
      for (const row of digitalStats) {
        digitalByMethod[row.method] = Number(row.total ?? 0)
      }

      // Total de gastos del turno
      const [expenseStats] = db
        .select({ totalExpenses: sum(expenses.amount) })
        .from(expenses)
        .where(eq(expenses.shiftId, session.shiftId))
        .all()

      const totalCashSales = Number(cashStats?.totalCash ?? 0)
      const totalDebitSales = digitalByMethod['debit'] ?? 0
      const totalWalletSales = digitalByMethod['wallet'] ?? 0
      const totalCreditSales = digitalByMethod['credit'] ?? 0
      const totalExpenses = Number(expenseStats?.totalExpenses ?? 0)
      const cashInHand = shift.openingCash + totalCashSales - totalExpenses

      return {
        ok: true,
        data: {
          shiftId: shift.id,
          shiftType: shift.shiftType,
          startedAt: shift.startedAt,
          openingCash: shift.openingCash,
          salesCount: salesStats?.salesCount ?? 0,
          totalRevenue: Number(salesStats?.totalRevenue ?? 0),
          totalCashSales,
          totalDebitSales,
          totalWalletSales,
          totalCreditSales,
          totalExpenses,
          cashInHand,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-shift-summary] Error inesperado', message)
      return { ok: false, error: 'Error al obtener el resumen del turno.' }
    }
  })

  ipcMain.handle(IPC.CLOSE_SHIFT, (_event, payload: unknown): IpcResult => {
    const parsed = closeShiftSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:close-shift] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }
    if (!session.shiftId) {
      return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }
    }

    try {
      const db = getDb()
      const now = new Date().toISOString()
      const { closingCash, safeAmount, deliveredAmount, deliveredTo, notes, billDenominations: denoms } = parsed.data

      db.transaction(tx => {
        tx.update(shifts)
          .set({
            closedAt: now,
            closingCash: closingCash ?? null,
            safeAmount: safeAmount ?? null,
            deliveredAmount: deliveredAmount ?? null,
            deliveredTo: deliveredTo ?? null,
            notes: notes ?? null,
          })
          .where(eq(shifts.id, session.shiftId!))
          .run()

        if (denoms && denoms.length > 0) {
          for (const d of denoms) {
            if (d.quantity <= 0) continue
            tx.insert(billDenominations)
              .values({
                id: uuidv4(),
                shiftId: session.shiftId!,
                denomination: d.denomination,
                quantity: d.quantity,
                subtotal: d.denomination * d.quantity,
              })
              .run()
          }
        }
      })

      const closedShiftId = session.shiftId
      updateActiveShift(null)
      stopDaemon()

      log.info('[ipc:close-shift] Turno cerrado', {
        shiftId: closedShiftId,
        closingCash,
        auto: closingCash === undefined,
      })

      return { ok: true, data: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:close-shift] Error inesperado', message)
      return { ok: false, error: 'Error al cerrar el turno.' }
    }
  })

  ipcMain.handle(IPC.DISMISS_INACTIVITY_WARNING, (): IpcResult => {
    dismissWarning()
    return { ok: true, data: undefined }
  })
}

function _getInactivityThreshold(): number {
  try {
    return getBusinessConfig().inactivityThresholdHours ?? 2
  } catch {
    return 2
  }
}
