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

  // Turnos
  GET_ACTIVE_SHIFT: 'ipc:get-active-shift',
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

  // Gastos del turno
  REGISTER_EXPENSE: 'ipc:register-expense',
  GET_SHIFT_EXPENSES: 'ipc:get-shift-expenses',
  GET_EXPENSE_CATEGORIES: 'ipc:get-expense-categories',

  // Auth / licencias
  ACTIVATE_INSTALLATION: 'ipc:activate-installation',
  LOGIN: 'ipc:login',
  LOGIN_CASHIER: 'ipc:login-cashier',
  LOGIN_ADMIN: 'ipc:login-admin',
  LOGOUT: 'ipc:logout',


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
