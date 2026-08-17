import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, desc, gte, lte, inArray, lt } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { orders, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedOrders, markOrderDeletedInFirestore } from '../licensing/orderSync'
import type { IpcResult, OrderRow, DepositPayment } from '../../src/types/hw-api'

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
  /** Solo admin: sobreescribe el local de sesión para crear el pedido en ese local */
  storeId: z.string().uuid().optional(),
})

const updateOrderStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'ready', 'delivered', 'cancelled']),
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

function buildOrderRow(row: typeof orders.$inferSelect, creatorName: string, updaterName?: string | null): OrderRow {
  let parsedPayments: DepositPayment[] | null = null
  if (row.depositPayments) {
    try { parsedPayments = JSON.parse(row.depositPayments) as DepositPayment[] } catch { /* ignore */ }
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
        // Solo eliminar terminales (no activos)
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

    const { customerName, phone, items, pickupDate, timeSlot, pickupTime, priority, notes, depositAmount, depositPayments, storeId: overrideStoreId } = parsed.data

    // Cajeras solo pueden crear pedidos para su propio local.
    // El admin puede especificar un local diferente al de sesión.
    const effectiveStoreId = (session.role === 'admin' && overrideStoreId) ? overrideStoreId : session.storeId

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

    const { id, status } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const storeCondition = session.role === 'admin'
        ? eq(orders.id, id)
        : and(eq(orders.id, id), eq(orders.storeId, session.storeId))
      const existing = db.select().from(orders).where(storeCondition).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }

      db.update(orders).set({ status, updatedAt: now, updatedBy: session.userId, syncedAt: null }).where(eq(orders.id, id)).run()

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

      // Bloquear modificación de seña si no hay turno activo (solo cajeras)
      const newDepositAmount = 'depositPayments' in updates && updates.depositPayments
        ? updates.depositPayments.reduce((s, p) => s + p.amount, 0)
        : (updates.depositAmount ?? existing.depositAmount)
      const depositIsBeingAdded = newDepositAmount > 0 && ('depositPayments' in updates || updates.depositAmount !== undefined)
      if (depositIsBeingAdded && !session.shiftId && session.role !== 'admin') {
        return { ok: false, error: 'Se necesita un turno activo para modificar la seña.', code: 'NO_SHIFT' }
      }

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
      const existing = db.select({ id: orders.id }).from(orders).where(storeCondition).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }

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
      const existing = db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }

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
}
