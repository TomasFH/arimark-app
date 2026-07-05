import { ipcMain } from 'electron'
import log from 'electron-log'
import { IPC } from './channels'
import type { IpcResult, InitStatus } from '../../src/types/hw-api'

let _status: InitStatus | null = null

/**
 * Guarda el estado de inicialización calculado en main.ts.
 * Debe llamarse antes de registrar los handlers IPC.
 */
export function setInitStatus(status: InitStatus): void {
  _status = status
}

export function registerInitStatusHandler(): void {
  ipcMain.handle(IPC.GET_INIT_STATUS, (): IpcResult<InitStatus> => {
    if (!_status) {
      log.error('[ipc:get-init-status] InitStatus no fue seteado antes de registrar el handler')
      return { ok: false, error: 'La app no terminó de inicializarse. Reiniciar la aplicación.' }
    }
    return { ok: true, data: _status }
  })
}
