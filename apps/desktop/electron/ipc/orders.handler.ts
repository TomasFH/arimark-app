import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, desc, gte, lte, inArray, lt } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { orders, stores, users } from '../db/schema'
import {
  checkPickupTimeOnDate,
  parseHoursSchedule,
  pickupSlotRegistrationError,
  pickupTimeRegistrationError,
  storeHoursSourceFromRecord,
} from '@carniceria/shared'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedOrders, markOrderDeletedInFirestore } from '../licensing/orderSync'
import { parseDepositPayments } from '../lib/depositPayments'
import type { IpcResult, OrderRow, DepositPayment, BudgetCartLine } from '../../src/types/hw-api'

function scheduleOrderPush(): void {
  try {
    const { tenant_id } = getBusinessConfig()
    pushUnsyncedOrders(tenant_id).catch(err =>
      log.warn('[ipc:orders] pushUnsyncedOrders falló (no bloqueante)', err),
    )
  } catch (err) {
    log.warn('[ipc:orders] scheduleOrderPush omitido', err)
  }
}

const depositPaymentSchema = z.object({
  method: z.enum(['cash', 'debit', 'wallet', 'credit']),
  amount: z.number().positive(),
})

const budgetCartLineSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1).max(100),
  unit: z.enum(['kg', 'unit']),
  pluNumber: z.number().int().positive().nullable().optional(),
  estimatedQty: z.number().min(0),
  unitPrice: z.number().min(0),
  requestedUnits: z.number().int().positive().nullable().optional(),
}).refine(
  line => line.estimatedQty > 0 || (line.requestedUnits != null && line.requestedUnits > 0),
  { message: 'Cada producto necesita kg, unidades, o ambos.' },
)

const createOrderSchema = z.object({
  customerName: z.string().min(1).max(100).transform(s => s.trim()),
  phone: z.string().max(30).optional(),
  items: z.string().min(1).max(500).transform(s => s.trim()),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe ser YYYY-MM-DD'),
  timeSlot: z.enum(['morning', 'afternoon', 'specific']).optional(),
  pickupTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  priority: z.boolean().default(false),
  notes: z.string().max(300).optional(),
  depositAmount: z.number().min(0).default(0),
  depositPayments: z.array(depositPaymentSchema).optional(),
  /** Solo admin: sobreescribe el local de sesión. No es UUID: los locales reales pueden ser `local1` u otros ids. */
  storeId: z.string().min(1).optional(),
  /** Carrito de presupuesto con productos y cantidades estimadas */
  budgetItems: z.array(budgetCartLineSchema).optional(),
}).superRefine((d, ctx) => {
  if (d.timeSlot === 'specific' && !d.pickupTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Horario específico sin hora.' })
  }
})

const updateOrderStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'ready', 'delivered', 'cancelled']),
  /** Nombre del que marca Listo (solo cuando status='ready' desde el celu carnicero) */
  readyByName: z.string().max(100).optional(),
})

