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
// Turnos
// ---------------------------------------------------------------------------
export type ShiftType = 'morning' | 'evening'

export interface ShiftInfo {
  id: string
  storeId: string
  userId: string
  shiftType: ShiftType
  startedAt: string
  openingCash: number
}

export interface OpenShiftPayload {
  shiftType: ShiftType
  openingCash: number
}

// ---------------------------------------------------------------------------
// Hardware — pedidos de balanza
// Un pedido = todos los productos de un cliente en un canal dado,
// cerrado cuando el carnicero imprime el ticket físico.
// ---------------------------------------------------------------------------

export type ScaleChannel = 'A' | 'B' | 'C' | 'D'

/** Un producto dentro de un pedido de balanza */
export interface ScaleOrderItem {
  productCode: string
  /** ID del producto en la DB (undefined si no se encontró por barcode) */
  productId?: string
  /** Nombre del producto para mostrar en UI */
  productName?: string
  weightKg: number
  unitPrice: number
  subtotal: number
}

/** Pedido completo emitido por el hardware al imprimir el ticket físico */
export interface ScaleOrder {
  /** ID en la DB (undefined si no había turno activo al recibir el pedido) */
  id?: string
  /** Canal de la balanza que generó este pedido */
  channel: ScaleChannel
  items: ScaleOrderItem[]
  total: number
  timestamp: string
}

/** Sandbox/dev: payload para inyectar un pedido completo manualmente */
export interface InjectMockOrderPayload {
  channel: ScaleChannel
  items: Array<{
    productCode: string
    weightKg: number
    unitPrice: number
  }>
}

// ---------------------------------------------------------------------------
// Ventas (POS)
// ---------------------------------------------------------------------------
export interface SaleItemPayload {
  productId: string
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface SalePaymentPayload {
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit'
  amount: number
}

export interface CreateSalePayload {
  items: SaleItemPayload[]
  payments: SalePaymentPayload[]
  /** ID del pedido de balanza que origina esta venta (null si es entrada manual) */
  scaleOrderId?: string
  customerId?: string
  isDebt?: boolean
  /** Venta ingresada manualmente (sin pedido de balanza). Requiere aprobación admin en producción. */
  manualEntry?: boolean
  notes?: string
}

export interface SaleResult {
  saleId: string
  total: number
  fiscalReceiptIssued: boolean
  receiptNumbers: string[]
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

  /** Registra callback para pedidos completos de la balanza KRETZ. Retorna función para desuscribirse. */
  onScaleOrder: (cb: (order: ScaleOrder) => void) => () => void

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

  /** Retorna el turno activo del local (null si no hay ninguno abierto) */
  getActiveShift: () => Promise<IpcResult<ShiftInfo | null>>

  /** Abre un nuevo turno para la cajera autenticada */
  openShift: (payload: OpenShiftPayload) => Promise<IpcResult<ShiftInfo>>

  /** Crea una venta (ítems + pagos) de forma atómica */
  createSale: (payload: CreateSalePayload) => Promise<IpcResult<SaleResult>>

  /** Sandbox/dev: inyecta un pedido completo de balanza (mock KRETZ) */
  injectMockOrder: (payload: InjectMockOrderPayload) => Promise<IpcResult>
}

declare global {
  interface Window {
    hw: HwApi
  }
}
