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

  // Productos (catálogo local)
  GET_PRODUCTS: 'ipc:get-products',

  // Ventas (POS)
  CREATE_SALE: 'ipc:create-sale',

  // Auth / licencias
  ACTIVATE_INSTALLATION: 'ipc:activate-installation',
  LOGIN_CASHIER: 'ipc:login-cashier',
  LOGIN_ADMIN: 'ipc:login-admin',
  LOGOUT: 'ipc:logout',


  // Gestión de PLUs (balanza KRETZ)
  KRETZ_TEST_LINK: 'ipc:kretz-test-link',
  KRETZ_SEND_PLU: 'ipc:kretz-send-plu',
  KRETZ_DELETE_PLU: 'ipc:kretz-delete-plu',
  KRETZ_READ_PLU: 'ipc:kretz-read-plu',
  KRETZ_READ_PLU_COUNT: 'ipc:kretz-read-plu-count',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
