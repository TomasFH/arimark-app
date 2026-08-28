/**
 * IPC de conteos de stock (dominical / periódico).
 *
 * Canales:
 *   CREATE_STOCK_COUNT      — crear o actualizar (borrador / final)
 *   LIST_STOCK_COUNTS       — filtros opcionales store/fechas
 *   GET_STOCK_COUNT_DETAIL  — items de un conteo
 *   GET_DRAFT_STOCK_COUNT   — borrador abierto del local, si hay
 *   DISCARD_STOCK_COUNT_DRAFT — borrar un borrador
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
  StockCountStatus,
  StockCountItemSnapshot,
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
  id: z.string().uuid().optional(),
  countDate: dateSchema,
  /** Admin: obligatorio. Cajera: se ignora y se usa el local de sesión. */
  storeId: z.string().min(1).optional(),
  status: z.enum(['draft', 'final']).default('final'),
  items: z.array(itemSchema).max(500),
}).superRefine((data, ctx) => {
  if (data.status === 'final' && data.items.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Un conteo final debe tener al menos un producto con cantidad.',
      path: ['items'],
    })
  }
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

const draftQuerySchema = z.object({
  storeId: z.string().min(1).optional(),
  countDate: dateSchema.optional(),
}).optional()

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

function asStatus(value: string): StockCountStatus {
  return value === 'draft' ? 'draft' : 'final'
}

function parseOriginalItems(raw: string | null): StockCountItemSnapshot[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((row): row is StockCountItemSnapshot =>
      Boolean(row)
      && typeof row === 'object'
      && typeof (row as { productId?: unknown }).productId === 'number'
      && typeof (row as { productName?: unknown }).productName === 'string',
    ).map(row => ({
      productId: row.productId,
      productName: row.productName,
      quantityKg: row.quantityKg ?? null,
      quantityUnits: row.quantityUnits ?? null,
      notes: row.notes ?? null,
    }))
  } catch {
    return null
  }
}

function snapshotItems(items: Array<{
  productId: number
  productName: string
  quantityKg?: number | null
  quantityUnits?: number | null
  notes?: string | null
}>): string {
  return JSON.stringify(items.map(i => ({
    productId: i.productId,
    productName: i.productName,
    quantityKg: i.quantityKg ?? null,
    quantityUnits: i.quantityUnits ?? null,
    notes: i.notes === undefined || i.notes === '' ? null : i.notes,
  })))
}

function toHeader(
  row: typeof stockCounts.$inferSelect,
  storeName: string,
  recordedByName: string,
  itemCount: number,
  lastEditedByName: string | null,
): StockCountRow {
  return {
    id: row.id,
    storeId: row.storeId,
    storeName,
    countDate: row.countDate,
    recordedBy: row.recordedBy,
    recordedByName,
    itemCount,
    createdAt: row.createdAt,
    status: asStatus(row.status),
    updatedAt: row.updatedAt ?? null,
    lastEditedBy: row.lastEditedBy ?? null,
    lastEditedByName,
    lastEditedAt: row.lastEditedAt ?? null,
    originalItems: parseOriginalItems(row.originalItems ?? null),
  }
}

