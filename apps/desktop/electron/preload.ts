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

  kretzDetectPort: () => ipcRenderer.invoke(IPC.KRETZ_DETECT_PORT),

  activateInstallation: payload => ipcRenderer.invoke(IPC.ACTIVATE_INSTALLATION, payload),

  login: payload => ipcRenderer.invoke(IPC.LOGIN, payload),

  loginCashier: payload => ipcRenderer.invoke(IPC.LOGIN_CASHIER, payload),

  loginAdmin: payload => ipcRenderer.invoke(IPC.LOGIN_ADMIN, payload),

  logout: payload => ipcRenderer.invoke(IPC.LOGOUT, payload),

  refreshRemoteData: () => ipcRenderer.invoke(IPC.REFRESH_REMOTE_DATA),

  getActiveShift: () => ipcRenderer.invoke(IPC.GET_ACTIVE_SHIFT),

  getStoreOpenShift: () => ipcRenderer.invoke(IPC.GET_STORE_OPEN_SHIFT),

  getUserOpenShift: () => ipcRenderer.invoke(IPC.GET_USER_OPEN_SHIFT),

  openShift: payload => ipcRenderer.invoke(IPC.OPEN_SHIFT, payload),

  getShiftSummary: () => ipcRenderer.invoke(IPC.GET_SHIFT_SUMMARY),

  closeShift: payload => ipcRenderer.invoke(IPC.CLOSE_SHIFT, payload),

  forceCloseOpenShift: payload => ipcRenderer.invoke(IPC.FORCE_CLOSE_OPEN_SHIFT, payload),

  onShiftInactivityWarning: cb => {
    const listener = () => cb()
    ipcRenderer.on(IPC.SHIFT_INACTIVITY_WARNING, listener)
    return () => ipcRenderer.removeListener(IPC.SHIFT_INACTIVITY_WARNING, listener)
  },

  dismissInactivityWarning: () => ipcRenderer.invoke(IPC.DISMISS_INACTIVITY_WARNING),

  getProducts: () => ipcRenderer.invoke(IPC.GET_PRODUCTS),

  getAllProducts: (storeId) => ipcRenderer.invoke(IPC.GET_ALL_PRODUCTS, storeId),

  getStores: (payload?: { includeArchived?: boolean }) => ipcRenderer.invoke(IPC.GET_STORES, payload),

  createProduct: (payload) => ipcRenderer.invoke(IPC.CREATE_PRODUCT, payload),

  updateProduct: (payload) => ipcRenderer.invoke(IPC.UPDATE_PRODUCT, payload),

  setProductPrice: (payload) => ipcRenderer.invoke(IPC.SET_PRODUCT_PRICE, payload),

  setProductAvailability: (payload) => ipcRenderer.invoke(IPC.SET_PRODUCT_AVAILABILITY, payload),

  getProductPriceHistory: (payload) => ipcRenderer.invoke(IPC.GET_PRODUCT_PRICE_HISTORY, payload),

  listCatalogRevisions: (payload) => ipcRenderer.invoke(IPC.LIST_CATALOG_REVISIONS, payload),

  restoreCatalogRevision: (payload) => ipcRenderer.invoke(IPC.RESTORE_CATALOG_REVISION, payload),

  listCashiers: () => ipcRenderer.invoke(IPC.LIST_CASHIERS),
  createCashier: (payload) => ipcRenderer.invoke(IPC.CREATE_CASHIER, payload),
  updateCashier: (payload) => ipcRenderer.invoke(IPC.UPDATE_CASHIER, payload),
  toggleCashier: (payload) => ipcRenderer.invoke(IPC.TOGGLE_CASHIER, payload),
  deleteCashier: (payload) => ipcRenderer.invoke(IPC.DELETE_CASHIER, payload),

  createSale: payload => ipcRenderer.invoke(IPC.CREATE_SALE, payload),

  getShiftSales: () => ipcRenderer.invoke(IPC.GET_SHIFT_SALES),
  cancelSale: (saleId: string) => ipcRenderer.invoke(IPC.CANCEL_SALE, saleId),

  devGenerateSales: payload => ipcRenderer.invoke(IPC.DEV_GENERATE_SALES, payload),

  registerExpense: payload => ipcRenderer.invoke(IPC.REGISTER_EXPENSE, payload),

  updateExpense: payload => ipcRenderer.invoke(IPC.UPDATE_EXPENSE, payload),

  deleteExpense: id => ipcRenderer.invoke(IPC.DELETE_EXPENSE, { id }),

  getShiftExpenses: () => ipcRenderer.invoke(IPC.GET_SHIFT_EXPENSES),

  getExpenseCategories: () => ipcRenderer.invoke(IPC.GET_EXPENSE_CATEGORIES),

  getProviderDebt: payload => ipcRenderer.invoke(IPC.GET_PROVIDER_DEBT, payload),

  getProviderNames: () => ipcRenderer.invoke(IPC.GET_PROVIDER_NAMES),

  // Proveedores (Fase S1)
  listProviders: payload => ipcRenderer.invoke(IPC.LIST_PROVIDERS, payload),
  createProvider: payload => ipcRenderer.invoke(IPC.CREATE_PROVIDER, payload),
  updateProvider: payload => ipcRenderer.invoke(IPC.UPDATE_PROVIDER, payload),
  archiveProvider: payload => ipcRenderer.invoke(IPC.ARCHIVE_PROVIDER, payload),
  getProvidersWithDebt: () => ipcRenderer.invoke(IPC.GET_PROVIDERS_WITH_DEBT),
  getProviderDebtHistory: payload => ipcRenderer.invoke(IPC.GET_PROVIDER_DEBT_HISTORY, payload),
  settleProviderDebt: payload => ipcRenderer.invoke(IPC.SETTLE_PROVIDER_DEBT, payload),

  // Empleados / carniceros (Bloque D)
  listEmployees: payload => ipcRenderer.invoke(IPC.LIST_EMPLOYEES, payload),
  createEmployee: payload => ipcRenderer.invoke(IPC.CREATE_EMPLOYEE, payload),
  updateEmployee: payload => ipcRenderer.invoke(IPC.UPDATE_EMPLOYEE, payload),
  archiveEmployee: payload => ipcRenderer.invoke(IPC.ARCHIVE_EMPLOYEE, payload),
  unarchiveEmployee: payload => ipcRenderer.invoke(IPC.UNARCHIVE_EMPLOYEE, payload),

  // Asistencia (Bloque D)
  recordAttendance: payload => ipcRenderer.invoke(IPC.RECORD_ATTENDANCE, payload),
  updateAttendance: payload => ipcRenderer.invoke(IPC.UPDATE_ATTENDANCE, payload),
  listAttendance: payload => ipcRenderer.invoke(IPC.LIST_ATTENDANCE, payload),

  // Vales / adelantos (Bloque D)
  registerVale: payload => ipcRenderer.invoke(IPC.REGISTER_VALE, payload),
  listVales: payload => ipcRenderer.invoke(IPC.LIST_VALES, payload),
  getWeeklyValeSummary: payload => ipcRenderer.invoke(IPC.GET_WEEKLY_VALE_SUMMARY, payload),

  // Pago de salario semanal (Bloque D)
  payWeeklySalary: payload => ipcRenderer.invoke(IPC.PAY_WEEKLY_SALARY, payload),

  // Conteo de stock (Bloque E)
  createStockCount: payload => ipcRenderer.invoke(IPC.CREATE_STOCK_COUNT, payload),
  listStockCounts: payload => ipcRenderer.invoke(IPC.LIST_STOCK_COUNTS, payload),
  getStockCountDetail: payload => ipcRenderer.invoke(IPC.GET_STOCK_COUNT_DETAIL, payload),

  // Clientes especiales (Fase 6)
  createCustomer: payload => ipcRenderer.invoke(IPC.CREATE_CUSTOMER, payload),
  getCustomers: payload => ipcRenderer.invoke(IPC.GET_CUSTOMERS, payload),
  updateCustomer: payload => ipcRenderer.invoke(IPC.UPDATE_CUSTOMER, payload),

  // Deudas / cuenta corriente (Fase 6)
  createDebt: payload => ipcRenderer.invoke(IPC.CREATE_DEBT, payload),
  getDebts: payload => ipcRenderer.invoke(IPC.GET_DEBTS, payload),
  getCustomerBalance: payload => ipcRenderer.invoke(IPC.GET_CUSTOMER_BALANCE, payload),
  addDebtPayment: payload => ipcRenderer.invoke(IPC.ADD_DEBT_PAYMENT, payload),
  cancelDebt: payload => ipcRenderer.invoke(IPC.CANCEL_DEBT, payload),

  // Clientes especiales (Fase 6 addendum — separados de fiados, solo admins editan)
  listSpecialCustomers: payload => ipcRenderer.invoke(IPC.LIST_SPECIAL_CUSTOMERS, payload),
  createSpecialCustomer: payload => ipcRenderer.invoke(IPC.CREATE_SPECIAL_CUSTOMER, payload),
  updateSpecialCustomer: payload => ipcRenderer.invoke(IPC.UPDATE_SPECIAL_CUSTOMER, payload),
  deleteSpecialCustomer: payload => ipcRenderer.invoke(IPC.DELETE_SPECIAL_CUSTOMER, payload),
  getSpecialCustomerPrices: payload => ipcRenderer.invoke(IPC.GET_SPECIAL_CUSTOMER_PRICES, payload),
  setSpecialCustomerPrice: payload => ipcRenderer.invoke(IPC.SET_SPECIAL_CUSTOMER_PRICE, payload),
  deleteSpecialCustomerPrice: payload => ipcRenderer.invoke(IPC.DELETE_SPECIAL_CUSTOMER_PRICE, payload),

  // Gestión de locales (multi-local)
  selectStore: payload => ipcRenderer.invoke(IPC.SELECT_STORE, payload),
  createStore: payload => ipcRenderer.invoke(IPC.CREATE_STORE, payload),
  updateStore: payload => ipcRenderer.invoke(IPC.UPDATE_STORE, payload),
  deleteStore: payload => ipcRenderer.invoke(IPC.DELETE_STORE, payload),
  archiveStore: payload => ipcRenderer.invoke(IPC.ARCHIVE_STORE, payload),
  unarchiveStore: payload => ipcRenderer.invoke(IPC.UNARCHIVE_STORE, payload),

  // Pedidos (Fase 7)
  createOrder: payload => ipcRenderer.invoke(IPC.CREATE_ORDER, payload),
  listOrders: payload => ipcRenderer.invoke(IPC.LIST_ORDERS, payload),
  updateOrderStatus: payload => ipcRenderer.invoke(IPC.UPDATE_ORDER_STATUS, payload),
  updateOrder: payload => ipcRenderer.invoke(IPC.UPDATE_ORDER, payload),
  deleteOrder: payload => ipcRenderer.invoke(IPC.DELETE_ORDER, payload),
  hardDeleteOrder: payload => ipcRenderer.invoke(IPC.HARD_DELETE_ORDER, payload),

  // Historial completo (Fase 7 — solo admin)
  getHistoryShifts: payload => ipcRenderer.invoke(IPC.GET_HISTORY_SHIFTS, payload),
  getHistoryShiftDetail: payload => ipcRenderer.invoke(IPC.GET_HISTORY_SHIFT_DETAIL, payload),
  getRemoteEmployeeVales: payload => ipcRenderer.invoke(IPC.GET_REMOTE_EMPLOYEE_VALES, payload),

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

  // Preferencias de UI
  getUiSettings: () => ipcRenderer.invoke(IPC.GET_UI_SETTINGS),
  setUiSettings: (payload) => ipcRenderer.invoke(IPC.SET_UI_SETTINGS, payload),
}

contextBridge.exposeInMainWorld('hw', hw)
