/**
 * Handler IPC de detección automática del puerto de la balanza KRETZ.
 *
 * Sondea el protocolo R30 en todos los puertos serie y, si encuentra una balanza,
 * la conecta en caliente (sin reiniciar la app) y persiste el puerto en safeStorage
 * para que se use en el próximo arranque. Es la forma robusta de soportar balanzas
 * idénticas que enumeran en distintos COM según la PC.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import { setSecret, SECRET_KEYS } from '../secureStorage'
import type { IpcResult } from '../../src/types/hw-api'
import type { HardwareManager } from '../hardware/hardwareManager'

const detectPortSchema = z.undefined()

export function registerKretzPortHandlers(manager: HardwareManager): void {
  ipcMain.handle(
    IPC.KRETZ_DETECT_PORT,
    async (_event, payload: unknown): Promise<IpcResult<{ port: string }>> => {
      const parsed = detectPortSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:kretz-detect-port] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
      }

      try {
        const port = await manager.detectAndConnectKretz()
        if (!port) {
          return {
            ok: false,
            error:
              'No se detectó ninguna balanza. Verificá que esté conectada por USB y que iTegra u otro programa que use el puerto esté cerrado.',
          }
        }

        setSecret(SECRET_KEYS.KRETZ_PORT, port)
        log.info('[ipc:kretz-detect-port] Balanza detectada y configurada', { port })
        return { ok: true, data: { port } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('[ipc:kretz-detect-port] Error al detectar la balanza', err)
        return { ok: false, error: msg }
      }
    }
  )
}
