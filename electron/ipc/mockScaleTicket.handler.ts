import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import type { HardwareManager } from '../hardware/hardwareManager'
import type { IpcResult } from '../../src/types/hw-api'

const injectMockScaleTicketSchema = z.object({
  productCode: z.string().min(1),
  weightKg: z.number().positive(),
  unitPrice: z.number().positive(),
})

export function registerMockScaleTicketHandler(manager: HardwareManager): void {
  ipcMain.handle(IPC.INJECT_MOCK_SCALE_TICKET, (_event, payload: unknown): IpcResult => {
    const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
    if (APP_ENV !== 'sandbox') {
      log.warn('[ipc:inject-mock-scale-ticket] Rechazado — solo disponible en sandbox')
      return { ok: false, error: 'Solo disponible en modo sandbox.', code: 'NOT_SANDBOX' }
    }

    const parsed = injectMockScaleTicketSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:inject-mock-scale-ticket] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    try {
      manager.injectMockScaleTicket(parsed.data)
      log.info('[ipc:inject-mock-scale-ticket] Ticket inyectado', parsed.data)
      return { ok: true, data: undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:inject-mock-scale-ticket] Error', message)
      return { ok: false, error: message }
    }
  })
}
