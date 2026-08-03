/**
 * IPC de conteos de stock (dominical / periódico).
 *
 * Canales:
 *   CREATE_STOCK_COUNT      — header + items en transacción
 *   LIST_STOCK_COUNTS       — filtros opcionales store/fechas
 *   GET_STOCK_COUNT_DETAIL  — items de un conteo
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq, gte, lte } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { stockCounts, stockCountItems, stores, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type {
  IpcResult,
  StockCountRow,
  StockCountDetail,
  StockCountItemRow,
} from '../../src/types/hw-api'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const itemSchema = z.object({
  productId: z.number().int().positive(),
  productName: z.string().min(1).max(200).transform(s => s.trim()),
  quantityKg: z.number().int().min(0).max(999_999_999).optional().nullable(),
  quantityUnits: z.number().int().min(0).max(999_999_999).optional().nullable(),
  notes: z.string().max(500).transform(s => s.trim()).optional().nullable(),
}).refine(
  d => (d.quantityKg != null && d.quantityKg > 0) || (d.quantityUnits != null && d.quantityUnits > 0),
  { message: 'Cada ítem debe tener cantidad en kg (gramos) o unidades > 0.' },
)

const createSchema = z.object({
  countDate: dateSchema,
  /** Admin puede indicar local; si se omite usa session.storeId. */
  storeId: z.string().min(1).optional(),
  items: z.array(itemSchema).min(1).max(500),
})

const listSchema = z.object({
  storeId: z.string().min(1).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
}).refine(
  d => !(d.startDate && d.endDate && d.startDate > d.endDate),
  { message: 'startDate no puede ser posterior a endDate.', path: ['startDate'] },
)

const detailSchema = z.object({
  stockCountId: z.string().min(1),
})

function toItemRow(row: typeof stockCountItems.$inferSelect): StockCountItemRow {
  return {
    id: row.id,
    stockCountId: row.stockCountId,
    productId: row.productId,
    productName: row.productName,
    quantityKg: row.quantityKg ?? null,
    quantityUnits: row.quantityUnits ?? null,
    notes: row.notes ?? null,
  }
}

