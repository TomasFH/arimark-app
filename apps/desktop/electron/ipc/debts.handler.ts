import { ipcMain } from 'electron'
import { z } from 'zod'
import { eq, and, asc, inArray, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { customers, debtEvents, sales, customerPrices, products } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { nowUtc } from '../../src/lib/datetime'
import type { IpcResult } from '../../src/types/hw-api'

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
  notes: z.string().max(500).optional(),
})

const cancelDebtSchema = z.object({
  customerId: z.string().uuid(),
  saleId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
})

const getCustomerPricesSchema = z.object({
  customerId: z.string().uuid(),
})

const setCustomerPriceSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  price: z.number().positive(),
})

const deleteCustomerPriceSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
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

export type CustomerPriceRow = {
  id: string
  customerId: string
  productId: string
  productName: string
  price: number
  validFrom: string
  validTo: string | null
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
            createdAt: now,
            createdBy: session.userId,
          })
          .run()

        return { eventId, customerId: customerId!, customerName: customer.name, now, debtAmount }
      })

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
  ipcMain.handle(IPC.GET_DEBTS, (_event): IpcResult<CustomerDebtSummary[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()

      // Traer todos los eventos de deuda
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
          createdAt: debtEvents.createdAt,
          createdBy: debtEvents.createdBy,
        })
        .from(debtEvents)
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
          createdAt: event.createdAt,
          createdBy: event.createdBy,
        })
        summary.balance += event.amount
        if (event.createdAt > summary.lastEventAt) {
          summary.lastEventAt = event.createdAt
        }
      }

      // Solo devolver clientes con saldo > 0 (deudas activas)
      const result = [...summaries.values()].filter(s => s.balance > 0)
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

    const { customerId, amount, notes } = parsed.data

    try {
      const db = getDb()

      const customer = db.select().from(customers).where(eq(customers.id, customerId)).get()
      if (!customer) return { ok: false, error: 'Cliente no encontrado.', code: 'NOT_FOUND' }

      // Verificar que el cliente tiene deuda activa
      const events = db.select({ amount: debtEvents.amount }).from(debtEvents)
        .where(eq(debtEvents.customerId, customerId)).all()
      const currentBalance = events.reduce((acc, e) => acc + e.amount, 0)
      if (currentBalance <= 0) {
        return { ok: false, error: 'Este cliente no tiene deuda activa.', code: 'NO_DEBT' }
      }
      if (amount > currentBalance + 0.01) {
        return { ok: false, error: `El pago ($${amount}) supera la deuda actual ($${currentBalance}).`, code: 'OVERPAYMENT' }
      }

      const isFullPayment = Math.abs(amount - currentBalance) < 0.01
      const eventType = isFullPayment ? 'paid' : 'partial_payment'

      const eventId = uuidv4()
      const now = nowUtc()

      db.insert(debtEvents)
        .values({
          id: eventId,
          customerId,
          saleId: null,
          storeId: session.storeId,
          eventType,
          amount: -amount, // negativo = reduce la deuda
          dueDate: null,
          notes: notes?.trim() ?? null,
          createdAt: now,
          createdBy: session.userId,
        })
        .run()

      log.info('[ipc:add-debt-payment] Pago registrado', { customerId, amount, eventType })

      return {
        ok: true,
        data: {
          id: eventId,
          customerId,
          customerName: customer.name,
          saleId: null,
          storeId: session.storeId,
          eventType,
          amount: -amount,
          dueDate: null,
          notes: notes?.trim() ?? null,
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

    const { customerId, saleId, notes } = parsed.data

    try {
      const db = getDb()

      const customer = db.select().from(customers).where(eq(customers.id, customerId)).get()
      if (!customer) return { ok: false, error: 'Cliente no encontrado.', code: 'NOT_FOUND' }

      const allEvents = db.select({ amount: debtEvents.amount }).from(debtEvents)
        .where(eq(debtEvents.customerId, customerId)).all()
      const currentBalance = allEvents.reduce((acc, e) => acc + e.amount, 0)
      if (currentBalance <= 0) {
        return { ok: false, error: 'Este cliente no tiene deuda activa.', code: 'NO_DEBT' }
      }

      db.insert(debtEvents)
        .values({
          id: uuidv4(),
          customerId,
          saleId: saleId ?? null,
          storeId: session.storeId,
          eventType: 'cancelled',
          amount: -currentBalance, // cancela el saldo total
          dueDate: null,
          notes: notes?.trim() ?? 'Deuda cancelada por administrador.',
          createdAt: nowUtc(),
          createdBy: session.userId,
        })
        .run()

      log.info('[ipc:cancel-debt] Deuda cancelada', { customerId, balance: currentBalance })
      return { ok: true, data: undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:cancel-debt] Error inesperado', msg)
      return { ok: false, error: 'Error al cancelar la deuda.' }
    }
  })

  // GET_CUSTOMER_PRICES — precios especiales de un cliente (solo admins)
  ipcMain.handle(IPC.GET_CUSTOMER_PRICES, (_event, payload: unknown): IpcResult<CustomerPriceRow[]> => {
    const parsed = getCustomerPricesSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'ID de cliente inválido.', code: 'VALIDATION_ERROR' }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const { customerId } = parsed.data

      const rows = db
        .select({
          id: customerPrices.id,
          customerId: customerPrices.customerId,
          productId: customerPrices.productId,
          productName: products.name,
          price: customerPrices.price,
          validFrom: customerPrices.validFrom,
          validTo: customerPrices.validTo,
        })
        .from(customerPrices)
        .innerJoin(products, eq(products.id, customerPrices.productId))
        .where(and(
          eq(customerPrices.customerId, customerId),
          eq(customerPrices.storeId, session.storeId),
          isNull(customerPrices.validTo),
        ))
        .orderBy(asc(products.name))
        .all()

      return { ok: true, data: rows.map(r => ({ ...r, validTo: r.validTo ?? null })) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-customer-prices] Error inesperado', msg)
      return { ok: false, error: 'Error al obtener precios especiales.' }
    }
  })

  // SET_CUSTOMER_PRICE — crea o reemplaza un precio especial (upsert por fecha vigente)
  ipcMain.handle(IPC.SET_CUSTOMER_PRICE, (_event, payload: unknown): IpcResult<CustomerPriceRow> => {
    const parsed = setCustomerPriceSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { customerId, productId, price } = parsed.data

    try {
      const db = getDb()

      // Cerrar precio anterior si existe
      const now = nowUtc()
      db.update(customerPrices)
        .set({ validTo: now })
        .where(
          and(
            eq(customerPrices.customerId, customerId),
            eq(customerPrices.productId, productId),
            eq(customerPrices.storeId, session.storeId),
            isNull(customerPrices.validTo),
          )
        )
        .run()

      const id = uuidv4()
      db.insert(customerPrices)
        .values({
          id,
          customerId,
          productId,
          storeId: session.storeId,
          price,
          validFrom: now,
          createdBy: session.userId,
        })
        .run()

      const product = db.select({ name: products.name }).from(products).where(eq(products.id, productId)).get()

      log.info('[ipc:set-customer-price] Precio especial establecido', { customerId, productId, price })
      return {
        ok: true,
        data: {
          id,
          customerId,
          productId,
          productName: product?.name ?? '',
          price,
          validFrom: now,
          validTo: null,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:set-customer-price] Error inesperado', msg)
      return { ok: false, error: 'Error al establecer el precio.' }
    }
  })

  // DELETE_CUSTOMER_PRICE — cierra el precio especial vigente (no borra historial)
  ipcMain.handle(IPC.DELETE_CUSTOMER_PRICE, (_event, payload: unknown): IpcResult => {
    const parsed = deleteCustomerPriceSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { customerId, productId } = parsed.data

    try {
      const db = getDb()
      db.update(customerPrices)
        .set({ validTo: nowUtc() })
        .where(
          and(
            eq(customerPrices.customerId, customerId),
            eq(customerPrices.productId, productId),
            eq(customerPrices.storeId, session.storeId),
            isNull(customerPrices.validTo),
          )
        )
        .run()

      log.info('[ipc:delete-customer-price] Precio especial removido', { customerId, productId })
      return { ok: true, data: undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:delete-customer-price] Error inesperado', msg)
      return { ok: false, error: 'Error al eliminar el precio.' }
    }
  })
}
