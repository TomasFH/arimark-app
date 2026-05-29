import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import type { IpcResult, FiscalPaymentResult } from '../../src/types/hw-api'
import type { HardwareManager } from '../hardware/hardwareManager'

const processFiscalPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(['debit', 'wallet', 'credit']),
  referenceId: z.string().min(1),
})

const issueCashReceiptSchema = z.object({
  amount: z.number().positive(),
  referenceId: z.string().min(1),
})

export function registerFiscalPaymentHandlers(manager: HardwareManager): void {
  ipcMain.handle(
    IPC.PROCESS_FISCAL_PAYMENT,
    async (_event, payload: unknown): Promise<IpcResult<FiscalPaymentResult>> => {
      const parsed = processFiscalPaymentSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:process-fiscal-payment] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
      }

      const result = await manager.processPayment(parsed.data)
      if (!result.ok) {
        log.warn('[ipc:process-fiscal-payment] Pago rechazado', result.error)
        return { ok: false, error: result.error ?? 'Error al procesar el pago' }
      }

      return { ok: true, data: result }
    }
  )

  ipcMain.handle(
    IPC.ISSUE_CASH_RECEIPT,
    async (_event, payload: unknown): Promise<IpcResult<FiscalPaymentResult>> => {
      const parsed = issueCashReceiptSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:issue-cash-receipt] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
      }

      const result = await manager.issueCashReceipt(parsed.data.amount, parsed.data.referenceId)
      if (!result.ok) {
        log.warn('[ipc:issue-cash-receipt] Recibo rechazado', result.error)
        return { ok: false, error: result.error ?? 'Error al emitir comprobante' }
      }

      return { ok: true, data: result }
    }
  )
}