export function registerStockCountHandlers(): void {
  // --------------------------------------------------------------------------
  // CREATE_STOCK_COUNT
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.CREATE_STOCK_COUNT, (_event, payload: unknown): IpcResult<StockCountDetail> => {
    const parsed = createSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-stock-count] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    if (session.role === 'cashier' && !session.shiftId) {
      return {
        ok: false,
        error: 'Se requiere un turno abierto para registrar el conteo.',
        code: 'NO_SHIFT',
      }
    }

    const storeId = parsed.data.storeId ?? session.storeId
    if (!storeId) {
      return { ok: false, error: 'No hay local seleccionado.', code: 'INVALID_PAYLOAD' }
    }

    const { countDate, items } = parsed.data

    try {
      const db = getDb()
      const store = db.select().from(stores).where(eq(stores.id, storeId)).all()[0]
      if (!store) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      const recorder = db.select().from(users).where(eq(users.id, session.userId)).all()[0]
      const recordedByName = recorder?.name ?? session.userId

      const now = new Date().toISOString()
      const countId = uuidv4()
      const itemRows: typeof stockCountItems.$inferInsert[] = items.map(item => ({
        id: uuidv4(),
        stockCountId: countId,
        productId: item.productId,
        productName: item.productName,
        quantityKg: item.quantityKg ?? null,
        quantityUnits: item.quantityUnits ?? null,
        notes: item.notes === undefined || item.notes === '' ? null : item.notes,
      }))

      db.transaction(tx => {
        tx.insert(stockCounts).values({
          id: countId,
          storeId,
          countDate,
          recordedBy: session.userId,
          createdAt: now,
        }).run()

        for (const row of itemRows) {
          tx.insert(stockCountItems).values(row).run()
        }
      })

      const header: StockCountRow = {
        id: countId,
        storeId,
        storeName: store.name,
        countDate,
        recordedBy: session.userId,
        recordedByName,
        itemCount: itemRows.length,
        createdAt: now,
      }

      return {
        ok: true,
        data: {
          ...header,
          items: itemRows.map(r => ({
            id: r.id,
            stockCountId: countId,
            productId: r.productId,
            productName: r.productName,
            quantityKg: r.quantityKg ?? null,
            quantityUnits: r.quantityUnits ?? null,
            notes: r.notes ?? null,
          })),
        },
      }
    } catch (err) {
      log.error('[ipc:create-stock-count] Error inesperado', err)
      return { ok: false, error: 'Error al guardar el conteo de stock.' }
    }
  })

  // --------------------------------------------------------------------------
  // LIST_STOCK_COUNTS
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.LIST_STOCK_COUNTS, (_event, payload: unknown): IpcResult<StockCountRow[]> => {
    const parsed = listSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:list-stock-counts] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { storeId, startDate, endDate } = parsed.data

    try {
      const db = getDb()
      const conditions = []
      if (storeId) conditions.push(eq(stockCounts.storeId, storeId))
      if (startDate) conditions.push(gte(stockCounts.countDate, startDate))
      if (endDate) conditions.push(lte(stockCounts.countDate, endDate))

      const rows = conditions.length > 0
        ? db.select().from(stockCounts).where(and(...conditions)).all()
        : db.select().from(stockCounts).all()

      rows.sort((a, b) => {
        const byDate = b.countDate.localeCompare(a.countDate)
        if (byDate !== 0) return byDate
        return b.createdAt.localeCompare(a.createdAt)
      })

      const storeCache = new Map<string, string>()
      const userCache = new Map<string, string>()
      const result: StockCountRow[] = rows.map(row => {
        let storeName = storeCache.get(row.storeId)
        if (storeName === undefined) {
          storeName = db.select().from(stores).where(eq(stores.id, row.storeId)).all()[0]?.name ?? row.storeId
          storeCache.set(row.storeId, storeName)
        }
        let recordedByName = userCache.get(row.recordedBy)
        if (recordedByName === undefined) {
          recordedByName = db.select().from(users).where(eq(users.id, row.recordedBy)).all()[0]?.name ?? row.recordedBy
          userCache.set(row.recordedBy, recordedByName)
        }
        const itemCount = db.select().from(stockCountItems)
          .where(eq(stockCountItems.stockCountId, row.id))
          .all().length

        return {
          id: row.id,
          storeId: row.storeId,
          storeName,
          countDate: row.countDate,
          recordedBy: row.recordedBy,
          recordedByName,
          itemCount,
          createdAt: row.createdAt,
        }
      })

      return { ok: true, data: result }
    } catch (err) {
      log.error('[ipc:list-stock-counts] Error inesperado', err)
      return { ok: false, error: 'Error al listar conteos de stock.' }
    }
  })

  // --------------------------------------------------------------------------
  // GET_STOCK_COUNT_DETAIL
  // --------------------------------------------------------------------------
  ipcMain.handle(
    IPC.GET_STOCK_COUNT_DETAIL,
    (_event, payload: unknown): IpcResult<StockCountDetail> => {
      const parsed = detailSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:get-stock-count-detail] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
      }

      const session = getActiveSession()
      if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

      try {
        const db = getDb()
        const row = db.select().from(stockCounts)
          .where(eq(stockCounts.id, parsed.data.stockCountId))
          .all()[0]
        if (!row) return { ok: false, error: 'Conteo no encontrado.', code: 'NOT_FOUND' }

        const storeName = db.select().from(stores).where(eq(stores.id, row.storeId)).all()[0]?.name ?? row.storeId
        const recordedByName = db.select().from(users).where(eq(users.id, row.recordedBy)).all()[0]?.name
          ?? row.recordedBy
        const items = db.select().from(stockCountItems)
          .where(eq(stockCountItems.stockCountId, row.id))
          .all()
          .map(toItemRow)
        items.sort((a, b) => a.productId - b.productId || a.productName.localeCompare(b.productName, 'es-AR'))

        return {
          ok: true,
          data: {
            id: row.id,
            storeId: row.storeId,
            storeName,
            countDate: row.countDate,
            recordedBy: row.recordedBy,
            recordedByName,
            itemCount: items.length,
            createdAt: row.createdAt,
            items,
          },
        }
      } catch (err) {
        log.error('[ipc:get-stock-count-detail] Error inesperado', err)
        return { ok: false, error: 'Error al obtener el detalle del conteo.' }
      }
    },
  )
}
