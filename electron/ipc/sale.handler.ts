import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { sales, saleItems, salePayments, scaleOrders } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getStoredAdminSession } from './auth.handler'
import type { IpcResult, SaleResult } from '../../src/types/hw-api'

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
})

const createSaleSchema = z
  .object({
    items: z.array(saleItemSchema).min(1),
    payments: z.array(salePaymentSchema).min(1),
    scaleOrderId: z.string().optional(),
    customerId: z.string().optional(),
    isDebt: z.boolean().optional(),
    manualEntry: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .refine(
    data => {
      const itemTotal = data.items.reduce((sum, i) => sum + i.subtotal, 0)
      const paymentTotal = data.payments.reduce((sum, p) => sum + p.amount, 0)
      return Math.abs(itemTotal - paymentTotal) < 0.01
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

    // Ventas manuales: requieren sesión de admin activa en producción
    const APP_ENV = process.env['APP_ENV'] ?? 'dev'
    if (parsed.data.manualEntry && APP_ENV !== 'dev') {
      const adminSession = getStoredAdminSession()
      if (!adminSession || new Date(adminSession.expiresAt) < new Date()) {
        return {
          ok: false,
          error: 'Venta manual requiere autorización de administrador.',
          code: 'ADMIN_REQUIRED',
        }
      }
    }

    const { items, payments, scaleOrderId, customerId, isDebt, manualEntry, notes } = parsed.data
    const total = Math.round(items.reduce((sum, i) => sum + i.subtotal, 0) * 100) / 100
    const saleId = uuidv4()
    const now = new Date().toISOString()
    const db = getDb()

    // Aprobación admin para entradas manuales
    let manualApprovedBy: string | null = null
    let manualApprovedAt: string | null = null
    if (manualEntry) {
      if (APP_ENV === 'dev') {
        manualApprovedBy = session.userId
        manualApprovedAt = now
      } else {
        const adminSession = getStoredAdminSession()
        if (adminSession) {
          manualApprovedBy = adminSession.uid
          manualApprovedAt = now
        }
      }
    }

    // -------------------------------------------------------------------------
    // Fase 1: Transacción SQLite — crear venta + ítems + marcar pedido
    // -------------------------------------------------------------------------
    try {
      db.transaction(tx => {
        tx.insert(sales)
          .values({
            id: saleId,
            storeId: session.storeId,
            shiftId: session.shiftId!,
            customerId: customerId ?? null,
            scaleOrderId: scaleOrderId ?? null,
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

        // Marcar el pedido de balanza como confirmado si está asociado
        if (scaleOrderId) {
          tx.update(scaleOrders)
            .set({ status: 'confirmed' })
            .where(eq(scaleOrders.id, scaleOrderId))
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
              createdAt: confirmAt,
              createdBy: session.userId,
            })
            .run()
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:create-sale] Error al confirmar venta', message)
      _discardSale(db, saleId, scaleOrderId)
      return {
        ok: false,
        error: 'No se pudo confirmar la venta. Intentar nuevamente.',
        code: 'DB_ERROR',
      }
    }

    log.info('[ipc:create-sale] Venta confirmada', { saleId, total, payments: payments.length })
    return { ok: true, data: { saleId, total } }
  })
}

// ---------------------------------------------------------------------------
// Transacción compensatoria — descarta la venta si falla la confirmación local
// ---------------------------------------------------------------------------

function _discardSale(
  db: ReturnType<typeof getDb>,
  saleId: string,
  scaleOrderId: string | undefined
): void {
  try {
    db.transaction(tx => {
      tx.update(sales).set({ status: 'discarded' }).where(eq(sales.id, saleId)).run()

      // Restaurar el pedido de balanza a pendiente para que la cajera pueda reintentarlo
      if (scaleOrderId) {
        tx.update(scaleOrders)
          .set({ status: 'pending' })
          .where(eq(scaleOrders.id, scaleOrderId))
          .run()
      }
    })
  } catch (err) {
    log.error('[ipc:create-sale] Error al descartar venta', err)
  }
}
