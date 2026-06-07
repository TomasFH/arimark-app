import { ipcMain, app } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import type { IpcResult, AppInfo } from '../../src/types/hw-api'

const getAppInfoPayloadSchema = z.undefined()

export function registerAppInfoHandler(): void {
  ipcMain.handle(IPC.GET_APP_INFO, (_event, payload: unknown): IpcResult<AppInfo> => {
    const parsed = getAppInfoPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-app-info] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
    }

    const env = (process.env['APP_ENV'] ?? 'sandbox') as 'sandbox' | 'fieldtest' | 'production'

    return {
      ok: true,
      data: {
        version: app.getVersion(),
        env,
      },
    }
  })
}
