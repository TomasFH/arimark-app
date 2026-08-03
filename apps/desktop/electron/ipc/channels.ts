/**
 * Constantes de canales IPC.
 * Centralizar aquí previene typos y facilita auditoría.
 */
export const IPC = {
  // App info
  GET_APP_INFO: 'ipc:get-app-info',
  GET_INIT_STATUS: 'ipc:get-init-status',

  // Hardware status
  GET_HARDWARE_STATUS: 'ipc:get-hardware-status',
  HARDWARE_STATUS_CHANGE: 'ipc:hardware-status-change',  // push main → renderer

  // Configuración de hardware
  GET_HARDWARE_CONFIG: 'ipc:get-hardware-config',
  SET_HARDWARE_CONFIG: 'ipc:set-hardware-config',
  KRETZ_DETECT_PORT: 'ipc:kretz-detect-port',

  // Turnos
  GET_ACTIVE_SHIFT: 'ipc:get-active-shift',
  GET_STORE_OPEN_SHIFT: 'ipc:get-store-open-shift',
  GET_USER_OPEN_SHIFT: 'ipc:get-user-open-shift',
  OPEN_SHIFT: 'ipc:open-shift',
  GET_SHIFT_SUMMARY: 'ipc:get-shift-summary',
  CLOSE_SHIFT: 'ipc:close-shift',
  SHIFT_INACTIVITY_WARNING: 'ipc:shift-inactivity-warning',   // push main → renderer
  DISMISS_INACTIVITY_WARNING: 'ipc:dismiss-inactivity-warning',

  // Productos (catálogo local)
  GET_PRODUCTS: 'ipc:get-products',

  // Catálogo admin — CRUD de productos y precios (solo admins)
  GET_ALL_PRODUCTS: 'ipc:get-all-products',
  CREATE_PRODUCT: 'ipc:create-product',
  UPDATE_PRODUCT: 'ipc:update-product',
  SET_PRODUCT_PRICE: 'ipc:set-product-price',
  SET_PRODUCT_AVAILABILITY: 'ipc:set-product-availability',
  GET_STORES: 'ipc:get-stores',
  GET_PRODUCT_PRICE_HISTORY: 'ipc:get-product-price-history',

  // ABM de cajeras (solo admins)
  LIST_CASHIERS: 'ipc:list-cashiers',
  CREATE_CASHIER: 'ipc:create-cashier',
  TOGGLE_CASHIER: 'ipc:toggle-cashier',
  DELETE_CASHIER: 'ipc:delete-cashier',

  // Ventas (POS)
  CREATE_SALE: 'ipc:create-sale',
  GET_SHIFT_SALES: 'ipc:get-shift-sales',
  CANCEL_SALE: 'ipc:cancel-sale',

  // Herramientas de desarrollo (solo APP_ENV=dev)
  DEV_GENERATE_SALES: 'ipc:dev-generate-sales',

  // Gastos del turno
  REGISTER_EXPENSE: 'ipc:register-expense',
  UPDATE_EXPENSE: 'ipc:update-expense',
  DELETE_EXPENSE: 'ipc:delete-expense',
  GET_SHIFT_EXPENSES: 'ipc:get-shift-expenses',
  GET_EXPENSE_CATEGORIES: 'ipc:get-expense-categories',

  // Clientes de fiados (Fase 6 — creados durante el flujo de deuda)
  CREATE_CUSTOMER: 'ipc:create-customer',
  GET_CUSTOMERS: 'ipc:get-customers',
  UPDATE_CUSTOMER: 'ipc:update-customer',

  // Deudas / cuenta corriente (Fase 6)
  CREATE_DEBT: 'ipc:create-debt',
  GET_DEBTS: 'ipc:get-debts',
  GET_CUSTOMER_BALANCE: 'ipc:get-customer-balance',
  ADD_DEBT_PAYMENT: 'ipc:add-debt-payment',
  CANCEL_DEBT: 'ipc:cancel-debt',

  // Clientes especiales (Fase 6 addendum — gestionados por admins, informativos)
  LIST_SPECIAL_CUSTOMERS: 'ipc:list-special-customers',
  CREATE_SPECIAL_CUSTOMER: 'ipc:create-special-customer',
  UPDATE_SPECIAL_CUSTOMER: 'ipc:update-special-customer',
  DELETE_SPECIAL_CUSTOMER: 'ipc:delete-special-customer',
  GET_SPECIAL_CUSTOMER_PRICES: 'ipc:get-special-customer-prices',
  SET_SPECIAL_CUSTOMER_PRICE: 'ipc:set-special-customer-price',
  DELETE_SPECIAL_CUSTOMER_PRICE: 'ipc:delete-special-customer-price',

  // Pedidos (Fase 7)
  CREATE_ORDER: 'ipc:create-order',
  LIST_ORDERS: 'ipc:list-orders',
  UPDATE_ORDER_STATUS: 'ipc:update-order-status',
  UPDATE_ORDER: 'ipc:update-order',
  DELETE_ORDER: 'ipc:delete-order',
  HARD_DELETE_ORDER: 'ipc:hard-delete-order',

  // Gastos del turno — deuda a proveedores
  GET_PROVIDER_DEBT: 'ipc:get-provider-debt',
  GET_PROVIDER_NAMES: 'ipc:get-provider-names',

  // Proveedores (entidades globales sincronizadas — Fase S1)
  LIST_PROVIDERS: 'ipc:list-providers',
  CREATE_PROVIDER: 'ipc:create-provider',
  UPDATE_PROVIDER: 'ipc:update-provider',
  ARCHIVE_PROVIDER: 'ipc:archive-provider',
  GET_PROVIDERS_WITH_DEBT: 'ipc:get-providers-with-debt',
  GET_PROVIDER_DEBT_HISTORY: 'ipc:get-provider-debt-history',
  SETTLE_PROVIDER_DEBT: 'ipc:settle-provider-debt',

  // Empleados / carniceros (Bloque D)
  LIST_EMPLOYEES: 'ipc:list-employees',
  CREATE_EMPLOYEE: 'ipc:create-employee',
  UPDATE_EMPLOYEE: 'ipc:update-employee',
  ARCHIVE_EMPLOYEE: 'ipc:archive-employee',
  UNARCHIVE_EMPLOYEE: 'ipc:unarchive-employee',

  // Asistencia (Bloque D)
  RECORD_ATTENDANCE: 'ipc:record-attendance',
  UPDATE_ATTENDANCE: 'ipc:update-attendance',
  LIST_ATTENDANCE: 'ipc:list-attendance',

  // Vales / adelantos (Bloque D)
  REGISTER_VALE: 'ipc:register-vale',
  LIST_VALES: 'ipc:list-vales',
  GET_WEEKLY_VALE_SUMMARY: 'ipc:get-weekly-vale-summary',

  // Pago de salario semanal (Bloque D)
  PAY_WEEKLY_SALARY: 'ipc:pay-weekly-salary',

  // Conteo de stock (Bloque E)
  CREATE_STOCK_COUNT: 'ipc:create-stock-count',
  LIST_STOCK_COUNTS: 'ipc:list-stock-counts',
  GET_STOCK_COUNT_DETAIL: 'ipc:get-stock-count-detail',

  // Historial completo (Fase 7 — solo admin)
  GET_HISTORY_SHIFTS: 'ipc:get-history-shifts',
  GET_HISTORY_SHIFT_DETAIL: 'ipc:get-history-shift-detail',

  // Gestión de locales (multi-local)
  SELECT_STORE: 'ipc:select-store',
  CREATE_STORE: 'ipc:create-store',
  UPDATE_STORE: 'ipc:update-store',
  DELETE_STORE: 'ipc:delete-store',
  ARCHIVE_STORE: 'ipc:archive-store',
  UNARCHIVE_STORE: 'ipc:unarchive-store',

  // Auth / licencias
  ACTIVATE_INSTALLATION: 'ipc:activate-installation',
  LOGIN: 'ipc:login',
  LOGIN_CASHIER: 'ipc:login-cashier',
  LOGIN_ADMIN: 'ipc:login-admin',
  LOGOUT: 'ipc:logout',

  /** Re-sincroniza stores/empleados/catálogo desde Firestore sin cerrar sesión. */
  REFRESH_REMOTE_DATA: 'ipc:refresh-remote-data',


  // Gestión de PLUs (balanza KRETZ)
  KRETZ_TEST_LINK: 'ipc:kretz-test-link',
  KRETZ_SEND_PLU: 'ipc:kretz-send-plu',
  KRETZ_DELETE_PLU: 'ipc:kretz-delete-plu',
  KRETZ_READ_PLU: 'ipc:kretz-read-plu',
  KRETZ_READ_PLU_COUNT: 'ipc:kretz-read-plu-count',

  // Carga masiva del catálogo a la balanza (solo admin, balanza conectada)
  KRETZ_SYNC_CATALOG: 'ipc:kretz-sync-catalog',
  KRETZ_SYNC_PROGRESS: 'ipc:kretz-sync-progress',  // push main → renderer
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
