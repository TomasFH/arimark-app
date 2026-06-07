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
import type { HardwareManager } from '../hardware/hardwareManager'
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

export function registerSaleHandlers(manager: HardwareManager): void {
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
    const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
    if (parsed.data.manualEntry && APP_ENV !== 'sandbox' && APP_ENV !== 'fieldtest') {
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
      if (APP_ENV === 'sandbox' || APP_ENV === 'fieldtest') {
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
            fiscalReceiptIssued: false,
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
    // Fase 2: Pagos digitales (async) — si falla, revertir en DB
    // -------------------------------------------------------------------------
    const digitalPayments = payments.filter(p => p.paymentMethod !== 'cash')
    const receiptNumbers: string[] = []

    for (const payment of digitalPayments) {
      try {
        const result = await manager.processPayment({
          amount: payment.amount,
          paymentMethod: payment.paymentMethod as 'debit' | 'wallet' | 'credit',
          referenceId: saleId,
        })

        if (!result.ok) {
          log.warn('[ipc:create-sale] Pago digital rechazado', { method: payment.paymentMethod, error: result.error })
          _discardSale(db, saleId, scaleOrderId)
          return {
            ok: false,
            error: `Pago ${payment.paymentMethod} rechazado: ${result.error ?? 'Error de caja registradora'}`,
            code: 'FISCAL_ERROR',
          }
        }

        if (result.receiptNumber) receiptNumbers.push(result.receiptNumber)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('[ipc:create-sale] Error de comunicación con SAM4S', message)
        _discardSale(db, saleId, scaleOrderId)
        return {
          ok: false,
          error: 'Error de comunicación con la caja registradora.',
          code: 'FISCAL_ERROR',
        }
      }
    }

    // -------------------------------------------------------------------------
    // Fase 3: Comprobante de efectivo (no crítico — si falla, igual se confirma)
    // -------------------------------------------------------------------------
    const cashTotal = payments.filter(p => p.paymentMethod === 'cash').reduce((s, p) => s + p.amount, 0)
    let fiscalReceiptIssued = digitalPayments.length > 0

    if (cashTotal > 0) {
      try {
        const result = await manager.issueCashReceipt(cashTotal, saleId)
        if (result.ok) {
          fiscalReceiptIssued = true
          if (result.receiptNumber) receiptNumbers.push(result.receiptNumber)
        }
      } catch (err) {
        log.warn('[ipc:create-sale] No se pudo emitir comprobante en efectivo', err)
      }
    }

    // -------------------------------------------------------------------------
    // Fase 4: Confirmar venta + insertar pagos
    // -------------------------------------------------------------------------
    try {
      const confirmAt = new Date().toISOString()
      db.transaction(tx => {
        tx.update(sales)
          .set({ status: 'confirmed', fiscalReceiptIssued })
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
      // La venta fue procesada fiscalmente — no se puede descartar. Devolver error
      // pero sin revertir para evitar inconsistencia entre caja y DB.
      return {
        ok: false,
        error: 'La venta fue procesada pero hubo un error al guardarla. Contactar al administrador.',
        code: 'DB_ERROR',
      }
    }

    log.info('[ipc:create-sale] Venta confirmada', { saleId, total, payments: payments.length })
    return { ok: true, data: { saleId, total, fiscalReceiptIssued, receiptNumbers } }
  })
}

// ---------------------------------------------------------------------------
// Transacción compensatoria — descarta la venta si los pagos fiscales fallan
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