function resolveStoreId(
  session: { role: string; storeId: string | null },
  payloadStoreId: string | undefined,
): { storeId: string } | { error: string; code: string } {
  if (session.role === 'admin') {
    if (!payloadStoreId) {
      return { error: 'Elegí un local para el conteo.', code: 'INVALID_PAYLOAD' }
    }
    return { storeId: payloadStoreId }
  }
  if (!session.storeId) {
    return { error: 'No hay local seleccionado.', code: 'INVALID_PAYLOAD' }
  }
  return { storeId: session.storeId }
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

    const storeRes = resolveStoreId(session, parsed.data.storeId)
    if ('error' in storeRes) return { ok: false, error: storeRes.error, code: storeRes.code }
    const storeId = storeRes.storeId

    const { countDate, items, status } = parsed.data

    try {
      const db = getDb()
      const store = db.select().from(stores).where(eq(stores.id, storeId)).all()[0]
      if (!store) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      const recorder = db.select().from(users).where(eq(users.id, session.userId)).all()[0]
      const recordedByName = recorder?.name ?? session.userId

      let existing = parsed.data.id
        ? db.select().from(stockCounts).where(eq(stockCounts.id, parsed.data.id)).all()[0]
        : undefined

      if (parsed.data.id && !existing) {
        return { ok: false, error: 'Conteo no encontrado.', code: 'NOT_FOUND' }
      }

      if (existing && existing.storeId !== storeId) {
        return { ok: false, error: 'El conteo pertenece a otro local.', code: 'INVALID_PAYLOAD' }
      }

      if (!existing) {
        existing = db
          .select()
          .from(stockCounts)
          .where(and(eq(stockCounts.storeId, storeId), eq(stockCounts.status, 'draft')))
          .all()[0]
      }

      if (!existing) {
        const sameDay = db
          .select()
          .from(stockCounts)
          .where(and(eq(stockCounts.storeId, storeId), eq(stockCounts.countDate, countDate)))
          .all()
        sameDay.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
        existing = sameDay[0]
      }

      const now = new Date().toISOString()
      const countId = existing?.id ?? uuidv4()
      const createdAt = existing?.createdAt ?? now
      const recordedBy = existing?.recordedBy ?? session.userId
      const nextStatus: StockCountStatus =
        existing && asStatus(existing.status) === 'final' && status === 'draft'
          ? 'final'
          : status
      const originalItemsJson =
        existing?.originalItems
        ?? (nextStatus === 'final' ? snapshotItems(items) : null)
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
        if (existing) {
          tx.update(stockCounts)
            .set({
              countDate,
              recordedBy,
              status: nextStatus,
              updatedAt: now,
              originalItems: originalItemsJson,
              lastEditedBy: session.userId,
              lastEditedAt: now,
            })
            .where(eq(stockCounts.id, countId))
            .run()
          tx.delete(stockCountItems).where(eq(stockCountItems.stockCountId, countId)).run()
        } else {
          tx.insert(stockCounts).values({
            id: countId,
            storeId,
            countDate,
            recordedBy,
            createdAt,
            status: nextStatus,
            updatedAt: now,
            originalItems: originalItemsJson,
            lastEditedBy: session.userId,
            lastEditedAt: now,
          }).run()
        }

        for (const row of itemRows) {
          tx.insert(stockCountItems).values(row).run()
        }
      })

      const originalRecorder = recordedBy === session.userId
        ? recorder
        : db.select().from(users).where(eq(users.id, recordedBy)).all()[0]
      const originalName = originalRecorder?.name ?? recordedBy

      const header: StockCountRow = {
        id: countId,
        storeId,
        storeName: store.name,
        countDate,
        recordedBy,
        recordedByName: originalName,
        itemCount: itemRows.length,
        createdAt,
        status: nextStatus,
        updatedAt: now,
        lastEditedBy: session.userId,
        lastEditedByName: recordedByName,
        lastEditedAt: now,
        originalItems: parseOriginalItems(originalItemsJson),
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
        const aDraft = asStatus(a.status) === 'draft' ? 1 : 0
        const bDraft = asStatus(b.status) === 'draft' ? 1 : 0
        if (aDraft !== bDraft) return bDraft - aDraft
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
        let lastEditedByName: string | null = null
        if (row.lastEditedBy) {
          lastEditedByName = userCache.get(row.lastEditedBy) ?? null
          if (lastEditedByName === null) {
            lastEditedByName = db.select().from(users).where(eq(users.id, row.lastEditedBy)).all()[0]?.name
              ?? row.lastEditedBy
            userCache.set(row.lastEditedBy, lastEditedByName)
          }
        }
        const itemCount = db.select().from(stockCountItems)
          .where(eq(stockCountItems.stockCountId, row.id))
          .all().length

        return toHeader(row, storeName, recordedByName, itemCount, lastEditedByName)
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
        const lastEditedByName = row.lastEditedBy
          ? (db.select().from(users).where(eq(users.id, row.lastEditedBy)).all()[0]?.name ?? row.lastEditedBy)
          : null
        const items = db.select().from(stockCountItems)
          .where(eq(stockCountItems.stockCountId, row.id))
          .all()
          .map(toItemRow)
        items.sort((a, b) => a.productId - b.productId || a.productName.localeCompare(b.productName, 'es-AR'))

        return {
          ok: true,
          data: {
            ...toHeader(row, storeName, recordedByName, items.length, lastEditedByName),
            items,
          },
        }
      } catch (err) {
        log.error('[ipc:get-stock-count-detail] Error inesperado', err)
        return { ok: false, error: 'Error al obtener el detalle del conteo.' }
      }
    },
  )

  // --------------------------------------------------------------------------
  // GET_DRAFT_STOCK_COUNT
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.GET_DRAFT_STOCK_COUNT, (_event, payload: unknown): IpcResult<StockCountDetail | null> => {
    const parsed = draftQuerySchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:get-draft-stock-count] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const storeRes = resolveStoreId(session, parsed.data?.storeId)
    if ('error' in storeRes) return { ok: false, error: storeRes.error, code: storeRes.code }

    try {
      const db = getDb()
      const countDate = parsed.data?.countDate
      let row = db
        .select()
        .from(stockCounts)
        .where(and(eq(stockCounts.storeId, storeRes.storeId), eq(stockCounts.status, 'draft')))
        .all()[0]
      if (!row && countDate) {
        const sameDay = db
          .select()
          .from(stockCounts)
          .where(and(eq(stockCounts.storeId, storeRes.storeId), eq(stockCounts.countDate, countDate)))
          .all()
        sameDay.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
        row = sameDay[0]
      }
      if (!row) return { ok: true, data: null }

      const storeName = db.select().from(stores).where(eq(stores.id, row.storeId)).all()[0]?.name ?? row.storeId
      const recordedByName = db.select().from(users).where(eq(users.id, row.recordedBy)).all()[0]?.name
        ?? row.recordedBy
      const lastEditedByName = row.lastEditedBy
        ? (db.select().from(users).where(eq(users.id, row.lastEditedBy)).all()[0]?.name ?? row.lastEditedBy)
        : null
      const items = db.select().from(stockCountItems)
        .where(eq(stockCountItems.stockCountId, row.id))
        .all()
        .map(toItemRow)
      items.sort((a, b) => a.productId - b.productId || a.productName.localeCompare(b.productName, 'es-AR'))

      return {
        ok: true,
        data: {
          ...toHeader(row, storeName, recordedByName, items.length, lastEditedByName),
          items,
        },
      }
    } catch (err) {
      log.error('[ipc:get-draft-stock-count] Error inesperado', err)
      return { ok: false, error: 'Error al buscar el borrador de conteo.' }
    }
  })

  // --------------------------------------------------------------------------
  // DISCARD_STOCK_COUNT_DRAFT
  // --------------------------------------------------------------------------
  ipcMain.handle(IPC.DISCARD_STOCK_COUNT_DRAFT, (_event, payload: unknown): IpcResult => {
    const parsed = detailSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:discard-stock-count-draft] Payload inválido', parsed.error)
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
      if (asStatus(row.status) !== 'draft') {
        return { ok: false, error: 'Solo se puede descartar un borrador.', code: 'ALREADY_FINAL' }
      }

      db.transaction(tx => {
        tx.delete(stockCountItems).where(eq(stockCountItems.stockCountId, row.id)).run()
        tx.delete(stockCounts).where(eq(stockCounts.id, row.id)).run()
      })

      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:discard-stock-count-draft] Error inesperado', err)
      return { ok: false, error: 'Error al descartar el borrador.' }
    }
  })
}
