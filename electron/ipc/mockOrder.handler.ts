import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import type { HardwareManager } from '../hardware/hardwareManager'
import type { IpcResult } from '../../src/types/hw-api'

const injectMockOrderSchema = z.object({
  channel: z.enum(['A', 'B', 'C', 'D']),
  items: z
    .array(
      z.object({
        productCode: z.string().min(1),
        weightKg: z.number().positive(),
        unitPrice: z.number().positive(),
      })
    )
    .min(1),
})

export function registerMockOrderHandler(manager: HardwareManager): void {
  ipcMain.handle(IPC.INJECT_MOCK_ORDER, (_event, payload: unknown): IpcResult => {
    const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
    if (APP_ENV !== 'sandbox') {
      log.warn('[ipc:inject-mock-order] Rechazado — solo disponible en sandbox')
      return { ok: false, error: 'Solo disponible en modo sandbox.', code: 'NOT_SANDBOX' }
    }

    const parsed = injectMockOrderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:inject-mock-order] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    try {
      manager.injectMockOrder(parsed.data)
      log.info('[ipc:inject-mock-order] Pedido inyectado', {
        channel: parsed.data.channel,
        items: parsed.data.items.length,
      })
      return { ok: true, data: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:inject-mock-order] Error', message)
      return { ok: false, error: message }
    }
  })
}
