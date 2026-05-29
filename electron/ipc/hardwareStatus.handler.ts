import { ipcMain, BrowserWindow } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { IPC } from './channels'
import type { IpcResult, HardwareStatus } from '../../src/types/hw-api'

const getHardwareStatusPayloadSchema = z.undefined()

let currentStatus: HardwareStatus = {
  scale: 'disconnected',
  fiscal: 'disconnected',
}

export function setHardwareStatus(update: Partial<HardwareStatus>): void {
  currentStatus = { ...currentStatus, ...update }
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send(IPC.HARDWARE_STATUS_CHANGE, currentStatus)
  })
}

export function getHardwareStatus(): HardwareStatus {
  return { ...currentStatus }
}

export function registerHardwareStatusHandler(): void {
  ipcMain.handle(
    IPC.GET_HARDWARE_STATUS,
    (_event, payload: unknown): IpcResult<HardwareStatus> => {
      const parsed = getHardwareStatusPayloadSchema.safeParse(payload)
      if (!parsed.success) {
        log.error('[ipc:get-hardware-status] Payload inválido', parsed.error)
        return { ok: false, error: 'Payload inválido', code: 'INVALID_PAYLOAD' }
      }
      return { ok: true, data: getHardwareStatus() }
    }
  )
}
