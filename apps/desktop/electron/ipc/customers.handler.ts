import { ipcMain } from 'electron'
import { z } from 'zod'
import { eq, asc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { customers } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { nowUtc } from '../../src/lib/datetime'
import type { IpcResult } from '../../src/types/hw-api'

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const createCustomerSchema = z.object({
  name: z.string().min(1).max(100),
  dni: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  type: z.enum(['restaurant', 'wholesale', 'other']).optional(),
  notes: z.string().max(500).optional(),
})

const updateCustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  dni: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  type: z.enum(['restaurant', 'wholesale', 'other']).optional(),
  notes: z.string().max(500).optional(),
  active: z.boolean().optional(),
})

const getCustomersSchema = z.object({
  search: z.string().optional(),
  activeOnly: z.boolean().default(true),
})

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type CustomerRow = {
  id: string
  storeId: string
  name: string
  dni: string | null
  phone: string | null
  type: 'restaurant' | 'wholesale' | 'other' | null
  notes: string | null
  active: boolean
  createdAt: string
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function registerCustomerHandlers(): void {
  // CREATE_CUSTOMER
  ipcMain.handle(IPC.CREATE_CUSTOMER, (_event, payload: unknown): IpcResult<CustomerRow> => {
    const parsed = createCustomerSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-customer] Payload inválido', parsed.error)
      return { ok: false, error: 'Datos del cliente inválidos.', code: 'VALIDATION_ERROR' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const id = uuidv4()
      const now = nowUtc()
      const { name, dni, phone, type, notes } = parsed.data

      db.insert(customers)
        .values({
          id,
          storeId: session.storeId,
          name: name.trim(),
          dni: dni?.trim() ?? null,
          phone: phone?.trim() ?? null,
          type: type ?? null,
          notes: notes?.trim() ?? null,
          active: true,
          createdAt: now,
          createdBy: session.userId,
        })
        .run()

      const row = db.select().from(customers).where(eq(customers.id, id)).get()
      if (!row) return { ok: false, error: 'Error al recuperar cliente creado.' }

      log.info('[ipc:create-customer] Cliente creado', { id, name })
      return { ok: true, data: toCustomerRow(row) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:create-customer] Error inesperado', msg)
      return { ok: false, error: 'Error al crear el cliente.' }
    }
  })

  // GET_CUSTOMERS — todos los clientes visibles desde cualquier local de la licencia
  ipcMain.handle(IPC.GET_CUSTOMERS, (_event, payload: unknown): IpcResult<CustomerRow[]> => {
    const parsed = getCustomersSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      return { ok: false, error: 'Parámetros inválidos.', code: 'VALIDATION_ERROR' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const { search, activeOnly } = parsed.data

      let query = db.select().from(customers).$dynamic()

      if (activeOnly) {
        query = query.where(eq(customers.active, true))
      }

      const rows = query.orderBy(asc(customers.name)).all()

      const filtered = search
        ? (() => {
            const normalize = (s: string) =>
              s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            const q = normalize(search)
            return rows.filter(r =>
              normalize(r.name).includes(q) ||
              (r.dni ? normalize(r.dni).includes(q) : false) ||
              (r.phone ? normalize(r.phone).includes(q) : false)
            )
          })()
        : rows

      return { ok: true, data: filtered.map(toCustomerRow) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-customers] Error inesperado', msg)
      return { ok: false, error: 'Error al obtener clientes.' }
    }
  })

  // UPDATE_CUSTOMER
  ipcMain.handle(IPC.UPDATE_CUSTOMER, (_event, payload: unknown): IpcResult<CustomerRow> => {
    const parsed = updateCustomerSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-customer] Payload inválido', parsed.error)
      return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const { id, ...fields } = parsed.data

      const existing = db.select().from(customers).where(eq(customers.id, id)).get()
      if (!existing) return { ok: false, error: 'Cliente no encontrado.', code: 'NOT_FOUND' }

      const updates: Partial<typeof existing> = {}
      if (fields.name !== undefined) updates.name = fields.name.trim()
      if (fields.dni !== undefined) updates.dni = fields.dni.trim() || null
      if (fields.phone !== undefined) updates.phone = fields.phone.trim() || null
      if (fields.type !== undefined) updates.type = fields.type
      if (fields.notes !== undefined) updates.notes = fields.notes.trim() || null
      if (fields.active !== undefined) updates.active = fields.active

      db.update(customers).set(updates).where(eq(customers.id, id)).run()

      const updated = db.select().from(customers).where(eq(customers.id, id)).get()!
      log.info('[ipc:update-customer] Cliente actualizado', { id })
      return { ok: true, data: toCustomerRow(updated) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[ipc:update-customer] Error inesperado', msg)
      return { ok: false, error: 'Error al actualizar el cliente.' }
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCustomerRow(row: typeof customers.$inferSelect): CustomerRow {
  return {
    id: row.id,
    storeId: row.storeId,
    name: row.name,
    dni: row.dni ?? null,
    phone: row.phone ?? null,
    type: (row.type as CustomerRow['type']) ?? null,
    notes: row.notes ?? null,
    active: row.active,
    createdAt: row.createdAt,
  }
}
