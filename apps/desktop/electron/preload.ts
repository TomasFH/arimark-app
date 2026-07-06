import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc/channels'
import type { HwApi, HardwareStatus, KretzSyncProgress } from '../src/types/hw-api'

const hw: HwApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.GET_APP_INFO),

  getInitStatus: () => ipcRenderer.invoke(IPC.GET_INIT_STATUS),

  getHardwareStatus: () => ipcRenderer.invoke(IPC.GET_HARDWARE_STATUS),

  onHardwareStatusChange: cb => {
    const listener = (_event: Electron.IpcRendererEvent, status: HardwareStatus) => cb(status)
    ipcRenderer.on(IPC.HARDWARE_STATUS_CHANGE, listener)
    return () => ipcRenderer.removeListener(IPC.HARDWARE_STATUS_CHANGE, listener)
  },

  getHardwareConfig: () => ipcRenderer.invoke(IPC.GET_HARDWARE_CONFIG),

  setHardwareConfig: payload => ipcRenderer.invoke(IPC.SET_HARDWARE_CONFIG, payload),

  activateInstallation: payload => ipcRenderer.invoke(IPC.ACTIVATE_INSTALLATION, payload),

  login: payload => ipcRenderer.invoke(IPC.LOGIN, payload),

  loginCashier: payload => ipcRenderer.invoke(IPC.LOGIN_CASHIER, payload),

  loginAdmin: payload => ipcRenderer.invoke(IPC.LOGIN_ADMIN, payload),

  logout: payload => ipcRenderer.invoke(IPC.LOGOUT, payload),

  getActiveShift: () => ipcRenderer.invoke(IPC.GET_ACTIVE_SHIFT),

  openShift: payload => ipcRenderer.invoke(IPC.OPEN_SHIFT, payload),

  getProducts: () => ipcRenderer.invoke(IPC.GET_PRODUCTS),

  getAllProducts: (storeId) => ipcRenderer.invoke(IPC.GET_ALL_PRODUCTS, storeId),

  getStores: () => ipcRenderer.invoke(IPC.GET_STORES),

  createProduct: (payload) => ipcRenderer.invoke(IPC.CREATE_PRODUCT, payload),

  updateProduct: (payload) => ipcRenderer.invoke(IPC.UPDATE_PRODUCT, payload),

  setProductPrice: (payload) => ipcRenderer.invoke(IPC.SET_PRODUCT_PRICE, payload),

  setProductAvailability: (payload) => ipcRenderer.invoke(IPC.SET_PRODUCT_AVAILABILITY, payload),

  getProductPriceHistory: (payload) => ipcRenderer.invoke(IPC.GET_PRODUCT_PRICE_HISTORY, payload),

  listCashiers: () => ipcRenderer.invoke(IPC.LIST_CASHIERS),
  createCashier: (payload) => ipcRenderer.invoke(IPC.CREATE_CASHIER, payload),
  toggleCashier: (payload) => ipcRenderer.invoke(IPC.TOGGLE_CASHIER, payload),

  createSale: payload => ipcRenderer.invoke(IPC.CREATE_SALE, payload),

  // Gestión de PLUs (balanza KRETZ)
  kretzTestLink: () => ipcRenderer.invoke(IPC.KRETZ_TEST_LINK),

  kretzSendPlu: payload => ipcRenderer.invoke(IPC.KRETZ_SEND_PLU, payload),

  kretzDeletePlu: payload => ipcRenderer.invoke(IPC.KRETZ_DELETE_PLU, payload),

  kretzReadPlu: payload => ipcRenderer.invoke(IPC.KRETZ_READ_PLU, payload),

  kretzReadPluCount: () => ipcRenderer.invoke(IPC.KRETZ_READ_PLU_COUNT),

  kretzSyncCatalog: storeId => ipcRenderer.invoke(IPC.KRETZ_SYNC_CATALOG, storeId),

  onKretzSyncProgress: cb => {
    const listener = (_event: Electron.IpcRendererEvent, progress: KretzSyncProgress) => cb(progress)
    ipcRenderer.on(IPC.KRETZ_SYNC_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC.KRETZ_SYNC_PROGRESS, listener)
  },
}

contextBridge.exposeInMainWorld('hw', hw)
