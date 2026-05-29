import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc/channels'
import type { HwApi, HardwareStatus } from '../src/types/hw-api'

const hw: HwApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.GET_APP_INFO),

  getHardwareStatus: () => ipcRenderer.invoke(IPC.GET_HARDWARE_STATUS),

  onHardwareStatusChange: cb => {
    const listener = (_event: Electron.IpcRendererEvent, status: HardwareStatus) => cb(status)
    ipcRenderer.on(IPC.HARDWARE_STATUS_CHANGE, listener)
    return () => ipcRenderer.removeListener(IPC.HARDWARE_STATUS_CHANGE, listener)
  },

  activateInstallation: payload => ipcRenderer.invoke(IPC.ACTIVATE_INSTALLATION, payload),

  loginCashier: payload => ipcRenderer.invoke(IPC.LOGIN_CASHIER, payload),

  loginAdmin: payload => ipcRenderer.invoke(IPC.LOGIN_ADMIN, payload),

  logout: payload => ipcRenderer.invoke(IPC.LOGOUT, payload),
}

contextBridge.exposeInMainWorld('hw', hw)
