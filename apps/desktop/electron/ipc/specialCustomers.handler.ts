/**
 * Handlers IPC para Clientes Especiales.
 *
 * Entidad completamente separada de la tabla `customers` (fiados).
 * Los admins crean y gestionan estos registros; las cajeras solo leen.
 * Los precios por producto son puramente informativos — no afectan
 * el comportamiento del carrito.
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { specialCustomers, specialCustomerPrices, products } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { nowUtc } from '../../src/lib/datetime'
import type { IpcResult } from '../../src/types/hw-api'

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const createSpecialCustomerSchema = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
})

const updateSpecialCustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  notes: z.string().max(500).optional(),
})

const deleteSpecialCustomerSchema = z.object({
  id: z.string().uuid(),
})

const listSpecialCustomerPricesSchema = z.object({
  specialCustomerId: z.string().uuid(),
})

const setSpecialCustomerPriceSchema = z.object({
  specialCustomerId: z.string().uuid(),
  productId: z.string().uuid(),
  price: z.number().positive(),
  notes: z.string().max(200).optional(),
})

const deleteSpecialCustomerPriceSchema = z.object({
  specialCustomerId: z.string().uuid(),
  productId: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type SpecialCustomerRow = {
  id: string
  storeId: string
  name: string
  notes: string | null
  createdAt: string
  updatedAt: string | null
}

export type SpecialCustomerPriceRow = {
  id: string
  specialCustomerId: string
  productId: string
  productName: string
  originalPrice: number | null
  specialPrice: number
  notes: string | null
  updatedAt: string
  updatedBy: string
}

// ---------------------------------------------------------------------------
// Registro de handlers
// ---------------------------------------------------------------------------

export function registerSpecialCustomersHandlers() {
  // ── LIST_SPECIAL_CUSTOMERS ───────────────────────────────────────────
  ipcMain.handle(IPC.LIST_SPECIAL_CUSTOMERS, (_event, payload: unknown): IpcResult<SpecialCustomerRow[]> => {
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
      const rows = db
        .select()
        .from(specialCustomers)
        .where(effectiveStoreId !== null ? eq(specialCustomers.storeId, effectiveStoreId) : undefined)
        .all()

      return {
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          storeId: r.storeId,
          name: r.name,
          notes: r.notes,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      }
    } catch (err) {
      log.error('[ipc:list-special-customers]', err)
      return { ok: false, error: 'Error al listar clientes especiales.' }
    }
  })

  // ── CREATE_SPECIAL_CUSTOMER ──────────────────────────────────────────
  ipcMain.handle(IPC.CREATE_SPECIAL_CUSTOMER, (_event, payload: unknown): IpcResult<SpecialCustomerRow> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los admins pueden crear clientes especiales.', code: 'FORBIDDEN' }

    const parsed = createSpecialCustomerSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-special-customer] Payload inválido', parsed.error)
      return { ok: false, error: 'Datos inválidos.', code: 'INVALID_PAYLOAD' }
    }

    try {
      const db = getDb()
      const id = uuidv4()
      const now = nowUtc()
      db.insert(specialCustomers).values({
        id,
        storeId: session.storeId,
        name: parsed.data.name.trim(),
        notes: parsed.data.notes?.trim() ?? null,
        createdAt: now,
        createdBy: session.userId,
      }).run()

      log.info('[ipc:create-special-customer]', { id, name: parsed.data.name })
      return { ok: true, data: { id, storeId: session.storeId, name: parsed.data.name.trim(), notes: parsed.data.notes?.trim() ?? null, createdAt: now, updatedAt: null } }
    } catch (err) {
      log.error('[ipc:create-special-customer]', err)
      return { ok: false, error: 'Error al crear el cliente especial.' }
    }
  })

  // ── UPDATE_SPECIAL_CUSTOMER ──────────────────────────────────────────
  ipcMain.handle(IPC.UPDATE_SPECIAL_CUSTOMER, (_event, payload: unknown): IpcResult => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los admins pueden editar clientes especiales.', code: 'FORBIDDEN' }

    const parsed = updateSpecialCustomerSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'Datos inválidos.', code: 'INVALID_PAYLOAD' }

    try {
      const db = getDb()
      const now = nowUtc()
      const updates: Partial<typeof specialCustomers.$inferInsert> = {
        updatedAt: now,
        updatedBy: session.userId,
      }
      if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim()
      if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes.trim() || null

      db.update(specialCustomers).set(updates).where(and(
        eq(specialCustomers.id, parsed.data.id),
        eq(specialCustomers.storeId, session.storeId),
      )).run()

      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:update-special-customer]', err)
      return { ok: false, error: 'Error al actualizar el cliente especial.' }
    }
  })

  // ── DELETE_SPECIAL_CUSTOMER ──────────────────────────────────────────
  ipcMain.handle(IPC.DELETE_SPECIAL_CUSTOMER, (_event, payload: unknown): IpcResult => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los admins pueden eliminar clientes especiales.', code: 'FORBIDDEN' }

    const parsed = deleteSpecialCustomerSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'Datos inválidos.', code: 'INVALID_PAYLOAD' }

    try {
      const db = getDb()
      db.transaction(tx => {
        tx.delete(specialCustomerPrices)
          .where(eq(specialCustomerPrices.specialCustomerId, parsed.data.id))
          .run()
        tx.delete(specialCustomers)
          .where(and(
            eq(specialCustomers.id, parsed.data.id),
            eq(specialCustomers.storeId, session.storeId),
          ))
          .run()
      })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:delete-special-customer]', err)
      return { ok: false, error: 'Error al eliminar el cliente especial.' }
    }
  })

  // ── GET_SPECIAL_CUSTOMER_PRICES ──────────────────────────────────────
  ipcMain.handle(IPC.GET_SPECIAL_CUSTOMER_PRICES, (_event, payload: unknown): IpcResult<SpecialCustomerPriceRow[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const parsed = listSpecialCustomerPricesSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'Datos inválidos.', code: 'INVALID_PAYLOAD' }

    try {
      const db = getDb()
      const rows = db
        .select({
          id: specialCustomerPrices.id,
          specialCustomerId: specialCustomerPrices.specialCustomerId,
          productId: specialCustomerPrices.productId,
          productName: products.name,
          specialPrice: specialCustomerPrices.price,
          notes: specialCustomerPrices.notes,
          updatedAt: specialCustomerPrices.updatedAt,
          updatedBy: specialCustomerPrices.updatedBy,
        })
        .from(specialCustomerPrices)
        .innerJoin(products, eq(specialCustomerPrices.productId, products.id))
        .where(eq(specialCustomerPrices.specialCustomerId, parsed.data.specialCustomerId))
        .all()

      return {
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          specialCustomerId: r.specialCustomerId,
          productId: r.productId,
          productName: r.productName,
          originalPrice: null,
          specialPrice: r.specialPrice,
          notes: r.notes,
          updatedAt: r.updatedAt,
          updatedBy: r.updatedBy,
        })),
      }
    } catch (err) {
      log.error('[ipc:get-special-customer-prices]', err)
      return { ok: false, error: 'Error al obtener los precios especiales.' }
    }
  })

  // ── SET_SPECIAL_CUSTOMER_PRICE ───────────────────────────────────────
  ipcMain.handle(IPC.SET_SPECIAL_CUSTOMER_PRICE, (_event, payload: unknown): IpcResult => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los admins pueden editar precios especiales.', code: 'FORBIDDEN' }

    const parsed = setSpecialCustomerPriceSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'Datos inválidos.', code: 'INVALID_PAYLOAD' }

    try {
      const db = getDb()
      const now = nowUtc()
      const { specialCustomerId, productId, price, notes } = parsed.data

      const existing = db
        .select({ id: specialCustomerPrices.id })
        .from(specialCustomerPrices)
        .where(and(
          eq(specialCustomerPrices.specialCustomerId, specialCustomerId),
          eq(specialCustomerPrices.productId, productId),
        ))
        .get()

      if (existing) {
        db.update(specialCustomerPrices).set({
          price,
          notes: notes?.trim() ?? null,
          updatedAt: now,
          updatedBy: session.userId,
        }).where(eq(specialCustomerPrices.id, existing.id)).run()
      } else {
        db.insert(specialCustomerPrices).values({
          id: uuidv4(),
          specialCustomerId,
          productId,
          price,
          notes: notes?.trim() ?? null,
          updatedAt: now,
          updatedBy: session.userId,
        }).run()
      }

      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:set-special-customer-price]', err)
      return { ok: false, error: 'Error al guardar el precio especial.' }
    }
  })

  // ── DELETE_SPECIAL_CUSTOMER_PRICE ────────────────────────────────────
  ipcMain.handle(IPC.DELETE_SPECIAL_CUSTOMER_PRICE, (_event, payload: unknown): IpcResult => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo los admins pueden eliminar precios especiales.', code: 'FORBIDDEN' }

    const parsed = deleteSpecialCustomerPriceSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'Datos inválidos.', code: 'INVALID_PAYLOAD' }

    try {
      const db = getDb()
      db.delete(specialCustomerPrices)
        .where(and(
          eq(specialCustomerPrices.specialCustomerId, parsed.data.specialCustomerId),
          eq(specialCustomerPrices.productId, parsed.data.productId),
        ))
        .run()
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:delete-special-customer-price]', err)
      return { ok: false, error: 'Error al eliminar el precio especial.' }
    }
  })
}
