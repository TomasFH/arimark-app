import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import {
  getSecret,
  setSecret,
  SECRET_KEYS,
} from '../secureStorage'
import type { IpcResult, HardwareConfig, SetHardwareConfigPayload } from '../../src/types/hw-api'

const getHardwareConfigSchema = z.undefined()

const setHardwareConfigSchema = z
  .object({
    kretzPort: z.string().optional(),
  })
  .refine(obj => Object.values(obj).some(v => v !== undefined), {
    message: 'Debe especificarse al menos un campo de configuración',
  })

export function registerHardwareConfigHandlers(): void {
  ipcMain.handle(
    IPC.GET_HARDWARE_CONFIG,
    (_event, payload: unknown): IpcResult<HardwareConfig> => {
      const parsed = getHardwareConfigSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:get-hardware-config] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
      }

      const config: HardwareConfig = {
        kretzPort: getSecret(SECRET_KEYS.KRETZ_PORT) ?? undefined,
      }

      return { ok: true, data: config }
    }
  )

  ipcMain.handle(
    IPC.SET_HARDWARE_CONFIG,
    (_event, payload: unknown): IpcResult => {
      const parsed = setHardwareConfigSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:set-hardware-config] Payload inválido', parsed.error)
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'Payload inválido', code: 'INVALID_PAYLOAD' }
      }

      const data = parsed.data as SetHardwareConfigPayload

      try {
        if (data.kretzPort !== undefined) setSecret(SECRET_KEYS.KRETZ_PORT, data.kretzPort)

        log.info('[ipc:set-hardware-config] Configuración guardada', {
          kretzPort: data.kretzPort,
        })

        return { ok: true, data: undefined }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('[ipc:set-hardware-config] Error al guardar configuración', err)
        return { ok: false, error: msg }
      }
    }
  )
}
