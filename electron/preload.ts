import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc/channels'
import type { HwApi, HardwareStatus, ScaleOrder } from '../src/types/hw-api'

const hw: HwApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.GET_APP_INFO),

  getInitStatus: () => ipcRenderer.invoke(IPC.GET_INIT_STATUS),

  getHardwareStatus: () => ipcRenderer.invoke(IPC.GET_HARDWARE_STATUS),

  onHardwareStatusChange: cb => {
    const listener = (_event: Electron.IpcRendererEvent, status: HardwareStatus) => cb(status)
    ipcRenderer.on(IPC.HARDWARE_STATUS_CHANGE, listener)
    return () => ipcRenderer.removeListener(IPC.HARDWARE_STATUS_CHANGE, listener)
  },

  onScaleOrder: cb => {
    const listener = (_event: Electron.IpcRendererEvent, order: ScaleOrder) => cb(order)
    ipcRenderer.on(IPC.SCALE_ORDER, listener)
    return () => ipcRenderer.removeListener(IPC.SCALE_ORDER, listener)
  },

  processFiscalPayment: payload => ipcRenderer.invoke(IPC.PROCESS_FISCAL_PAYMENT, payload),

  issueCashReceipt: payload => ipcRenderer.invoke(IPC.ISSUE_CASH_RECEIPT, payload),

  getHardwareConfig: () => ipcRenderer.invoke(IPC.GET_HARDWARE_CONFIG),

  setHardwareConfig: payload => ipcRenderer.invoke(IPC.SET_HARDWARE_CONFIG, payload),

  activateInstallation: payload => ipcRenderer.invoke(IPC.ACTIVATE_INSTALLATION, payload),

  loginCashier: payload => ipcRenderer.invoke(IPC.LOGIN_CASHIER, payload),

  loginAdmin: payload => ipcRenderer.invoke(IPC.LOGIN_ADMIN, payload),

  logout: payload => ipcRenderer.invoke(IPC.LOGOUT, payload),

  getActiveShift: () => ipcRenderer.invoke(IPC.GET_ACTIVE_SHIFT),

  openShift: payload => ipcRenderer.invoke(IPC.OPEN_SHIFT, payload),

  createSale: payload => ipcRenderer.invoke(IPC.CREATE_SALE, payload),

  injectMockOrder: payload => ipcRenderer.invoke(IPC.INJECT_MOCK_ORDER, payload),
}

contextBridge.exposeInMainWorld('hw', hw)
