/**
 * Handlers IPC para gestión de PLUs en la balanza KRETZ.
 *
 * Operaciones disponibles:
 *  - kretz-test-link       : prueba de enlace (0002)
 *  - kretz-send-plu        : crear/actualizar PLU (2005)
 *  - kretz-read-plu        : leer PLU por número (5005)
 *  - kretz-read-plu-count  : contar PLUs almacenados (5001)
 *
 * Todos los payloads se validan con zod antes de llegar al hardware.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import type { IpcResult } from '../../src/types/hw-api'
import type { HardwareManager } from '../hardware/hardwareManager'
import type { PluRow } from '../hardware/kretz/kretzDriver.interface'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const sendPluSchema = z.object({
  pluNumber: z.string().min(1).max(6),
  department: z.string().default('001'),
  family: z.string().default('000'),
  name: z.string().min(1).max(26),
  description: z.string().max(26).default(''),
  articleCode: z.string().max(5).default('00000'),
  pesable: z.boolean(),
  /** Precio raw para REPORT NX/iTegra (pesos × 10). Ej: $21.000 → 210000 */
  priceCents: z.number().int().nonnegative(),
  // 6 dígitos: payload 135 bytes, compatible con iTegra en REPORT NX.
  priceDigits: z.union([z.literal(6), z.literal(7)]).default(6),
})

const readPluSchema = z.object({
  pluNumber: z.string().min(1).max(6),
  priceDigits: z.union([z.literal(6), z.literal(7)]).default(6),
})

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export function registerKretzPluHandlers(manager: HardwareManager): void {

  /** Prueba de enlace — responde true/false sin lanzar. */
  ipcMain.handle(
    IPC.KRETZ_TEST_LINK,
    async (): Promise<IpcResult<{ linked: boolean }>> => {
      try {
        const linked = await manager.kretzTestLink()
        log.info('[ipc:kretz-test-link]', { linked })
        return { ok: true, data: { linked } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('[ipc:kretz-test-link] Error', msg)
        return { ok: false, error: msg }
      }
    }
  )

  /** Crear / actualizar PLU en la balanza. */
  ipcMain.handle(
    IPC.KRETZ_SEND_PLU,
    async (_event, payload: unknown): Promise<IpcResult<{ pluNumber: string }>> => {
      const parsed = sendPluSchema.safeParse(payload)
      if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? 'Payload inválido'
        log.error('[ipc:kretz-send-plu] Payload inválido', parsed.error)
        return { ok: false, error: msg, code: 'INVALID_PAYLOAD' }
      }

      try {
        await manager.kretzSendPlu(parsed.data)
        log.info('[ipc:kretz-send-plu] PLU enviado', { plu: parsed.data.pluNumber })
        return { ok: true, data: { pluNumber: parsed.data.pluNumber } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('[ipc:kretz-send-plu] Error al enviar PLU', msg)
        return { ok: false, error: msg }
      }
    }
  )

  /** Leer un PLU de la balanza por número. */
  ipcMain.handle(
    IPC.KRETZ_READ_PLU,
    async (_event, payload: unknown): Promise<IpcResult<PluRow | null>> => {
      const parsed = readPluSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:kretz-read-plu] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
      }

      try {
        const plu = await manager.kretzReadPlu(parsed.data.pluNumber, parsed.data.priceDigits)
        return { ok: true, data: plu }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('[ipc:kretz-read-plu] Error', msg)
        return { ok: false, error: msg }
      }
    }
  )

  /** Cantidad de PLUs almacenados en la balanza. */
  ipcMain.handle(
    IPC.KRETZ_READ_PLU_COUNT,
    async (): Promise<IpcResult<{ count: number }>> => {
      try {
        const count = await manager.kretzReadPluCount()
        return { ok: true, data: { count } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('[ipc:kretz-read-plu-count] Error', msg)
        return { ok: false, error: msg }
      }
    }
  )
}
