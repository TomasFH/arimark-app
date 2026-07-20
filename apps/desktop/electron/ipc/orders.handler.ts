import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, desc, gte, lte, inArray } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { orders, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { IpcResult, OrderRow } from '../../src/types/hw-api'

const depositMethodEnum = z.enum(['cash', 'debit', 'wallet', 'credit'])

const createOrderSchema = z.object({
  customerName: z.string().min(1).max(100).transform(s => s.trim()),
  phone: z.string().max(30).optional(),
  items: z.string().min(1).max(500).transform(s => s.trim()),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe ser YYYY-MM-DD'),
  notes: z.string().max(300).optional(),
  depositAmount: z.number().min(0).default(0),
  depositMethod: depositMethodEnum.optional(),
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
  notes: z.string().max(300).optional().nullable(),
  depositAmount: z.number().min(0).optional(),
  depositMethod: depositMethodEnum.optional().nullable(),
})

const listOrdersSchema = z.object({
  status: z.enum(['pending', 'ready', 'delivered', 'cancelled']).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).optional()

const deleteOrderSchema = z.object({
  id: z.string().uuid(),
})

function buildOrderRow(row: typeof orders.$inferSelect, cashierName: string): OrderRow {
  return {
    id: row.id,
    storeId: row.storeId,
    customerName: row.customerName,
    phone: row.phone,
    items: row.items,
    pickupDate: row.pickupDate,
    status: row.status,
    notes: row.notes,
    depositAmount: row.depositAmount,
    depositMethod: row.depositMethod as OrderRow['depositMethod'],
    createdAt: row.createdAt,
    createdBy: cashierName,
    updatedAt: row.updatedAt,
  }
}

export function registerOrderHandlers(): void {
  // --------------------------------------------------------------------------
  // CREATE_ORDER
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.CREATE_ORDER, (_event, payload: unknown): IpcResult<OrderRow> => {
    const parsed = createOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { customerName, phone, items, pickupDate, notes, depositAmount, depositMethod } = parsed.data

    // Si hay seña, el turno activo es obligatorio para vincularla
    if (depositAmount > 0 && !session.shiftId) {
      return { ok: false, error: 'Se necesita un turno activo para registrar una seña.', code: 'NO_SHIFT' }
    }
    if (depositAmount > 0 && !depositMethod) {
      return { ok: false, error: 'Debe seleccionar el medio de pago de la seña.', code: 'INVALID_PAYLOAD' }
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      const db = getDb()
      db.insert(orders).values({
        id,
        storeId: session.storeId,
        customerName,
        phone: phone ?? null,
        items,
        pickupDate,
        status: 'pending',
        notes: notes ?? null,
        depositAmount: depositAmount ?? 0,
        depositMethod: (depositAmount ?? 0) > 0 ? (depositMethod ?? null) : null,
        depositShiftId: (depositAmount ?? 0) > 0 ? (session.shiftId ?? null) : null,
        createdAt: now,
        createdBy: session.userId,
      }).run()

      const userRow = db.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).all()[0]
      const created = db.select().from(orders).where(eq(orders.id, id)).all()[0]

      log.info('[ipc:create-order] Pedido creado', { id, customerName, depositAmount })
      return { ok: true, data: buildOrderRow(created, userRow?.name ?? session.userId) }
    } catch (err) {
      log.error('[ipc:create-order] Error inesperado', err)
      return { ok: false, error: 'Error al crear el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // LIST_ORDERS
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
      const conditions = [eq(orders.storeId, session.storeId)]
      if (filter.status) conditions.push(eq(orders.status, filter.status))
      if (filter.fromDate) conditions.push(gte(orders.pickupDate, filter.fromDate))
      if (filter.toDate) conditions.push(lte(orders.pickupDate, filter.toDate))

      const rows = db.select().from(orders).where(and(...conditions)).orderBy(orders.pickupDate, desc(orders.createdAt)).all()

      const userIds = [...new Set(rows.map(r => r.createdBy))]
      const allUsers = userIds.length > 0
        ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)).all()
        : []
      const userMap = new Map(allUsers.map(u => [u.id, u.name]))

      return {
        ok: true,
        data: rows.map(r => buildOrderRow(r, userMap.get(r.createdBy) ?? r.createdBy)),
      }
    } catch (err) {
      log.error('[ipc:list-orders] Error inesperado', err)
      return { ok: false, error: 'Error al listar los pedidos.' }
    }
  })

  // --------------------------------------------------------------------------
  // UPDATE_ORDER_STATUS
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
      const existing = db.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, session.storeId))).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }

      db.update(orders).set({ status, updatedAt: now, updatedBy: session.userId }).where(eq(orders.id, id)).run()

      const updated = db.select().from(orders).where(eq(orders.id, id)).all()[0]
      const userRow = db.select({ name: users.name }).from(users).where(eq(users.id, updated.createdBy)).all()[0]

      log.info('[ipc:update-order-status] Estado actualizado', { id, status })
      return { ok: true, data: buildOrderRow(updated, userRow?.name ?? updated.createdBy) }
    } catch (err) {
      log.error('[ipc:update-order-status] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // UPDATE_ORDER — solo admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATE_ORDER, (_event, payload: unknown): IpcResult<OrderRow> => {
    const parsed = updateOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden editar pedidos.', code: 'FORBIDDEN' }

    const { id, ...updates } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const existing = db.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, session.storeId))).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }

      const setData: Partial<typeof orders.$inferInsert> = { updatedAt: now, updatedBy: session.userId }
      if (updates.customerName !== undefined) setData.customerName = updates.customerName
      if (updates.phone !== undefined) setData.phone = updates.phone
      if (updates.items !== undefined) setData.items = updates.items
      if (updates.pickupDate !== undefined) setData.pickupDate = updates.pickupDate
      if ('notes' in updates) setData.notes = updates.notes ?? null
      if (updates.depositAmount !== undefined) setData.depositAmount = updates.depositAmount
      if ('depositMethod' in updates) setData.depositMethod = updates.depositMethod ?? null

      db.update(orders).set(setData).where(eq(orders.id, id)).run()

      const updated = db.select().from(orders).where(eq(orders.id, id)).all()[0]
      const userRow = db.select({ name: users.name }).from(users).where(eq(users.id, updated.createdBy)).all()[0]

      log.info('[ipc:update-order] Pedido editado', { id })
      return { ok: true, data: buildOrderRow(updated, userRow?.name ?? updated.createdBy) }
    } catch (err) {
      log.error('[ipc:update-order] Error inesperado', err)
      return { ok: false, error: 'Error al editar el pedido.' }
    }
  })

  // --------------------------------------------------------------------------
  // DELETE_ORDER — solo admin
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.DELETE_ORDER, (_event, payload: unknown): IpcResult => {
    const parsed = deleteOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:delete-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los administradores pueden eliminar pedidos.', code: 'FORBIDDEN' }

    const { id } = parsed.data

    try {
      const db = getDb()
      const existing = db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, id), eq(orders.storeId, session.storeId))).all()[0]
      if (!existing) return { ok: false, error: 'Pedido no encontrado.', code: 'NOT_FOUND' }

      // Soft delete: marcar como cancelado en vez de borrar físicamente
      db.update(orders).set({
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
        updatedBy: session.userId,
      }).where(eq(orders.id, id)).run()

      log.info('[ipc:delete-order] Pedido cancelado', { id })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:delete-order] Error inesperado', err)
      return { ok: false, error: 'Error al eliminar el pedido.' }
    }
  })
}
