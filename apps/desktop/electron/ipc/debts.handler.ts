import { ipcMain } from 'electron'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { customers, debtEvents, sales, stores } from '../db/schema'
import { insertCustomerRecord, type CustomerRow } from './customers.handler'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { readCustomerAccountSlice } from '../licensing/customerCheckpointRead'
import { pushUnsyncedCustomerDebtOps } from '../licensing/customerDebtSync'
import { getLiveCustomerPairs } from '../licensing/debtBalanceLive'
import { isFirebaseAvailable } from '../licensing/firebase'
import {
  buildCustomerStoreLedgers,
  isOpenCustomerBalance,
  type CustomerLedgerEvent,
  type CustomerStoreLedger,
} from '../licensing/customerStoreBalance'
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

/**
 * Alta de cliente + saldo inicial. No acepta customerId: no suma deuda
 * a un cliente que ya existe. CREATE_DEBT (venta del turno) no se toca.
 */
const createCustomerWithInitialDebtSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dni: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(30).optional(),
  /** Pesos enteros. 0 u omitido: solo el cliente, sin evento de ledger. */
  initialDebt: z.number().int().nonnegative().optional(),
  /** Solo lo usa el admin. La cajera siempre queda en el local de la sesión. */
  storeId: z.string().trim().min(1).max(80).optional(),
}).strict()

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

export type CustomerOpeningDebtResult = {
  customer: CustomerRow
  debtEvent: DebtEventRow | null
}

