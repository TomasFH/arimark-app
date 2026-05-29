import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import {
  getSecret,
  setSecret,
  getCredential,
  setCredential,
  SECRET_KEYS,
  CREDENTIAL_ACCOUNTS,
} from '../secureStorage'
import type { IpcResult, HardwareConfig, SetHardwareConfigPayload } from '../../src/types/hw-api'

const getHardwareConfigSchema = z.undefined()

const setHardwareConfigSchema = z
  .object({
    kretzPort: z.string().optional(),
    sam4sIp: z.string().optional(),
    sam4sUser: z.string().optional(),
    sam4sPassword: z.string().optional(),
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
        sam4sIp: getSecret(SECRET_KEYS.SAM4S_IP) ?? undefined,
        sam4sUser: getCredential(CREDENTIAL_ACCOUNTS.SAM4S_USER) ?? undefined,
        // La contraseña NUNCA se devuelve al renderer
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
        if (data.sam4sIp !== undefined) setSecret(SECRET_KEYS.SAM4S_IP, data.sam4sIp)
        if (data.sam4sUser !== undefined) setCredential(CREDENTIAL_ACCOUNTS.SAM4S_USER, data.sam4sUser)
        if (data.sam4sPassword !== undefined) setCredential(CREDENTIAL_ACCOUNTS.SAM4S_PASSWORD, data.sam4sPassword)

        log.info('[ipc:set-hardware-config] Configuración guardada', {
          kretzPort: data.kretzPort,
          sam4sIp: data.sam4sIp,
          sam4sUser: data.sam4sUser,
          sam4sPasswordSet: data.sam4sPassword !== undefined,
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