const updateOrderSchema = z.object({
  id: z.string().uuid(),
  customerName: z.string().min(1).max(100).transform(s => s.trim()).optional(),
  phone: z.string().max(30).optional(),
  items: z.string().min(1).max(500).transform(s => s.trim()).optional(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timeSlot: z.enum(['morning', 'afternoon', 'specific']).optional().nullable(),
  pickupTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  priority: z.boolean().optional(),
  notes: z.string().max(300).optional().nullable(),
  depositAmount: z.number().min(0).optional(),
  depositPayments: z.array(depositPaymentSchema).optional().nullable(),
  budgetItems: z.array(budgetCartLineSchema).optional().nullable(),
}).superRefine((d, ctx) => {
  if (d.timeSlot === 'specific' && (d.pickupTime === null || d.pickupTime === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Horario específico sin hora.' })
  }
})

const listOrdersSchema = z.object({
  status: z.enum(['pending', 'ready', 'delivered', 'cancelled']).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Admin: 'all' = todos los locales; storeId específico = ese local */
  storeIdFilter: z.string().optional(),
}).optional()

const deleteOrderSchema = z.object({
  id: z.string().uuid(),
})

const chargeOrderSchema = z.object({
  orderId: z.string().uuid(),
  remaining: z.number().int().min(0).max(99_999_999),
  payments: z.array(z.object({
    paymentMethod: z.enum(['cash', 'debit', 'wallet', 'credit']),
    amount: z.number().positive(),
    installments: z.number().int().positive().optional(),
  })).default([]),
  notes: z.string().max(300).optional(),
}).refine(
  d => {
    if (d.remaining === 0) return d.payments.length === 0
    const paid = Math.round(d.payments.reduce((s, p) => s + p.amount, 0))
    return d.payments.length > 0 && Math.abs(paid - d.remaining) < 0.5
  },
  { message: 'Los pagos deben cubrir el resto a cobrar (la seña ya está descontada).' },
)

function buildOrderRow(row: typeof orders.$inferSelect, creatorName: string, updaterName?: string | null): OrderRow {
  const parsed = parseDepositPayments(row.depositPayments)
  const valid = parsed
    ? parsed.filter((p): p is DepositPayment =>
      p.method === 'cash' || p.method === 'debit' || p.method === 'wallet' || p.method === 'credit',
    )
    : []
  const parsedPayments: DepositPayment[] | null = valid.length > 0 ? valid : null

  let budgetItems: BudgetCartLine[] | null = null
  if (row.budgetItems) {
    try {
      const raw = JSON.parse(row.budgetItems) as unknown
      if (Array.isArray(raw)) budgetItems = raw as BudgetCartLine[]
    } catch {
      log.warn('[orders] budgetItems JSON inválido', row.id)
    }
  }

  return {
    id: row.id,
    storeId: row.storeId,
    customerName: row.customerName,
    phone: row.phone,
    items: row.items,
    pickupDate: row.pickupDate,
    timeSlot: row.timeSlot as OrderRow['timeSlot'],
    pickupTime: row.pickupTime,
    priority: row.priority,
    status: row.status,
    notes: row.notes,
    depositAmount: row.depositAmount,
    depositPayments: parsedPayments,
    depositMethod: row.depositMethod as OrderRow['depositMethod'],
    createdAt: row.createdAt,
    createdBy: creatorName,
    updatedAt: row.updatedAt,
    updatedBy: updaterName ?? null,
    readyAt: row.readyAt ?? null,
    readyBy: row.readyBy ?? null,
    readyByName: row.readyByName ?? null,
    budgetItems,
  }
}

function rejectPickupAgainstStoreHours(
  db: ReturnType<typeof import('../db/client').getDb>,
  storeId: string,
  timeSlot: string | null | undefined,
  pickupTime: string | null | undefined,
  pickupDate: string,
): { ok: false; error: string; code: string } | null {
  const store = db
    .select({
      morningStart: stores.morningStart,
      morningEnd: stores.morningEnd,
      afternoonStart: stores.afternoonStart,
      afternoonEnd: stores.afternoonEnd,
      hoursSchedule: stores.hoursSchedule,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .get()
  const source = storeHoursSourceFromRecord({
    morningStart: store?.morningStart,
    morningEnd: store?.morningEnd,
    afternoonStart: store?.afternoonStart,
    afternoonEnd: store?.afternoonEnd,
    hoursSchedule: parseHoursSchedule(store?.hoursSchedule),
  })
  const named = pickupSlotRegistrationError(timeSlot, source, pickupDate)
  if (named) {
    return { ok: false, error: named, code: 'STORE_CLOSED' }
  }
  if (timeSlot !== 'specific') return null
  if (!pickupTime) {
    return { ok: false, error: 'Ingresá el horario específico de retiro.', code: 'INVALID_PAYLOAD' }
  }
  const check = checkPickupTimeOnDate(pickupTime, source, pickupDate)
  const error = pickupTimeRegistrationError(check)
  if (!error) return null
  return {
    ok: false,
    error,
    code: check.status === 'no_hours' ? 'STORE_HOURS_MISSING' : 'STORE_CLOSED',
  }
}

function resolveUserNames(db: ReturnType<typeof import('../db/client').getDb>, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map()
  const rows = db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)).all()
  return new Map(rows.map(u => [u.id, u.name]))
}

/** Auto-elimina pedidos entregados/cancelados con más de 30 días */
function purgeOldOrders(db: ReturnType<typeof import('../db/client').getDb>, storeId: string): void {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  try {
    db.delete(orders)
      .where(and(
        eq(orders.storeId, storeId),
        lt(orders.pickupDate, cutoffStr),
        inArray(orders.status, ['delivered', 'cancelled']),
      ))
      .run()
  } catch (err) {
    log.warn('[orders] purgeOldOrders error', err)
  }
}

export function registerOrderHandlers(): void {
  // --------------------------------------------------------------------------
  // CREATE_ORDER — cajera y admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.CREATE_ORDER, (_event, payload: unknown): IpcResult<OrderRow> => {
    const parsed = createOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { customerName, phone, items, pickupDate, timeSlot, pickupTime, priority, notes, depositAmount, depositPayments, storeId: overrideStoreId, budgetItems } = parsed.data

    // Cajeras solo pueden crear pedidos para su propio local.
    // El admin puede especificar un local diferente al de sesión.
    const effectiveStoreId = (session.role === 'admin' && overrideStoreId) ? overrideStoreId : session.storeId
    if (!effectiveStoreId) return { ok: false, error: 'No hay local en la sesión.', code: 'NO_STORE' }

    // Seña sin turno: solo se bloquea para cajeras. El admin puede recibir transferencias fuera del horario de caja.
    if (depositAmount > 0 && !session.shiftId && session.role !== 'admin') {
      return { ok: false, error: 'Se necesita un turno activo para registrar una seña.', code: 'NO_SHIFT' }
    }
    if (depositAmount > 0 && (!depositPayments || depositPayments.length === 0)) {
      return { ok: false, error: 'Debe seleccionar el medio de pago de la seña.', code: 'INVALID_PAYLOAD' }
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const closed = rejectPickupAgainstStoreHours(db, effectiveStoreId, timeSlot, pickupTime, pickupDate)
      if (closed) return closed
      db.insert(orders).values({
        id,
        storeId: effectiveStoreId,
        customerName,
        phone: phone ?? null,
        items,
        pickupDate,
        timeSlot: timeSlot ?? null,
        pickupTime: pickupTime ?? null,
        priority: priority ?? false,
        status: 'pending',
        notes: notes ?? null,
        depositAmount: depositAmount ?? 0,
        depositMethod: null,
        depositPayments: depositPayments ? JSON.stringify(depositPayments) : null,
        depositShiftId: (depositAmount ?? 0) > 0 ? (session.shiftId ?? null) : null,
        budgetItems: budgetItems && budgetItems.length > 0 ? JSON.stringify(budgetItems) : null,
        createdAt: now,
        createdBy: session.userId,
        syncedAt: null,
      }).run()

      scheduleOrderPush()

      const userMap = resolveUserNames(db, [session.userId])
      const created = db.select().from(orders).where(eq(orders.id, id)).all()[0]

      log.info('[ipc:create-order] Pedido creado', { id, customerName, depositAmount })
      return { ok: true, data: buildOrderRow(created, userMap.get(session.userId) ?? session.userId) }
    } catch (err) {
      log.error('[ipc:create-order] Error inesperado', err)
      return { ok: false, error: 'Error al crear el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // LIST_ORDERS — cajera y admin (auto-purge de >30 días)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.LIST_ORDERS, (_event, payload: unknown): IpcResult<OrderRow[]> => {
    const parsed = listOrdersSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:list-orders] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const filter = parsed.data ?? {}

    try {
      const db = getDb()
      purgeOldOrders(db, session.storeId)

      // Calcular el storeId efectivo para el filtro de lista
      // Admin puede ver 'all' o un local específico; cajera siempre su local
      const effectiveStoreId: string | null =
        session.role === 'admin' && filter.storeIdFilter === 'all'
          ? null // sin filtro de local
          : session.role === 'admin' && filter.storeIdFilter
            ? filter.storeIdFilter
            : session.storeId

      const conditions = effectiveStoreId !== null
        ? [eq(orders.storeId, effectiveStoreId)]
        : []
      if (filter.status) conditions.push(eq(orders.status, filter.status))
      if (filter.fromDate) conditions.push(gte(orders.pickupDate, filter.fromDate))
      if (filter.toDate) conditions.push(lte(orders.pickupDate, filter.toDate))

      const rows = db.select().from(orders).where(
        conditions.length > 0 ? and(...conditions) : undefined
      ).orderBy(orders.pickupDate, desc(orders.createdAt)).all()

      const allUserIds = [...new Set([...rows.map(r => r.createdBy), ...rows.map(r => r.updatedBy).filter(Boolean) as string[]])]
      const userMap = resolveUserNames(db, allUserIds)

      return {
        ok: true,
        data: rows.map(r => buildOrderRow(
          r,
          userMap.get(r.createdBy) ?? r.createdBy,
          r.updatedBy ? (userMap.get(r.updatedBy) ?? r.updatedBy) : null,
        )),
      }
    } catch (err) {
      log.error('[ipc:list-orders] Error inesperado', err)
      return { ok: false, error: 'Error al listar los pedidos.' }
    }
  })

  // --------------------------------------------------------------------------
  // UPDATE_ORDER_STATUS — cajera y admin (registra quién actuó)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATE_ORDER_STATUS, (_event, payload: unknown): IpcResult<OrderRow> => {
    const parsed = updateOrderStatusSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-order-status] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { id, status, readyByName } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const storeCondition = session.role === 'admin'
        ? eq(orders.id, id)
        : and(eq(orders.id, id), eq(orders.storeId, session.storeId))
      const existing = db.select().from(orders).where(storeCondition).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }
      if (existing.status === 'delivered') {
        return { ok: false, error: 'Un pedido cobrado no se puede modificar.', code: 'INVALID_STATUS' }
      }

      const setData: Partial<typeof orders.$inferInsert> = {
        status,
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }

      if (status === 'ready') {
        // Auditar quién marcó listo y cuándo
        setData.readyAt = now
        setData.readyBy = session.userId
        // El nombre puede venir del payload (carnicero en celu) o se resuelve desde la sesión actual
        const resolvedName = readyByName?.trim()
          || resolveUserNames(db, [session.userId]).get(session.userId)
          || session.userId
        setData.readyByName = resolvedName
      } else if (status === 'pending') {
        // Revertir a pendiente limpia los campos de auditoría
        setData.readyAt = null
        setData.readyBy = null
        setData.readyByName = null
      }

      db.update(orders).set(setData).where(eq(orders.id, id)).run()

      scheduleOrderPush()

      const updated = db.select().from(orders).where(eq(orders.id, id)).all()[0]
      const userMap = resolveUserNames(db, [updated.createdBy, session.userId])

      log.info('[ipc:update-order-status] Estado actualizado', { id, status, by: session.userId })
      return { ok: true, data: buildOrderRow(updated, userMap.get(updated.createdBy) ?? updated.createdBy, userMap.get(session.userId)) }
    } catch (err) {
      log.error('[ipc:update-order-status] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // UPDATE_ORDER — cajera y admin (registra quién editó)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATE_ORDER, (_event, payload: unknown): IpcResult<OrderRow> => {
    const parsed = updateOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { id, ...updates } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const storeCondition = session.role === 'admin'
        ? eq(orders.id, id)
        : and(eq(orders.id, id), eq(orders.storeId, session.storeId))
      const existing = db.select().from(orders).where(storeCondition).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }
      if (existing.status === 'delivered') {
        return { ok: false, error: 'Un pedido cobrado no se puede editar.', code: 'INVALID_STATUS' }
      }
      const newDepositAmount = 'depositPayments' in updates && updates.depositPayments
        ? updates.depositPayments.reduce((s, p) => s + p.amount, 0)
        : (updates.depositAmount ?? existing.depositAmount)
      const depositIsBeingAdded = newDepositAmount > 0 && ('depositPayments' in updates || updates.depositAmount !== undefined)
      if (depositIsBeingAdded && !session.shiftId && session.role !== 'admin') {
        return { ok: false, error: 'Se necesita un turno activo para modificar la seña.', code: 'NO_SHIFT' }
      }

      const nextSlot = 'timeSlot' in updates ? updates.timeSlot : existing.timeSlot
      const nextTime = 'pickupTime' in updates ? updates.pickupTime : existing.pickupTime
      const nextDate = updates.pickupDate ?? existing.pickupDate
      const closed = rejectPickupAgainstStoreHours(db, existing.storeId, nextSlot, nextTime, nextDate)
      if (closed) return closed

      const setData: Partial<typeof orders.$inferInsert> = { updatedAt: now, updatedBy: session.userId, syncedAt: null }
      if (updates.customerName !== undefined) setData.customerName = updates.customerName
      if (updates.phone !== undefined) setData.phone = updates.phone
      if (updates.items !== undefined) setData.items = updates.items
      if (updates.pickupDate !== undefined) setData.pickupDate = updates.pickupDate
      if ('timeSlot' in updates) setData.timeSlot = updates.timeSlot ?? null
      if ('pickupTime' in updates) setData.pickupTime = updates.pickupTime ?? null
      if (updates.priority !== undefined) setData.priority = updates.priority
      if ('notes' in updates) setData.notes = updates.notes ?? null
      if (updates.depositAmount !== undefined) setData.depositAmount = updates.depositAmount
      if ('depositPayments' in updates) {
        const dp = updates.depositPayments
        setData.depositPayments = dp ? JSON.stringify(dp) : null
        setData.depositAmount = dp ? dp.reduce((s, p) => s + p.amount, 0) : (updates.depositAmount ?? existing.depositAmount)
      }
      if ('budgetItems' in updates) {
        const bi = updates.budgetItems
        setData.budgetItems = bi && bi.length > 0 ? JSON.stringify(bi) : null
      }

      db.update(orders).set(setData).where(eq(orders.id, id)).run()

      scheduleOrderPush()

      const updated = db.select().from(orders).where(eq(orders.id, id)).all()[0]
      const userMap = resolveUserNames(db, [updated.createdBy, session.userId])

      log.info('[ipc:update-order] Pedido editado', { id, by: session.userId })
      return { ok: true, data: buildOrderRow(updated, userMap.get(updated.createdBy) ?? updated.createdBy, userMap.get(session.userId)) }
    } catch (err) {
      log.error('[ipc:update-order] Error inesperado', err)
      return { ok: false, error: 'Error al editar el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // DELETE_ORDER — cajera y admin (soft delete = cancelar)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.DELETE_ORDER, (_event, payload: unknown): IpcResult => {
    const parsed = deleteOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:delete-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { id } = parsed.data

    try {
      const db = getDb()
      const storeCondition = session.role === 'admin'
        ? eq(orders.id, id)
        : and(eq(orders.id, id), eq(orders.storeId, session.storeId))
      const existing = db.select({ id: orders.id, status: orders.status }).from(orders).where(storeCondition).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }
      if (existing.status === 'delivered') {
        return { ok: false, error: 'Un pedido cobrado no se puede cancelar.', code: 'INVALID_STATUS' }
      }

      db.update(orders).set({
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(orders.id, id)).run()

      scheduleOrderPush()

      log.info('[ipc:delete-order] Pedido cancelado', { id, by: session.userId })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:delete-order] Error inesperado', err)
      return { ok: false, error: 'Error al cancelar el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // HARD_DELETE_ORDER — solo admin (eliminación física permanente)
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.HARD_DELETE_ORDER, (_event, payload: unknown): IpcResult => {
    const parsed = deleteOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:hard-delete-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden eliminar pedidos permanentemente.', code: 'FORBIDDEN' }

    const { id } = parsed.data

    try {
      const db = getDb()
      const existing = db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }
      if (existing.status !== 'cancelled') {
        return { ok: false, error: 'Solo se pueden eliminar pedidos cancelados.', code: 'INVALID_STATUS' }
      }

      db.delete(orders).where(eq(orders.id, id)).run()

      try {
        const { tenant_id } = getBusinessConfig()
        markOrderDeletedInFirestore(tenant_id, id).catch(err =>
          log.warn('[ipc:hard-delete-order] markOrderDeletedInFirestore falló', err),
        )
      } catch (err) {
        log.warn('[ipc:hard-delete-order] markOrderDeletedInFirestore omitido', err)
      }

      log.info('[ipc:hard-delete-order] Pedido eliminado permanentemente', { id, by: session.userId })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:hard-delete-order] Error inesperado', err)
      return { ok: false, error: 'Error al eliminar el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // CHARGE_ORDER — solo para marcar entregado cuando la seña cubre el total (remaining=0).
  // Cuando hay resto a cobrar, el flujo es: modal de carrito en Pedidos → inyección en POS → createSale con orderId.
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.CHARGE_ORDER, (_event, payload: unknown): IpcResult<OrderRow> => {
    const parsed = chargeOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:charge-order] Payload inválido', parsed.error)
      return { ok: false, error: parsed.error.errors[0]?.message ?? 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { orderId, remaining } = parsed.data
    if (remaining > 0) {
      return { ok: false, error: 'Para cobrar el resto, usá el flujo del POS.', code: 'INVALID_PAYLOAD' }
    }

    try {
      const db = getDb()
      const storeCondition = session.role === 'admin'
        ? eq(orders.id, orderId)
        : and(eq(orders.id, orderId), eq(orders.storeId, session.storeId))
      const existing = db.select().from(orders).where(storeCondition).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }
      if (existing.status === 'delivered' || existing.status === 'cancelled') {
        return { ok: false, error: 'Este pedido ya no se puede cobrar.', code: 'INVALID_STATUS' }
      }

      const now = new Date().toISOString()

      db.update(orders).set({
        status: 'delivered',
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(orders.id, orderId)).run()

      scheduleOrderPush()

      const updated = db.select().from(orders).where(eq(orders.id, orderId)).all()[0]
      const userMap = resolveUserNames(db, [updated.createdBy, session.userId])
      log.info('[ipc:charge-order] Pedido marcado entregado (sin venta)', { orderId, by: session.userId })
      return { ok: true, data: buildOrderRow(updated, userMap.get(updated.createdBy) ?? updated.createdBy, userMap.get(session.userId)) }
    } catch (err) {
      log.error('[ipc:charge-order] Error inesperado', err)
      return { ok: false, error: 'Error al cobrar el pedido.' }
    }
  })
}
