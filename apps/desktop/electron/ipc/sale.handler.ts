import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, and, desc, inArray, ne } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { sales, saleItems, salePayments, products } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { notifySaleOccurred } from './inactivityDaemon'
import type { IpcResult, SaleResult, ShiftSaleRow } from '../../src/types/hw-api'

// ---------------------------------------------------------------------------
// Schemas de validación
// ---------------------------------------------------------------------------

const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  subtotal: z.number().positive(),
})

const salePaymentSchema = z.object({
  paymentMethod: z.enum(['cash', 'debit', 'wallet', 'credit']),
  amount: z.number().positive(),
  installments: z.number().int().positive().optional(),
})

const createSaleSchema = z
  .object({
    items: z.array(saleItemSchema).min(1),
    // isDebt=true: pagos pueden estar vacíos (la deuda se registra vía createDebt)
    payments: z.array(salePaymentSchema).min(0),
    customerId: z.string().optional(),
    isDebt: z.boolean().optional(),
    manualEntry: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .refine(
    data => {
      // En ventas fiado el pago es diferido: no se valida la suma
      if (data.isDebt) return true
      if (data.payments.length === 0) return false
      const itemTotal = Math.round(data.items.reduce((sum, i) => sum + i.subtotal, 0))
      const paymentTotal = Math.round(data.payments.reduce((sum, p) => sum + p.amount, 0))
      return Math.abs(itemTotal - paymentTotal) < 0.5
    },
    { message: 'La suma de pagos no coincide con el total de la venta.' }
  )

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function registerSaleHandlers(): void {
  ipcMain.handle(IPC.CREATE_SALE, async (_event, payload: unknown): Promise<IpcResult<SaleResult>> => {
    const parsed = createSaleSchema.safeParse(payload)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'Payload inválido'
      log.error('[ipc:create-sale] Payload inválido', parsed.error)
      return { ok: false, error: msg, code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }
    if (!session.shiftId) {
      return {
        ok: false,
        error: 'No hay turno activo. Abrir un turno antes de registrar ventas.',
        code: 'NO_SHIFT',
      }
    }

    const { items, payments, customerId, isDebt, manualEntry, notes } = parsed.data
    const total = Math.round(items.reduce((sum, i) => sum + i.subtotal, 0) * 100) / 100
    const saleId = uuidv4()
    const now = new Date().toISOString()
    const db = getDb()

    // La cajera que registra la venta manual queda asentada como responsable.
    const manualApprovedBy: string | null = manualEntry ? session.userId : null
    const manualApprovedAt: string | null = manualEntry ? now : null

    // -------------------------------------------------------------------------
    // Fase 1: Transacción SQLite — crear venta + ítems
    // -------------------------------------------------------------------------
    try {
      db.transaction(tx => {
        tx.insert(sales)
          .values({
            id: saleId,
            storeId: session.storeId,
            shiftId: session.shiftId!,
            customerId: customerId ?? null,
            total,
            isDebt: isDebt ?? false,
            status: 'in_progress',
            manualEntry: manualEntry ?? false,
            manualApprovedBy,
            manualApprovedAt,
            notes: notes ?? null,
            createdAt: now,
            createdBy: session.userId,
          })
          .run()

        for (const item of items) {
          tx.insert(saleItems)
            .values({
              id: uuidv4(),
              saleId,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              notes: null,
            })
            .run()
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:create-sale] Error en transacción inicial', message)
      return { ok: false, error: 'Error al guardar la venta. Intentar nuevamente.', code: 'DB_ERROR' }
    }

    // -------------------------------------------------------------------------
    // Fase 2: Confirmar venta + insertar pagos
    // -------------------------------------------------------------------------
    try {
      const confirmAt = new Date().toISOString()
      db.transaction(tx => {
        tx.update(sales)
          .set({ status: 'confirmed' })
          .where(eq(sales.id, saleId))
          .run()

        for (const payment of payments) {
          tx.insert(salePayments)
            .values({
              id: uuidv4(),
              saleId,
              paymentMethod: payment.paymentMethod,
              amount: payment.amount,
              installments: payment.installments ?? null,
              createdAt: confirmAt,
              createdBy: session.userId,
            })
            .run()
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:create-sale] Error al confirmar venta', message)
      _discardSale(db, saleId)
      return {
        ok: false,
        error: 'No se pudo confirmar la venta. Intentar nuevamente.',
        code: 'DB_ERROR',
      }
    }

    log.info('[ipc:create-sale] Venta confirmada', { saleId, total, payments: payments.length })
    notifySaleOccurred()
    return { ok: true, data: { saleId, total } }
  })

  // -------------------------------------------------------------------------
  // Listado de ventas del turno activo (vista en vivo tipo cuaderno)
  // -------------------------------------------------------------------------
  ipcMain.handle(IPC.GET_SHIFT_SALES, (_event): IpcResult<ShiftSaleRow[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    try {
      const db = getDb()

      const saleRows = db
        .select({
          id: sales.id,
          total: sales.total,
          status: sales.status,
          manualEntry: sales.manualEntry,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .where(and(
          eq(sales.shiftId, session.shiftId),
          ne(sales.status, 'in_progress'),
          ne(sales.status, 'discarded'),
        ))
        .orderBy(desc(sales.createdAt))
        .all()

      if (saleRows.length === 0) return { ok: true, data: [] }

      const saleIds = saleRows.map(s => s.id)

      // Ítems de todas las ventas (join con products para el nombre y unidad)
      const itemRows = db
        .select({
          saleId: saleItems.saleId,
          productName: products.name,
          unit: products.unit,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          subtotal: saleItems.subtotal,
        })
        .from(saleItems)
        .innerJoin(products, eq(saleItems.productId, products.id))
        .where(inArray(saleItems.saleId, saleIds))
        .all()

      // Pagos de todas las ventas
      const paymentRows = db
        .select({
          saleId: salePayments.saleId,
          paymentMethod: salePayments.paymentMethod,
          amount: salePayments.amount,
        })
        .from(salePayments)
        .where(inArray(salePayments.saleId, saleIds))
        .all()

      const itemsBySale = new Map<string, ShiftSaleRow['items']>()
      for (const it of itemRows) {
        const list = itemsBySale.get(it.saleId) ?? []
        list.push({
          productName: it.productName,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
        })
        itemsBySale.set(it.saleId, list)
      }

      const paymentsBySale = new Map<string, typeof paymentRows>()
      for (const p of paymentRows) {
        const list = paymentsBySale.get(p.saleId) ?? []
        list.push(p)
        paymentsBySale.set(p.saleId, list)
      }

      const data: ShiftSaleRow[] = saleRows.map(s => {
        const pays = paymentsBySale.get(s.id) ?? []
        const cashAmount = pays
          .filter(p => p.paymentMethod === 'cash')
          .reduce((sum, p) => sum + p.amount, 0)
        const digitalAmount = pays
          .filter(p => p.paymentMethod !== 'cash')
          .reduce((sum, p) => sum + p.amount, 0)
        return {
          id: s.id,
          createdAt: s.createdAt,
          total: s.total,
          status: s.status as 'confirmed' | 'cancelled',
          cashAmount,
          digitalAmount,
          paymentMethods: pays.map(p => p.paymentMethod),
          manualEntry: s.manualEntry,
          items: itemsBySale.get(s.id) ?? [],
        }
      })

      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:get-shift-sales] Error inesperado', message)
      return { ok: false, error: 'Error al obtener las ventas del turno.' }
    }
  })

  // -------------------------------------------------------------------------
  // Cancelar una venta (soft delete — status → 'cancelled').
  // -------------------------------------------------------------------------
  ipcMain.handle(IPC.CANCEL_SALE, (_event, payload: unknown): IpcResult => {
    const parsed = z.string().uuid().safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'ID de venta inválido.', code: 'VALIDATION_ERROR' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    try {
      const db = getDb()
      const sale = db
        .select({ id: sales.id, status: sales.status, shiftId: sales.shiftId })
        .from(sales)
        .where(eq(sales.id, parsed.data))
        .get()

      if (!sale) {
        return { ok: false, error: 'Venta no encontrada.', code: 'NOT_FOUND' }
      }
      if (sale.shiftId !== session.shiftId) {
        return { ok: false, error: 'La venta no pertenece al turno activo.', code: 'FORBIDDEN' }
      }
      if (sale.status === 'cancelled') {
        return { ok: false, error: 'La venta ya estaba cancelada.', code: 'ALREADY_CANCELLED' }
      }
      if (sale.status !== 'confirmed') {
        return { ok: false, error: 'Solo se pueden cancelar ventas confirmadas.', code: 'INVALID_STATUS' }
      }

      db.update(sales).set({ status: 'cancelled' }).where(eq(sales.id, parsed.data)).run()
      log.info('[ipc:cancel-sale] Venta cancelada', { saleId: parsed.data })
      return { ok: true, data: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:cancel-sale] Error inesperado', message)
      return { ok: false, error: 'Error al cancelar la venta.' }
    }
  })
}

// ---------------------------------------------------------------------------
// Transacción compensatoria — descarta la venta si falla la confirmación local
// ---------------------------------------------------------------------------

function _discardSale(
  db: ReturnType<typeof getDb>,
  saleId: string
): void {
  try {
    db.transaction(tx => {
      tx.update(sales).set({ status: 'discarded' }).where(eq(sales.id, saleId)).run()
    })
  } catch (err) {
    log.error('[ipc:create-sale] Error al descartar venta', err)
  }
}
