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

  // Balanza KRETZ — push main → renderer (sin handler, solo canal de eventos)
  // Emite un ScaleOrder completo al cerrar un pedido (canal del carnicero)
  SCALE_ORDER: 'ipc:scale-order',

  /** Sandbox/dev: inyectar un pedido completo en la cola de balanza */
  INJECT_MOCK_ORDER: 'ipc:inject-mock-order',

  // Caja SAM4S
  PROCESS_FISCAL_PAYMENT: 'ipc:process-fiscal-payment',
  ISSUE_CASH_RECEIPT: 'ipc:issue-cash-receipt',

  // Configuración de hardware (port, IP, credenciales)
  GET_HARDWARE_CONFIG: 'ipc:get-hardware-config',
  SET_HARDWARE_CONFIG: 'ipc:set-hardware-config',

  // Turnos
  GET_ACTIVE_SHIFT: 'ipc:get-active-shift',
  OPEN_SHIFT: 'ipc:open-shift',

  // Ventas (POS)
  CREATE_SALE: 'ipc:create-sale',

  // Auth / licencias
  ACTIVATE_INSTALLATION: 'ipc:activate-installation',
  LOGIN_CASHIER: 'ipc:login-cashier',
  LOGIN_ADMIN: 'ipc:login-admin',
  LOGOUT: 'ipc:logout',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
