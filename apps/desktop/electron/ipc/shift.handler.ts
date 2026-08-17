import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, isNull, desc, count, sum } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { shifts, sales, salePayments, expenses, billDenominations, debtEvents, orders, users } from '../db/schema'
import { getActiveSession, updateActiveShift } from '../activeSession'
import { startDaemon, stopDaemon, dismissWarning } from './inactivityDaemon'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedShifts, reconcileStoreShifts } from '../licensing/shiftSync'
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

const forceCloseOpenShiftSchema = z.object({
  shiftId: z.string().min(1),
})

/** Reconcilia turnos con Firestore. Nunca bloquea el flujo local si falla. */
async function syncShiftsSafe(filter: { storeId?: string; userId?: string }): Promise<void> {
  try {
    const config = getBusinessConfig()
    await reconcileStoreShifts(config.tenant_id, filter)
  } catch (err) {
    log.warn('[shift] reconcileStoreShifts falló (no bloqueante)', err)
  }
}

export function registerShiftHandlers(): void {
  ipcMain.handle(IPC.GET_ACTIVE_SHIFT, async (_event): Promise<IpcResult<ShiftInfo | null>> => {
    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }

    await syncShiftsSafe({ storeId: session.storeId, userId: session.userId })

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

  ipcMain.handle(IPC.OPEN_SHIFT, async (_event, payload: unknown): Promise<IpcResult<ShiftInfo>> => {
    const parsed = openShiftSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:open-shift] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }

    await syncShiftsSafe({ storeId: session.storeId })

    try {
      const db = getDb()

      // Verificar que no haya ningún turno abierto en este local.
      // La regla es un único turno activo por local (storeId), independientemente
      // de quién lo abrió. Si otra cajera o el admin ya tiene el turno del local
      // abierto, no se puede abrir uno nuevo hasta que ese cierre.
      const existing = db
        .select()
        .from(shifts)
        .where(and(
          eq(shifts.storeId, session.storeId),
          isNull(shifts.closedAt),
          eq(shifts.source, 'desktop')
        ))
        .orderBy(desc(shifts.startedAt))
        .limit(1)
        .all()[0]

      if (existing) {
        // Si el turno abierto pertenece al mismo usuario, retomarlo sin error.
        // Esto cubre el caso en que la PC se reinició o la sesión se cerró
        // sin cerrar el turno: la cajera puede retomar su turno directamente.
        if (existing.userId === session.userId) {
          updateActiveShift(existing.id)
          const thresholdHoursResume = _getInactivityThreshold()
          startDaemon(thresholdHoursResume)
          log.info('[ipc:open-shift] Turno propio retomado', { id: existing.id })
          return {
            ok: true,
            data: {
              id: existing.id,
              storeId: existing.storeId,
              userId: existing.userId,
              shiftType: existing.shiftType,
              startedAt: existing.startedAt,
              openingCash: existing.openingCash,
              resumed: true,
            },
          }
        }
        // Si pertenece a otra cajera, rechazar con el nombre de quien tiene el turno abierto.
        const ownerUser = db.select({ name: users.name }).from(users).where(eq(users.id, existing.userId)).get()
        const ownerName = ownerUser?.name ?? 'otra cajera'
        return {
          ok: false,
          error: `Ya hay un turno abierto en este local (${ownerName}). Pedile que cierre su turno antes de iniciar uno nuevo.`,
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

      // Push a Firestore (outbox: syncedAt=null). Fire-and-forget.
      const config = getBusinessConfig()
      pushUnsyncedShifts(config.tenant_id).catch(err =>
        log.warn('[ipc:open-shift] push de turno falló (no bloqueante)', err)
      )

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

      // Señas recibidas en este turno — desglosa por medio de pago parseando depositPayments JSON
      const depositOrders = db
        .select({ depositAmount: orders.depositAmount, depositMethod: orders.depositMethod, depositPayments: orders.depositPayments })
        .from(orders)
        .where(eq(orders.depositShiftId, session.shiftId))
        .all()

      let totalCashDeposits = 0
      let totalDebitDeposits = 0
      let totalWalletDeposits = 0
      let totalCreditDeposits = 0
      let depositsCount = 0
      for (const d of depositOrders) {
        if (d.depositAmount <= 0) continue
        depositsCount++
        if (d.depositPayments) {
          try {
            const payments = JSON.parse(d.depositPayments) as Array<{ method: string; amount: number }>
            for (const p of payments) {
              if (p.method === 'cash') totalCashDeposits += p.amount
              else if (p.method === 'debit') totalDebitDeposits += p.amount
              else if (p.method === 'wallet') totalWalletDeposits += p.amount
              else if (p.method === 'credit') totalCreditDeposits += p.amount
            }
          } catch { /* legado sin JSON → caer a depositMethod */ }
        } else if (d.depositMethod) {
          // Compatibilidad con pedidos anteriores a la migración multi-método
          if (d.depositMethod === 'cash') totalCashDeposits += d.depositAmount
          else if (d.depositMethod === 'debit') totalDebitDeposits += d.depositAmount
          else if (d.depositMethod === 'wallet') totalWalletDeposits += d.depositAmount
          else if (d.depositMethod === 'credit') totalCreditDeposits += d.depositAmount
        }
      }
      const totalDigitalDeposits = totalDebitDeposits + totalWalletDeposits + totalCreditDeposits

      // Cobranzas de fiado en efectivo de este turno (amount es negativo en el ledger)
      const cashDebtRows = db
        .select({ amount: debtEvents.amount })
        .from(debtEvents)
        .where(and(
          eq(debtEvents.shiftId, session.shiftId),
          eq(debtEvents.paymentMethod, 'cash'),
        ))
        .all()
      const totalCashDebtPayments = cashDebtRows.reduce((acc, r) => acc + Math.abs(Number(r.amount)), 0)

      const cashInHand = shift.openingCash + totalCashSales + totalCashDeposits + totalCashDebtPayments - totalExpenses

      // Fiados del turno: eventos 'created' cuya venta pertenece a este turno
      const [debtStats] = db
        .select({
          debtsCount: count(debtEvents.id),
          totalDebts: sum(debtEvents.amount),
        })
        .from(debtEvents)
        .innerJoin(sales, eq(debtEvents.saleId, sales.id))
        .where(and(
          eq(sales.shiftId, session.shiftId),
          eq(debtEvents.eventType, 'created'),
        ))
        .all()

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
          debtsCount: debtStats?.debtsCount ?? 0,
          totalDebts: Number(debtStats?.totalDebts ?? 0),
          totalCashDebtPayments,
          totalCashDeposits,
          totalDebitDeposits,
          totalWalletDeposits,
          totalCreditDeposits,
          totalDigitalDeposits,
          depositsCount,
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
            // Marcar para re-push: el turno pudo haberse sincronizado al abrir.
            syncedAt: null,
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

      // Push a Firestore con datos de cierre. Fire-and-forget.
      const config = getBusinessConfig()
      pushUnsyncedShifts(config.tenant_id).catch(err =>
        log.warn('[ipc:close-shift] push de turno falló (no bloqueante)', err)
      )

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

  // Retorna el turno abierto del local actual (cualquier usuario), o null si no hay ninguno.
  // Usado por el renderer para pre-verificar el estado del local antes de mostrar el formulario
  // de apertura de turno (evita el parpadeo de carga al hacer click en "Abrir turno").
  ipcMain.handle(IPC.GET_STORE_OPEN_SHIFT, async (_event): Promise<IpcResult<{ userId: string; shiftId: string; userName: string } | null>> => {
    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }

    await syncShiftsSafe({ storeId: session.storeId })

    try {
      const db = getDb()
      const shift = db
        .select({ id: shifts.id, userId: shifts.userId })
        .from(shifts)
        .where(and(
          eq(shifts.storeId, session.storeId),
          isNull(shifts.closedAt),
          eq(shifts.source, 'desktop')
        ))
        .orderBy(desc(shifts.startedAt))
        .limit(1)
        .all()[0]

      if (!shift) return { ok: true, data: null }

      const ownerUser = db.select({ name: users.name }).from(users).where(eq(users.id, shift.userId)).get()
      const userName = ownerUser?.name ?? shift.userId

      return { ok: true, data: { userId: shift.userId, shiftId: shift.id, userName } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-store-open-shift] Error inesperado', message)
      return { ok: false, error: 'Error al consultar el turno del local.' }
    }
  })

  // Retorna el turno abierto del usuario en sesión (cualquier local), o null si no hay ninguno.
  // Usado al post-login para detectar si la cajera tiene un turno sin cerrar y reanudarla
  // directamente, salteando el store picker y la pantalla de apertura de turno.
  ipcMain.handle(IPC.GET_USER_OPEN_SHIFT, async (_event): Promise<IpcResult<{ shiftId: string; storeId: string; shiftType: string; openingCash: number } | null>> => {
    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }

    await syncShiftsSafe({ userId: session.userId })

    try {
      const db = getDb()
      const shift = db
        .select()
        .from(shifts)
        .where(and(
          eq(shifts.userId, session.userId),
          isNull(shifts.closedAt),
          eq(shifts.source, 'desktop')
        ))
        .orderBy(desc(shifts.startedAt))
        .limit(1)
        .all()[0]

      if (!shift) return { ok: true, data: null }
      return {
        ok: true,
        data: {
          shiftId: shift.id,
          storeId: shift.storeId,
          shiftType: shift.shiftType,
          openingCash: shift.openingCash,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-user-open-shift] Error inesperado', message)
      return { ok: false, error: 'Error al consultar el turno del usuario.' }
    }
  })

  // Cierra un turno abierto ajeno (o propio) sin pasar por el arqueo.
  // Solo admin: desbloquea el local cuando el turno quedó colgado en esta u otra PC.
  ipcMain.handle(IPC.FORCE_CLOSE_OPEN_SHIFT, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = forceCloseOpenShiftSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:force-close-open-shift] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo un administrador puede cerrar un turno ajeno.', code: 'FORBIDDEN' }
    }

    try {
      const db = getDb()
      const { shiftId } = parsed.data
      const shift = db.select().from(shifts).where(eq(shifts.id, shiftId)).get()
      if (!shift) {
        return { ok: false, error: 'Turno no encontrado.', code: 'NOT_FOUND' }
      }
      if (shift.closedAt) {
        return { ok: true, data: undefined }
      }

      const now = new Date().toISOString()
      db.update(shifts)
        .set({
          closedAt: now,
          notes: shift.notes ?? 'Cerrado por administrador',
          syncedAt: null,
        })
        .where(eq(shifts.id, shiftId))
        .run()

      if (session.shiftId === shiftId) {
        updateActiveShift(null)
        stopDaemon()
      }

      const config = getBusinessConfig()
      await pushUnsyncedShifts(config.tenant_id)

      log.info('[ipc:force-close-open-shift] Turno cerrado por admin', {
        shiftId,
        previousUserId: shift.userId,
        by: session.userId,
      })
      return { ok: true, data: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:force-close-open-shift] Error inesperado', message)
      return { ok: false, error: 'Error al cerrar el turno.' }
    }
  })
}

function _getInactivityThreshold(): number {
  try {
    return getBusinessConfig().inactivityThresholdHours ?? 2
  } catch {
    return 2
  }
}