export type CustomerDebtSummary = {
  customerId: string
  customerName: string
  customerDni: string | null
  customerPhone: string | null
  /** Local de esta cuenta. Una fila por cliente y local. */
  storeId: string
  storeName: string
  /**
   * Saldo del corte más la cola. >0 = debe; <0 = saldo a favor; 0 no se lista.
   */
  balance: number
  /** Saldo ya plegado en el corte. Cero si no hay corte. */
  openingBalance: number
  lastEventAt: string
  events: DebtEventRow[]
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

function paymentMethodOf(value: string | null): DebtEventRow['paymentMethod'] {
  if (value === 'cash' || value === 'debit' || value === 'wallet' || value === 'credit') return value
  return null
}

function toDebtEventRow(event: CustomerLedgerEvent, customerName: string): DebtEventRow {
  return {
    id: event.id,
    customerId: event.customerId,
    customerName,
    saleId: event.saleId,
    storeId: event.storeId,
    eventType: event.eventType as DebtEventRow['eventType'],
    amount: event.amount,
    dueDate: event.dueDate,
    notes: event.notes,
    paymentMethod: paymentMethodOf(event.paymentMethod),
    createdAt: event.createdAt,
    createdBy: event.createdBy,
  }
}

/**
 * Saldos por cliente y local. Con Firebase es el corte más la cola.
 * Sin Firebase, la suma del libro local.
 */
async function loadCustomerLedgers(storeId: string | null): Promise<CustomerStoreLedger[]> {
  const db = getDb()
  const rows = db
    .select({
      id: debtEvents.id,
      customerId: debtEvents.customerId,
      storeId: debtEvents.storeId,
      eventType: debtEvents.eventType,
      amount: debtEvents.amount,
      createdAt: debtEvents.createdAt,
      syncedAt: debtEvents.syncedAt,
      saleId: debtEvents.saleId,
      dueDate: debtEvents.dueDate,
      notes: debtEvents.notes,
      paymentMethod: debtEvents.paymentMethod,
      createdBy: debtEvents.createdBy,
    })
    .from(debtEvents)
    .where(storeId !== null ? eq(debtEvents.storeId, storeId) : undefined)
    .all()

  const localEvents: CustomerLedgerEvent[] = rows.map(row => ({
    id: row.id,
    customerId: row.customerId,
    storeId: row.storeId,
    eventType: row.eventType,
    amount: row.amount,
    createdAt: row.createdAt,
    syncedAt: row.syncedAt ?? null,
    saleId: row.saleId ?? null,
    dueDate: row.dueDate ?? null,
    notes: row.notes ?? null,
    paymentMethod: paymentMethodOf(row.paymentMethod ?? null),
    createdBy: row.createdBy,
  }))

  const firebaseOn = isFirebaseAvailable()
  const pairs = firebaseOn
    ? getLiveCustomerPairs().filter(pair =>
      pair.checkpoint.kind === 'customer' && (storeId === null || pair.storeId === storeId))
    : []
  const pairKeys = new Set(pairs.map(pair => `${pair.customerId}\0${pair.storeId}`))
  const remoteByKey = new Map<string, Awaited<ReturnType<typeof readCustomerAccountSlice>>>()
  if (firebaseOn) {
    const missing = new Set<string>()
    for (const event of localEvents) {
      const key = `${event.customerId}\0${event.storeId}`
      if (!pairKeys.has(key)) missing.add(key)
    }
    for (const key of missing) {
      const sep = key.indexOf('\0')
      const customerId = key.slice(0, sep)
      const sid = key.slice(sep + 1)
      try {
        remoteByKey.set(key, await readCustomerAccountSlice(customerId, sid))
      } catch (err) {
        log.error('[ipc:debts] No se pudo leer el saldo compartido', { customerId, storeId: sid, err })
      }
    }
  }

  return buildCustomerStoreLedgers({ firebaseOn, pairs, localEvents, remoteByKey })
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

  // CREATE_CUSTOMER_WITH_INITIAL_DEBT — alta de fiado con saldo, sin venta
  ipcMain.handle(
    IPC.CREATE_CUSTOMER_WITH_INITIAL_DEBT,
    (_event, payload: unknown): IpcResult<CustomerOpeningDebtResult> => {
      const parsed = createCustomerWithInitialDebtSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:create-customer-with-initial-debt] Payload inválido', parsed.error)
        return { ok: false, error: 'Datos del cliente inválidos.', code: 'VALIDATION_ERROR' }
      }
      const session = getActiveSession()
      if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

      const { name, dni, phone, initialDebt = 0 } = parsed.data

      try {
        const db = getDb()
        const targetStoreId = session.role === 'admin' && parsed.data.storeId
          ? parsed.data.storeId
          : session.storeId

        if (session.role === 'admin' && parsed.data.storeId) {
          const store = db.select({ id: stores.id }).from(stores).where(eq(stores.id, targetStoreId)).get()
          if (!store) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }
        }

        const result = db.transaction(() => {
          const customer = insertCustomerRecord(db, {
            storeId: targetStoreId,
            name,
            dni: dni || null,
            phone: phone || null,
            createdBy: session.userId,
          })

          if (initialDebt <= 0) {
            return { customer, debtEvent: null as DebtEventRow | null }
          }

          const eventId = uuidv4()
          const now = nowUtc()
          db.insert(debtEvents)
            .values({
              id: eventId,
              customerId: customer.id,
              saleId: null,
              storeId: targetStoreId,
              eventType: 'created',
              amount: initialDebt,
              dueDate: null,
              notes: null,
              paymentMethod: null,
              shiftId: null,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            })
            .run()

          const debtEvent: DebtEventRow = {
            id: eventId,
            customerId: customer.id,
            customerName: customer.name,
            saleId: null,
            storeId: targetStoreId,
            eventType: 'created',
            amount: initialDebt,
            dueDate: null,
            notes: null,
            paymentMethod: null,
            createdAt: now,
            createdBy: session.userId,
          }
          return { customer, debtEvent }
        })

        scheduleCustomerDebtPush()

        log.info('[ipc:create-customer-with-initial-debt] Cliente creado', {
          customerId: result.customer.id,
          storeId: targetStoreId,
          initialDebt,
        })

        return { ok: true, data: result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('[ipc:create-customer-with-initial-debt] Error inesperado', msg)
        return { ok: false, error: msg || 'Error al crear el cliente.' }
      }
    },
  )

  // GET_DEBTS — un renglón por cliente y local, con corte + cola
  ipcMain.handle(IPC.GET_DEBTS, async (_event, payload: unknown): Promise<IpcResult<CustomerDebtSummary[]>> => {
    const parsed = z.object({ storeIdFilter: z.string().optional() }).optional().safeParse(payload ?? {})
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const filter = parsed.success ? (parsed.data ?? {}) : {}
    const effectiveStoreId: string | null =
      session.role === 'admin' && filter.storeIdFilter === 'all'
        ? null
        : session.role === 'admin' && filter.storeIdFilter
          ? filter.storeIdFilter
          : session.storeId

    try {
      const db = getDb()
      const ledgers = await loadCustomerLedgers(effectiveStoreId)
      const open = ledgers.filter(ledger => isOpenCustomerBalance(ledger.balance))
      if (open.length === 0) return { ok: true, data: [] }

      const customerIds = [...new Set(open.map(ledger => ledger.customerId))]
      const customerRows = db.select().from(customers).where(inArray(customers.id, customerIds)).all()
      const customerMap = new Map(customerRows.map(customer => [customer.id, customer]))
      const storeRows = db.select({ id: stores.id, name: stores.name }).from(stores).all()
      const storeNames = new Map(storeRows.map(store => [store.id, store.name]))

      const result: CustomerDebtSummary[] = []
      for (const ledger of open) {
        const customer = customerMap.get(ledger.customerId)
        if (!customer) continue
        const lastEventAt = ledger.events.reduce(
          (latest, event) => (event.createdAt > latest ? event.createdAt : latest),
          ledger.events[0]?.createdAt ?? customer.createdAt,
        )
        result.push({
          customerId: ledger.customerId,
          customerName: customer.name,
          customerDni: customer.dni ?? null,
          customerPhone: customer.phone ?? null,
          storeId: ledger.storeId,
          storeName: storeNames.get(ledger.storeId) ?? ledger.storeId,
          balance: ledger.balance,
          openingBalance: ledger.openingBalance,
          lastEventAt,
          events: ledger.events.map(event => toDebtEventRow(event, customer.name)),
        })
      }

      result.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt) || a.storeName.localeCompare(b.storeName))
      return { ok: true, data: result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-debts] Error inesperado', msg)
      return { ok: false, error: 'Error al obtener deudas.' }
    }
  })

  // GET_CUSTOMER_BALANCE — saldo de un cliente en todos sus locales
  ipcMain.handle(IPC.GET_CUSTOMER_BALANCE, async (_event, payload: unknown): Promise<IpcResult<CustomerDebtSummary>> => {
    const parsed = z.object({ customerId: z.string().uuid() }).safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'ID de cliente inválido.', code: 'VALIDATION_ERROR' }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const { customerId } = parsed.data

      const customer = db.select().from(customers).where(eq(customers.id, customerId)).get()
      if (!customer) return { ok: false, error: 'Cliente no encontrado.', code: 'NOT_FOUND' }

      const ledgers = (await loadCustomerLedgers(null)).filter(ledger => ledger.customerId === customerId)
      const events = ledgers.flatMap(ledger => ledger.events).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const balance = Math.round(ledgers.reduce((sum, ledger) => sum + ledger.balance, 0) * 100) / 100
      const openingBalance = Math.round(ledgers.reduce((sum, ledger) => sum + ledger.openingBalance, 0) * 100) / 100
      const primary = ledgers.find(ledger => ledger.storeId === session.storeId) ?? ledgers[0]
      const storeRow = primary
        ? db.select({ name: stores.name }).from(stores).where(eq(stores.id, primary.storeId)).get()
        : undefined

      return {
        ok: true,
        data: {
          customerId,
          customerName: customer.name,
          customerDni: customer.dni ?? null,
          customerPhone: customer.phone ?? null,
          storeId: primary?.storeId ?? session.storeId,
          storeName: storeRow?.name ?? primary?.storeId ?? session.storeId,
          balance,
          openingBalance,
          lastEventAt: events.length > 0 ? events[events.length - 1]!.createdAt : customer.createdAt,
          events: events.map(event => toDebtEventRow(event, customer.name)),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-customer-balance] Error inesperado', msg)
      return { ok: false, error: 'Error al obtener saldo del cliente.' }
    }
  })

  // ADD_DEBT_PAYMENT — pago parcial o total
  ipcMain.handle(IPC.ADD_DEBT_PAYMENT, async (_event, payload: unknown): Promise<IpcResult<DebtEventRow>> => {
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

      const ledgers = (await loadCustomerLedgers(null)).filter(ledger => ledger.customerId === customerId)
      const remaining = new Map(ledgers.map(ledger => [ledger.storeId, ledger.balance]))
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

  // CANCEL_DEBT — cancela una deuda (anula el saldo vigente, no los eventos)
  ipcMain.handle(IPC.CANCEL_DEBT, async (_event, payload: unknown): Promise<IpcResult> => {
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

      const ledgers = (await loadCustomerLedgers(null)).filter(ledger => ledger.customerId === customerId)
      const remaining = new Map(ledgers.map(ledger => [ledger.storeId, ledger.balance]))

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
