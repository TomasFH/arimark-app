/**
 * API tipada expuesta al renderer via window.hw (preload).
 * El renderer NUNCA accede a hardware, Firebase ni red directamente.
 * Todo pasa por este contrato.
 */

export type AppEnv = 'sandbox' | 'production'

export interface HardwareStatus {
  scale: 'connected' | 'disconnected' | 'error'
  fiscal: 'connected' | 'disconnected' | 'error'
}

export interface IpcResponse<T = void> {
  ok: true
  data: T
}

export interface IpcError {
  ok: false
  error: string
  code?: string
}

export type IpcResult<T = void> = IpcResponse<T> | IpcError

// ---------------------------------------------------------------------------
// App info
// ---------------------------------------------------------------------------
export interface AppInfo {
  version: string
  env: AppEnv
}

// ---------------------------------------------------------------------------
// Init status — resultado del arranque del proceso main
// ---------------------------------------------------------------------------
export interface InitStatus {
  businessName: string
  defaultStoreId: string
  licenseKey: string
  licenseValid: boolean
  licenseReason?: 'inactive' | 'expired' | 'offline_timeout' | 'not_found' | 'error'
  licenseMessage?: string
  needsActivation: boolean
}

// ---------------------------------------------------------------------------
// Auth / licensing
// ---------------------------------------------------------------------------
export interface ActivateInstallationPayload {
  licenseKey: string
  activationCode: string
}

export interface CashierLoginPayload {
  username: string
  password: string
  storeId: string
}

export interface AdminLoginPayload {
  email: string
  password: string
}

export interface SessionInfo {
  role: 'cashier' | 'admin'
  userId: string
  storeId?: string
  expiresAt: string
}

// ---------------------------------------------------------------------------
// Hardware — tickets de balanza
// ---------------------------------------------------------------------------
export interface ScaleTicketData {
  weightKg: number
  productCode: string
  unitPrice: number
  subtotal: number
  timestamp: string
}

// ---------------------------------------------------------------------------
// Hardware — pagos fiscales (SAM4S)
// ---------------------------------------------------------------------------
export type PaymentMethod = 'debit' | 'wallet' | 'credit'

export interface FiscalPaymentPayload {
  amount: number
  paymentMethod: PaymentMethod
  referenceId: string
}

export interface FiscalPaymentResult {
  ok: boolean
  receiptNumber?: string
  error?: string
}

export interface CashReceiptPayload {
  amount: number
  referenceId: string
}

// ---------------------------------------------------------------------------
// Hardware — configuración de periféricos
// ---------------------------------------------------------------------------
export interface HardwareConfig {
  /** Puerto serial de la balanza KRETZ, ej. "COM3" */
  kretzPort?: string
  /** IP de la caja SAM4S, ej. "192.168.1.1" */
  sam4sIp?: string
  /** Usuario HTTP Basic Auth de la SAM4S */
  sam4sUser?: string
}

export interface SetHardwareConfigPayload extends HardwareConfig {
  /** Contraseña HTTP Basic Auth de la SAM4S (solo se escribe, nunca se lee de vuelta) */
  sam4sPassword?: string
}

// ---------------------------------------------------------------------------
// API pública expuesta al renderer
// ---------------------------------------------------------------------------
export interface HwApi {
  /** Retorna el entorno de la app y versión */
  getAppInfo: () => Promise<IpcResult<AppInfo>>

  /** Retorna el estado de inicialización (licencia, activación, config del negocio) */
  getInitStatus: () => Promise<IpcResult<InitStatus>>

  /** Estado actual de los periféricos */
  getHardwareStatus: () => Promise<IpcResult<HardwareStatus>>

  /** Registra callback cuando cambia el estado del hardware */
  onHardwareStatusChange: (cb: (status: HardwareStatus) => void) => () => void

  /** Registra callback para tickets de la balanza KRETZ. Retorna función para desuscribirse. */
  onScaleTicket: (cb: (ticket: ScaleTicketData) => void) => () => void

  /** Procesa un pago en la caja registradora SAM4S */
  processFiscalPayment: (payload: FiscalPaymentPayload) => Promise<IpcResult<FiscalPaymentResult>>

  /** Emite comprobante en efectivo en la SAM4S */
  issueCashReceipt: (payload: CashReceiptPayload) => Promise<IpcResult<FiscalPaymentResult>>

  /** Retorna la configuración de hardware guardada (sin contraseñas) */
  getHardwareConfig: () => Promise<IpcResult<HardwareConfig>>

  /** Guarda la configuración de hardware */
  setHardwareConfig: (payload: SetHardwareConfigPayload) => Promise<IpcResult>

  /** Activa la instalación con un código de un solo uso */
  activateInstallation: (payload: ActivateInstallationPayload) => Promise<IpcResult>

  /** Login de cajera (local, bcryptjs) */
  loginCashier: (payload: CashierLoginPayload) => Promise<IpcResult<SessionInfo>>

  /** Login de admin (Firebase Auth) */
  loginAdmin: (payload: AdminLoginPayload) => Promise<IpcResult<SessionInfo>>

  /** Cierra la sesión activa */
  logout: (payload: { role: 'cashier' | 'admin'; storeId?: string }) => Promise<IpcResult>
}

declare global {
  interface Window {
    hw: HwApi
  }
}
