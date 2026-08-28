import { ipcMain } from 'electron'
import { z } from 'zod'
import { eq, asc, inArray } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { customers, debtEvents, sales } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedCustomerDebtOps } from '../licensing/customerDebtSync'
import { nowUtc } from '../../src/lib/datetime'
import type { IpcResult } from '../../src/types/hw-api'

function scheduleCustomerDebtPush(): void {
  try {
    const { tenant_id } = getBusinessConfig()
    pushUnsyncedCustomerDebtOps(tenant_id).catch(err =>
      log.warn('[ipc:debts] pushUnsyncedCustomerDebtOps falló (no bloqueante)', err),
    )
  } catch (err) {
    log.warn('[ipc:debts] scheduleCustomerDebtPush omitido', err)
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createDebtSchema = z.object({
  saleId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  // Si no hay customerId, se crea el cliente inline
  newCustomer: z
    .object({
      name: z.string().min(1).max(100),
      dni: z.string().max(20).optional(),
      phone: z.string().max(30).optional(),
    })
    .optional(),
  /**
   * Monto que el cliente pagó en el momento del fiado.
   * La deuda registrada en el ledger será: total_venta - initialPayment.
   * 0 (o ausente) significa que no pagó nada ahora.
   */
  initialPayment: z.number().min(0).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(500).optional(),
})

const addPaymentSchema = z.object({
  customerId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'debit', 'wallet', 'credit']),
  notes: z.string().max(500).optional(),
  /** Admin: local destino, o 'all' para imputar en los locales con saldo. */
  storeId: z.union([z.string().uuid(), z.literal('all')]).optional(),
})

const cancelDebtSchema = z.object({
  customerId: z.string().uuid(),
  saleId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
  /** Admin: local a cancelar, o 'all' para saldar todos los locales. */
  storeId: z.union([z.string().uuid(), z.literal('all')]).optional(),
})

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type DebtEventRow = {
  id: string
  customerId: string
  customerName: string
  saleId: string | null
  storeId: string
  eventType: 'created' | 'partial_payment' | 'paid' | 'cancelled' | 'reopened'
  amount: number
  dueDate: string | null
  notes: string | null
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit' | null
  createdAt: string
  createdBy: string
}

export type CustomerDebtSummary = {
  customerId: string
  customerName: string
  customerDni: string | null
  customerPhone: string | null
  balance: number
  lastEventAt: string
  events: DebtEventRow[]
}

function remainingByStore(events: Array<{ storeId: string; amount: number }>): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of events) {
    map.set(e.storeId, Math.round(((map.get(e.storeId) ?? 0) + e.amount) * 100) / 100)
  }
  return map
}

