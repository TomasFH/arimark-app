/**
 * Constantes de canales IPC.
 * Centralizar aquí previene typos y facilita auditoría.
 */
export const IPC = {
  GET_APP_INFO: 'ipc:get-app-info',
  GET_HARDWARE_STATUS: 'ipc:get-hardware-status',
  HARDWARE_STATUS_CHANGE: 'ipc:hardware-status-change',
  ACTIVATE_INSTALLATION: 'ipc:activate-installation',
  LOGIN_CASHIER: 'ipc:login-cashier',
  LOGIN_ADMIN: 'ipc:login-admin',
  LOGOUT: 'ipc:logout',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