function resolveLedgerTarget(
  session: { role: string; storeId: string },
  payloadStoreId: string | undefined,
): string | 'all' {
  if (session.role === 'admin') {
    if (!payloadStoreId || payloadStoreId === 'all') return 'all'
    return payloadStoreId
  }
  return session.storeId
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function registerDebtHandlers(): void {
  // CREATE_DEBT — marca una venta como deuda y opcionalmente crea el cliente
  ipcMain.handle(IPC.CREATE_DEBT, (_event, payload: unknown): IpcResult<DebtEventRow> => {
    const parsed = createDebtSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-debt] Payload inválido', parsed.error)
      return { ok: false, error: 'Datos de deuda inválidos.', code: 'VALIDATION_ERROR' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { saleId, customerId: existingCustomerId, newCustomer, dueDate, notes, initialPayment = 0 } = parsed.data

    try {
      const db = getDb()

      // Verificar que la venta existe y pertenece al turno activo
      const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
      if (!sale) return { ok: false, error: 'Venta no encontrada.', code: 'NOT_FOUND' }
      if (sale.shiftId !== session.shiftId) {
        return { ok: false, error: 'La venta no pertenece al turno activo.', code: 'FORBIDDEN' }
      }
      if (sale.status !== 'confirmed') {
        return { ok: false, error: 'Solo se puede registrar deuda sobre una venta confirmada.', code: 'INVALID_STATUS' }
      }
      // Una venta de fiado se crea con isDebt=true antes de llegar aquí. La
      // condición idempotente correcta es que ya exista su evento de ledger.
      const registeredDebt = db.select({ id: debtEvents.id })
        .from(debtEvents)
        .where(eq(debtEvents.saleId, saleId))
        .get()
      if (registeredDebt) {
        return { ok: false, error: 'Esta venta ya tiene una deuda registrada.', code: 'ALREADY_DEBT' }
      }

      let customerId = existingCustomerId

      const result = db.transaction(() => {
        // Crear cliente inline si no se proporcionó uno existente
        if (!customerId) {
          if (!newCustomer) {
            throw new Error('Se requiere un cliente existente o datos del nuevo cliente.')
          }
          const newId = uuidv4()
          db.insert(customers)
            .values({
              id: newId,
              storeId: session.storeId,
              name: newCustomer.name.trim(),
              dni: newCustomer.dni?.trim() ?? null,
              phone: newCustomer.phone?.trim() ?? null,
              active: true,
              createdAt: nowUtc(),
              createdBy: session.userId,
              syncedAt: null,
            })
            .run()
          customerId = newId
          log.info('[ipc:create-debt] Cliente creado inline', { id: newId, name: newCustomer.name })
        }

        // Verificar cliente existe
        const customer = db.select().from(customers).where(eq(customers.id, customerId!)).get()
        if (!customer) throw new Error('Cliente no encontrado.')

        // Marcar la venta como deuda
        db.update(sales)
          .set({ isDebt: true, customerId: customerId! })
          .where(eq(sales.id, saleId))
          .run()

        // Monto a deber = total venta menos lo que pagó ahora
        const debtAmount = Math.round((sale.total - initialPayment) * 100) / 100

        // Crear evento de deuda
        const eventId = uuidv4()
        const now = nowUtc()
        db.insert(debtEvents)
          .values({
            id: eventId,
            customerId: customerId!,
            saleId,
            storeId: session.storeId,
            eventType: 'created',
            amount: debtAmount,
            dueDate: dueDate ?? null,
            notes: notes?.trim() ?? null,
            shiftId: sale.shiftId,
            createdAt: now,
            createdBy: session.userId,
            syncedAt: null,
          })
          .run()

        return { eventId, customerId: customerId!, customerName: customer.name, now, debtAmount }
      })

      scheduleCustomerDebtPush()

      log.info('[ipc:create-debt] Deuda creada', { eventId: result.eventId, saleId, customerId: result.customerId })

      return {
        ok: true,
        data: {
          id: result.eventId,
          customerId: result.customerId,
          customerName: result.customerName,
          saleId,
          storeId: session.storeId,
          eventType: 'created',
          amount: result.debtAmount,
          dueDate: dueDate ?? null,
          notes: notes?.trim() ?? null,
          paymentMethod: null,
          createdAt: result.now,
          createdBy: session.userId,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:create-debt] Error inesperado', msg)
      return { ok: false, error: msg || 'Error al registrar la deuda.' }
    }
  })

  // GET_DEBTS — listado de deudas con saldo algebraico por cliente
  ipcMain.handle(IPC.GET_DEBTS, (_event, payload: unknown): IpcResult<CustomerDebtSummary[]> => {
    const parsed = z.object({ storeIdFilter: z.string().optional() }).optional().safeParse(payload ?? {})
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    // Determinar filtro de local
    const filter = parsed.success ? (parsed.data ?? {}) : {}
    const effectiveStoreId: string | null =
      session.role === 'admin' && filter.storeIdFilter === 'all'
        ? null
        : session.role === 'admin' && filter.storeIdFilter
          ? filter.storeIdFilter
          : session.storeId

    try {
      const db = getDb()

      // Traer eventos filtrados por storeId
      const events = db
        .select({
          id: debtEvents.id,
          customerId: debtEvents.customerId,
          saleId: debtEvents.saleId,
          storeId: debtEvents.storeId,
          eventType: debtEvents.eventType,
          amount: debtEvents.amount,
          dueDate: debtEvents.dueDate,
          notes: debtEvents.notes,
          paymentMethod: debtEvents.paymentMethod,
          createdAt: debtEvents.createdAt,
          createdBy: debtEvents.createdBy,
        })
        .from(debtEvents)
        .where(effectiveStoreId !== null ? eq(debtEvents.storeId, effectiveStoreId) : undefined)
        .orderBy(asc(debtEvents.createdAt))
        .all()

      if (events.length === 0) return { ok: true, data: [] }

      // Traer clientes únicos involucrados
      const customerIds = [...new Set(events.map(e => e.customerId))]
      const customerRows = db
        .select()
        .from(customers)
        .where(inArray(customers.id, customerIds))
        .all()

      const customerMap = new Map(customerRows.map(c => [c.id, c]))

      // Agrupar eventos por cliente y calcular saldo
      const summaries = new Map<string, CustomerDebtSummary>()

      for (const event of events) {
        const customer = customerMap.get(event.customerId)
        if (!customer) continue

        if (!summaries.has(event.customerId)) {
          summaries.set(event.customerId, {
            customerId: event.customerId,
            customerName: customer.name,
            customerDni: customer.dni ?? null,
            customerPhone: customer.phone ?? null,
            balance: 0,
            lastEventAt: event.createdAt,
            events: [],
          })
        }

        const summary = summaries.get(event.customerId)!
        summary.events.push({
          id: event.id,
          customerId: event.customerId,
          customerName: customer.name,
          saleId: event.saleId ?? null,
          storeId: event.storeId,
          eventType: event.eventType as DebtEventRow['eventType'],
          amount: event.amount,
          dueDate: event.dueDate ?? null,
          notes: event.notes ?? null,
          paymentMethod: (event.paymentMethod as DebtEventRow['paymentMethod']) ?? null,
          createdAt: event.createdAt,
          createdBy: event.createdBy,
        })
        summary.balance += event.amount
        if (event.createdAt > summary.lastEventAt) {
          summary.lastEventAt = event.createdAt
        }
      }

      // Solo devolver clientes con saldo > 0 (deudas activas)
      let result = [...summaries.values()].filter(s => s.balance > 0.01)

      // Vista por local: si el ledger global ya está en 0 (p. ej. cancelación
      // escrita en otro storeId), no mostrar el cliente en esta pestaña.
      if (effectiveStoreId !== null && result.length > 0) {
        const ids = result.map(s => s.customerId)
        const allForCustomers = db
          .select({ customerId: debtEvents.customerId, amount: debtEvents.amount })
          .from(debtEvents)
          .where(inArray(debtEvents.customerId, ids))
          .all()
        const global = new Map<string, number>()
        for (const e of allForCustomers) {
          global.set(e.customerId, (global.get(e.customerId) ?? 0) + e.amount)
        }
        result = result.filter(s => (global.get(s.customerId) ?? 0) > 0.01)
      }

      result.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))

      return { ok: true, data: result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-debts] Error inesperado', msg)
      return { ok: false, error: 'Error al obtener deudas.' }
    }
  })

  // GET_CUSTOMER_BALANCE — saldo de un cliente específico + historial de eventos
  ipcMain.handle(IPC.GET_CUSTOMER_BALANCE, (_event, payload: unknown): IpcResult<CustomerDebtSummary> => {
    const parsed = z.object({ customerId: z.string().uuid() }).safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'ID de cliente inválido.', code: 'VALIDATION_ERROR' }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const { customerId } = parsed.data

      const customer = db.select().from(customers).where(eq(customers.id, customerId)).get()
      if (!customer) return { ok: false, error: 'Cliente no encontrado.', code: 'NOT_FOUND' }

      const events = db
        .select()
        .from(debtEvents)
        .where(eq(debtEvents.customerId, customerId))
        .orderBy(asc(debtEvents.createdAt))
        .all()

      const balance = events.reduce((acc, e) => acc + e.amount, 0)
      const lastEventAt = events.length > 0 ? events[events.length - 1].createdAt : customer.createdAt

      return {
        ok: true,
        data: {
          customerId,
          customerName: customer.name,
          customerDni: customer.dni ?? null,
          customerPhone: customer.phone ?? null,
          balance,
          lastEventAt,
          events: events.map(e => ({
            id: e.id,
            customerId: e.customerId,
            customerName: customer.name,
            saleId: e.saleId ?? null,
            storeId: e.storeId,
            eventType: e.eventType as DebtEventRow['eventType'],
            amount: e.amount,
            dueDate: e.dueDate ?? null,
            notes: e.notes ?? null,
            paymentMethod: (e.paymentMethod as DebtEventRow['paymentMethod']) ?? null,
            createdAt: e.createdAt,
            createdBy: e.createdBy,
          })),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-customer-balance] Error inesperado', msg)
      return { ok: false, error: 'Error al obtener saldo del cliente.' }
    }
  })

  // ADD_DEBT_PAYMENT — pago parcial o total
  ipcMain.handle(IPC.ADD_DEBT_PAYMENT, (_event, payload: unknown): IpcResult<DebtEventRow> => {
    const parsed = addPaymentSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:add-debt-payment] Payload inválido', parsed.error)
      return { ok: false, error: 'Datos de pago inválidos.', code: 'VALIDATION_ERROR' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { customerId, amount, notes, paymentMethod, storeId: payloadStoreId } = parsed.data
    const target = resolveLedgerTarget(session, payloadStoreId)

    if (paymentMethod === 'cash' && !session.shiftId && session.role !== 'admin') {
      return {
        ok: false,
        error: 'Para registrar un cobro en efectivo necesitás un turno abierto.',
        code: 'NO_SHIFT',
      }
    }

    try {
      const db = getDb()

      const customer = db.select().from(customers).where(eq(customers.id, customerId)).get()
      if (!customer) return { ok: false, error: 'Cliente no encontrado.', code: 'NOT_FOUND' }

      const events = db
        .select({ amount: debtEvents.amount, storeId: debtEvents.storeId, createdAt: debtEvents.createdAt })
        .from(debtEvents)
        .where(eq(debtEvents.customerId, customerId))
        .all()
      const remaining = remainingByStore(events)
      const globalBalance = [...remaining.values()].reduce((a, b) => a + b, 0)

      if (globalBalance <= 0) {
        return { ok: false, error: 'Este cliente no tiene deuda activa.', code: 'NO_DEBT' }
      }

      const allocations: Array<{ storeId: string; amount: number }> = []
      if (target === 'all') {
        if (amount > globalBalance + 0.01) {
          return { ok: false, error: `El pago ($${amount}) supera la deuda actual ($${globalBalance}).`, code: 'OVERPAYMENT' }
        }
        const storeOrder = [...remaining.entries()]
          .filter(([, bal]) => bal > 0.01)
          .sort((a, b) => a[0].localeCompare(b[0]))
        let left = amount
        for (const [sid, bal] of storeOrder) {
          if (left < 0.01) break
          const take = Math.min(left, bal)
          allocations.push({ storeId: sid, amount: take })
          left = Math.round((left - take) * 100) / 100
        }
      } else {
        const storeBal = remaining.get(target) ?? 0
        if (storeBal <= 0.01) {
          return { ok: false, error: 'Este cliente no tiene deuda activa en este local.', code: 'NO_DEBT' }
        }
        if (amount > storeBal + 0.01) {
          return { ok: false, error: `El pago ($${amount}) supera la deuda de este local ($${storeBal}).`, code: 'OVERPAYMENT' }
        }
        allocations.push({ storeId: target, amount })
      }

      const now = nowUtc()
      const firstId = uuidv4()
      const remainingAfter = Math.round((globalBalance - amount) * 100) / 100
      const eventType = remainingAfter < 0.01 ? 'paid' : 'partial_payment'

      db.transaction(() => {
        allocations.forEach((alloc, i) => {
          db.insert(debtEvents)
            .values({
              id: i === 0 ? firstId : uuidv4(),
              customerId,
              saleId: null,
              storeId: alloc.storeId,
              eventType,
              amount: -alloc.amount,
              dueDate: null,
              notes: notes?.trim() ?? null,
              paymentMethod,
              shiftId: session.shiftId ?? null,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            })
            .run()
        })
      })

      scheduleCustomerDebtPush()

      log.info('[ipc:add-debt-payment] Pago registrado', { customerId, amount, eventType, paymentMethod, target })

      return {
        ok: true,
        data: {
          id: firstId,
          customerId,
          customerName: customer.name,
          saleId: null,
          storeId: allocations[0]!.storeId,
          eventType,
          amount: -amount,
          dueDate: null,
          notes: notes?.trim() ?? null,
          paymentMethod,
          createdAt: now,
          createdBy: session.userId,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:add-debt-payment] Error inesperado', msg)
      return { ok: false, error: 'Error al registrar el pago.' }
    }
  })

  // CANCEL_DEBT — cancela una deuda (anula el evento original)
  ipcMain.handle(IPC.CANCEL_DEBT, (_event, payload: unknown): IpcResult => {
    const parsed = cancelDebtSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { customerId, saleId, notes, storeId: payloadStoreId } = parsed.data
    const target = resolveLedgerTarget(session, payloadStoreId)

    try {
      const db = getDb()

      const customer = db.select().from(customers).where(eq(customers.id, customerId)).get()
      if (!customer) return { ok: false, error: 'Cliente no encontrado.', code: 'NOT_FOUND' }

      const allEvents = db
        .select({ amount: debtEvents.amount, storeId: debtEvents.storeId })
        .from(debtEvents)
        .where(eq(debtEvents.customerId, customerId))
        .all()
      const remaining = remainingByStore(allEvents)

      const targets: Array<{ storeId: string; amount: number }> =
        target === 'all'
          ? [...remaining.entries()].filter(([, bal]) => bal > 0.01).map(([sid, amount]) => ({ storeId: sid, amount }))
          : ((remaining.get(target) ?? 0) > 0.01 ? [{ storeId: target, amount: remaining.get(target)! }] : [])

      if (targets.length === 0) {
        return { ok: false, error: 'Este cliente no tiene deuda activa.', code: 'NO_DEBT' }
      }

      const now = nowUtc()
      db.transaction(() => {
        for (const t of targets) {
          db.insert(debtEvents)
            .values({
              id: uuidv4(),
              customerId,
              saleId: saleId ?? null,
              storeId: t.storeId,
              eventType: 'cancelled',
              amount: -t.amount,
              dueDate: null,
              notes: notes?.trim() ?? 'Deuda cancelada por administrador.',
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            })
            .run()
        }
      })

      scheduleCustomerDebtPush()

      log.info('[ipc:cancel-debt] Deuda cancelada', { customerId, target, stores: targets.length })
      return { ok: true, data: undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:cancel-debt] Error inesperado', msg)
      return { ok: false, error: 'Error al cancelar la deuda.' }
    }
  })
}
