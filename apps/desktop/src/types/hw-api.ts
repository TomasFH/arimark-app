/**
 * API tipada expuesta al renderer via window.hw (preload).
 * El renderer NUNCA accede a hardware, Firebase ni red directamente.
 * Todo pasa por este contrato.
 */

export type AppEnv = 'dev' | 'production'

export interface HardwareStatus {
  scale: 'connected' | 'disconnected' | 'error'
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

export interface LoginPayload {
  email: string
  password: string
}

export interface CashierLoginPayload {
  email: string
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
// Cierre de turno
// ---------------------------------------------------------------------------
export interface ShiftSummary {
  shiftId: string
  shiftType: ShiftType
  startedAt: string
  openingCash: number
  salesCount: number
  totalRevenue: number
  /** Total cobrado en efectivo durante el turno */
  totalCashSales: number
  /** Total cobrado con débito durante el turno */
  totalDebitSales: number
  /** Total cobrado con billetera virtual durante el turno */
  totalWalletSales: number
  /** Total cobrado con crédito durante el turno */
  totalCreditSales: number
  /** Total gastado en efectivo durante el turno */
  totalExpenses: number
  /**
   * Efectivo estimado en caja = apertura + ventas en efectivo - gastos en efectivo.
   * No incluye el efectivo declarado al cerrar.
   */
  cashInHand: number
  /** Cantidad de fiados registrados en este turno */
  debtsCount: number
  /** Monto total de fiados del turno */
  totalDebts: number
  /** Señas cobradas en efectivo en este turno */
  totalCashDeposits: number
  /** Señas cobradas con débito en este turno */
  totalDebitDeposits: number
  /** Señas cobradas con billetera virtual en este turno */
  totalWalletDeposits: number
  /** Señas cobradas con crédito en este turno */
  totalCreditDeposits: number
  /** Total de señas digitales (debit + wallet + credit) */
  totalDigitalDeposits: number
  /** Cantidad de pedidos con seña en este turno */
  depositsCount: number
}

export interface CloseShiftPayload {
  /** Efectivo en caja al cerrar. Opcional en cierre automático por inactividad. */
  closingCash?: number
  safeAmount?: number
  deliveredAmount?: number
  deliveredTo?: string
  notes?: string
  /** Conteo de billetes al cerrar (denominación → cantidad) */
  billDenominations?: Array<{ denomination: number; quantity: number }>
}

// ---------------------------------------------------------------------------
// Gastos del turno
// ---------------------------------------------------------------------------
export interface ExpenseRow {
  id: string
  category: string
  provider: string | null
  amount: number
  notes: string | null
  createdAt: string
  createdBy: string
}

// ---------------------------------------------------------------------------
// Ítems de venta — se arman en la PC escaneando los códigos de barras del
// ticket físico (o por entrada manual de emergencia). Cada código = 1 ítem.
// La balanza NO envía pedidos a la PC (ver PLAN.md → Modelo de flujo de datos).
// ---------------------------------------------------------------------------

/** Un ítem agregado a la venta en curso al escanear un código o ingresarlo a mano. */
export interface SaleItemDraft {
  /** Número de PLU del producto en la balanza. */
  pluNumber: number
  /** ID del producto en la DB (null si el PLU no está mapeado). */
  productId: string | null
  /** Nombre del producto para mostrar en UI. */
  productName: string
  /** Unidad del producto según el catálogo. */
  unit: 'kg' | 'unit'
  /**
   * Para productos por kg: peso en kg (calculado como total / precio_por_kg del catálogo).
   * Para productos por unidad: cantidad (calculada como total / precio_por_unidad).
   * Si el PLU no está en el catálogo o no tiene precio, valor = 1.
   */
  weightKg: number
  /** Precio por kg o por unidad según el catálogo. */
  unitPrice: number
  /** Precio total cobrado al cliente (siempre igual al total del código de barras). */
  subtotal: number
  /** true si el ítem se ingresó manualmente (PLU + precio), no por escaneo. */
  manualEntry: boolean
  /**
   * true si el precio total del código de barras no coincide con lo esperado según
   * el catálogo (solo detectable en productos por unidad, donde la cantidad debe ser entera).
   * Indica que el precio en la balanza difiere del precio registrado en la app.
   */
  priceDiscrepancy?: boolean
}

// ---------------------------------------------------------------------------
// Productos (catálogo local)
// ---------------------------------------------------------------------------
export interface ProductRow {
  id: string
  name: string
  category: 'beef_cut' | 'poultry' | 'pork' | 'other'
  unit: 'kg' | 'unit'
  pluNumber: number
  /** Precio vigente en el local ($/kg o $/unidad). null si no hay precio cargado. */
  price: number | null
}

// ---------------------------------------------------------------------------
// Catálogo admin — gestión de productos y precios
// ---------------------------------------------------------------------------

/** Producto completo para el panel admin (incluye productos sin PLU y estado activo). */
export interface AdminProductRow {
  id: string
  name: string
  category: 'beef_cut' | 'poultry' | 'pork' | 'other'
  unit: 'kg' | 'unit'
  pluNumber: number | null
  active: boolean
  /** Precio vigente en el local seleccionado. null si no hay precio cargado. */
  price: number | null
  /** Disponibilidad en el local seleccionado (de store_products). */
  available: boolean
}

export interface StoreRow {
  id: string
  name: string
  address?: string | null
}

export interface CreateProductPayload {
  name: string
  category: 'beef_cut' | 'poultry' | 'pork' | 'other'
  unit: 'kg' | 'unit'
  pluNumber: number | null
}

export interface UpdateProductPayload {
  id: string
  name?: string
  category?: 'beef_cut' | 'poultry' | 'pork' | 'other'
  unit?: 'kg' | 'unit'
  pluNumber?: number | null
  active?: boolean
}

export interface SetProductPricePayload {
  productId: string
  storeId: string
  /** Nuevo precio en pesos (entero). 0 = sin precio (elimina el precio vigente). */
  price: number
}

export interface SetProductAvailabilityPayload {
  productId: string
  storeId: string
  available: boolean
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
  customerId?: string
  isDebt?: boolean
  /** Venta ingresada manualmente (sin pedido de balanza). Requiere aprobación admin en producción. */
  manualEntry?: boolean
  notes?: string
}

export interface SaleResult {
  saleId: string
  total: number
}

// ---------------------------------------------------------------------------
// Listado de ventas del turno (vista en vivo tipo cuaderno)
// ---------------------------------------------------------------------------
export interface ShiftSaleItem {
  productName: string
  quantity: number
  unit: 'kg' | 'unit'
  unitPrice: number
  subtotal: number
}

export interface ShiftSaleRow {
  id: string
  createdAt: string
  total: number
  /** Estado de la venta: 'confirmed' | 'cancelled' */
  status: 'confirmed' | 'cancelled'
  /** Parte del total cobrada en efectivo (0 si fue 100% digital). */
  cashAmount: number
  /** Parte del total cobrada con medios digitales (débito/wallet/crédito). */
  digitalAmount: number
  /** Medios de pago usados en la venta (para el badge). */
  paymentMethods: Array<'cash' | 'debit' | 'wallet' | 'credit'>
  manualEntry: boolean
  items: ShiftSaleItem[]
}

/** Payload dev-only para generar ventas ficticias de prueba. */
export interface DevGenerateSalesPayload {
  count: number
}

// ---------------------------------------------------------------------------
// Gestión de PLUs (balanza KRETZ)
// ---------------------------------------------------------------------------

export type PluType = 'pesable' | 'normal'

export interface PluRow {
  number: string
  name: string
  code: string
  price: string
  type: PluType
}

export interface SendPluPayload {
  pluNumber: string
  department?: string
  family?: string
  name: string
  description?: string
  articleCode?: string
  pesable: boolean
  /** Precio raw REPORT NX/iTegra (pesos × 10). Ej: $21.000/kg → 210000 */
  priceCents: number
  priceDigits?: 6 | 7
}

export interface ReadPluPayload {
  pluNumber: string
  priceDigits?: 6 | 7
}

export interface DeletePluPayload {
  pluNumber: string
}

// ---------------------------------------------------------------------------
// Historial de precios (auditoría)
// ---------------------------------------------------------------------------

export interface PriceHistoryRow {
  id: string
  price: number
  validFrom: string
  validTo: string | null
  createdBy: string
}

export interface GetPriceHistoryPayload {
  productId: string
  storeId: string
}

// ---------------------------------------------------------------------------
// ABM de cajeras
// ---------------------------------------------------------------------------

export interface CashierRow {
  uid: string
  displayName: string
  email: string
  authorizedStores: string[]
  active: boolean
}

export interface CreateCashierPayload {
  displayName: string
  email: string
  authorizedStores: string[]
}

export interface ToggleCashierPayload {
  uid: string
  active: boolean
}

export interface DeleteCashierPayload {
  uid: string
}

// ---------------------------------------------------------------------------
// Clientes especiales y deudas (Fase 6)
// ---------------------------------------------------------------------------

export interface CustomerRow {
  id: string
  storeId: string
  name: string
  dni: string | null
  phone: string | null
  type: 'restaurant' | 'wholesale' | 'other' | null
  notes: string | null
  active: boolean
  createdAt: string
}

export interface CreateCustomerPayload {
  name: string
  dni?: string
  phone?: string
  type?: 'restaurant' | 'wholesale' | 'other'
  notes?: string
}

export interface UpdateCustomerPayload {
  id: string
  name?: string
  dni?: string
  phone?: string
  type?: 'restaurant' | 'wholesale' | 'other'
  notes?: string
  active?: boolean
}

export interface GetCustomersPayload {
  search?: string
  activeOnly?: boolean
}

export interface DebtEventRow {
  id: string
  customerId: string
  customerName: string
  saleId: string | null
  storeId: string
  eventType: 'created' | 'partial_payment' | 'paid' | 'cancelled' | 'reopened'
  amount: number
  dueDate: string | null
  notes: string | null
  createdAt: string
  createdBy: string
}

export interface CustomerDebtSummary {
  customerId: string
  customerName: string
  customerDni: string | null
  customerPhone: string | null
  /** Saldo algebraico. >0 = debe; ≤0 = saldado/sin deuda. */
  balance: number
  lastEventAt: string
  events: DebtEventRow[]
}

export interface CreateDebtPayload {
  saleId: string
  customerId?: string
  newCustomer?: { name: string; phone?: string }
  /** Monto que el cliente pagó al momento del fiado. La deuda = total − initialPayment. */
  initialPayment?: number
  dueDate?: string
  notes?: string
}

export interface AddDebtPaymentPayload {
  customerId: string
  amount: number
  notes?: string
}

export interface CancelDebtPayload {
  customerId: string
  saleId?: string
  notes?: string
}

// ---------------------------------------------------------------------------
// Clientes especiales (Fase 6 addendum)
// ---------------------------------------------------------------------------

export interface SpecialCustomerRow {
  id: string
  storeId: string
  name: string
  notes: string | null
  createdAt: string
  updatedAt: string | null
}

export interface SpecialCustomerPriceRow {
  id: string
  specialCustomerId: string
  productId: string
  productName: string
  originalPrice: number | null
  specialPrice: number
  notes: string | null
  updatedAt: string
  updatedBy: string
}

export interface CreateSpecialCustomerPayload {
  name: string
  notes?: string
}

export interface UpdateSpecialCustomerPayload {
  id: string
  name?: string
  notes?: string
}

export interface SetSpecialCustomerPricePayload {
  specialCustomerId: string
  productId: string
  price: number
  notes?: string
}

// ---------------------------------------------------------------------------
// Pedidos (Fase 7)
// ---------------------------------------------------------------------------

export type OrderStatus = 'pending' | 'ready' | 'delivered' | 'cancelled'
export type DepositMethod = 'cash' | 'debit' | 'wallet' | 'credit'
export type OrderTimeSlot = 'morning' | 'afternoon' | 'specific'

export interface DepositPayment {
  method: DepositMethod
  amount: number
}

export interface OrderRow {
  id: string
  storeId: string
  customerName: string
  phone: string | null
  items: string
  pickupDate: string
  timeSlot: OrderTimeSlot | null
  pickupTime: string | null
  priority: boolean
  status: OrderStatus
  notes: string | null
  depositAmount: number
  /** Desglose de medios de pago de la seña. Reemplaza depositMethod para nuevos pedidos. */
  depositPayments: DepositPayment[] | null
  /** Legado: medio único (puede existir en pedidos pre-migración) */
  depositMethod: DepositMethod | null
  createdAt: string
  createdBy: string
  updatedAt: string | null
  updatedBy: string | null
}

export interface CreateOrderPayload {
  customerName: string
  phone?: string
  items: string
  pickupDate: string
  timeSlot?: OrderTimeSlot
  pickupTime?: string
  priority?: boolean
  notes?: string
  depositAmount?: number
  depositPayments?: DepositPayment[]
}

export interface UpdateOrderStatusPayload {
  id: string
  status: OrderStatus
}

export interface UpdateOrderPayload {
  id: string
  customerName?: string
  phone?: string
  items?: string
  pickupDate?: string
  timeSlot?: OrderTimeSlot | null
  pickupTime?: string | null
  priority?: boolean
  notes?: string | null
  depositAmount?: number
  depositPayments?: DepositPayment[] | null
}

export interface ListOrdersPayload {
  status?: OrderStatus
  fromDate?: string
  toDate?: string
}

// ---------------------------------------------------------------------------
// Deuda a proveedores
// ---------------------------------------------------------------------------

export interface ProviderDebtRow {
  provider: string
  /** Saldo pendiente (positivo = deben pagarle; 0 = sin deuda) */
  balance: number
  lastEventAt: string
}

export interface RegisterExpensePayload {
  category: string
  amount: number
  notes?: string
  provider?: string
  /** Monto que NO se pagó ahora y queda como deuda para la próxima visita */
  newDebtAmount?: number
  /** Monto de deuda anterior que se paga en este gasto */
  paysOldDebt?: number
}

// ---------------------------------------------------------------------------
// Historial completo (Fase 7 — solo admin)
// ---------------------------------------------------------------------------

export interface HistoryShiftRow {
  id: string
  shiftType: ShiftType
  startedAt: string
  closedAt: string
  cashierName: string
  salesCount: number
  totalRevenue: number
  totalCashSales: number
  totalExpenses: number
  cashInHand: number
  totalDeposits: number
}

export interface HistorySaleItem {
  productName: string
  quantity: number
  unit: 'kg' | 'unit'
  unitPrice: number
  subtotal: number
}

export interface HistorySaleRow {
  id: string
  createdAt: string
  total: number
  status: 'confirmed' | 'cancelled'
  cashAmount: number
  digitalAmount: number
  paymentMethods: Array<'cash' | 'debit' | 'wallet' | 'credit'>
  manualEntry: boolean
  isDebt: boolean
  customerName: string | null
  items: HistorySaleItem[]
}

export interface HistoryExpenseRow {
  id: string
  createdAt: string
  category: string
  amount: number
  notes: string | null
  createdBy: string
}

export interface HistoryDebtRow {
  id: string
  createdAt: string
  customerName: string
  amount: number
  eventType: 'created' | 'partial_payment' | 'paid' | 'cancelled' | 'reopened'
  notes: string | null
}

export interface HistoryOrderRow {
  id: string
  customerName: string
  phone: string | null
  items: string
  depositAmount: number
  depositPayments: DepositPayment[] | null
  depositMethod: DepositMethod | null
  createdAt: string
}

export interface HistoryShiftDetail {
  shift: {
    id: string
    shiftType: ShiftType
    startedAt: string
    closedAt: string
    cashierName: string
    openingCash: number
    closingCash: number | null
    deliveredAmount: number | null
    deliveredTo: string | null
    notes: string | null
  }
  sales: HistorySaleRow[]
  expenses: HistoryExpenseRow[]
  debts: HistoryDebtRow[]
  deposits: HistoryOrderRow[]
  summary: {
    salesCount: number
    totalRevenue: number
    totalCashSales: number
    totalDebitSales: number
    totalWalletSales: number
    totalCreditSales: number
    totalExpenses: number
    cashDeposits: number
    digitalDeposits: number
    cashInHand: number
    debtsCount: number
    totalDebts: number
  }
}

export interface GetHistoryShiftsPayload {
  fromDate?: string
  toDate?: string
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------------------
// Carga masiva del catálogo a la balanza (KRETZ_SYNC_CATALOG)
// ---------------------------------------------------------------------------

/** Evento de progreso emitido por cada PLU durante la carga masiva. */
export interface KretzSyncProgress {
  /** Índice 1-based del ítem en proceso. */
  current: number
  /** Total de ítems a enviar (productos con PLU y precio). */
  total: number
  pluNumber: number
  name: string
  status: 'sending' | 'ok' | 'error'
  error?: string
}

/** Producto omitido de la carga y su motivo. */
export interface KretzSyncSkipped {
  pluNumber: number | null
  name: string
  reason: 'no_price' | 'price_too_high'
}

/** Producto que falló al enviarse a la balanza. */
export interface KretzSyncFailure {
  pluNumber: number
  name: string
  error: string
}

/** Resumen final de la carga masiva. */
export interface KretzSyncResult {
  /** Ítems que se intentaron enviar (con PLU y precio válido). */
  total: number
  succeeded: number
  failed: KretzSyncFailure[]
  skipped: KretzSyncSkipped[]
}

// ---------------------------------------------------------------------------
// Hardware — configuración de periféricos
// ---------------------------------------------------------------------------
export interface HardwareConfig {
  /** Puerto serial de la balanza KRETZ, ej. "COM3" */
  kretzPort?: string
}

export type SetHardwareConfigPayload = HardwareConfig

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

  /** Retorna la configuración de hardware guardada (sin contraseñas) */
  getHardwareConfig: () => Promise<IpcResult<HardwareConfig>>

  /** Guarda la configuración de hardware */
  setHardwareConfig: (payload: SetHardwareConfigPayload) => Promise<IpcResult>

  /**
   * Detecta automáticamente el puerto de la balanza KRETZ sondeando el protocolo
   * R30 en todos los puertos serie. Si la encuentra, la conecta en caliente y
   * guarda el puerto. Devuelve el puerto detectado o un error si ninguna respondió.
   */
  kretzDetectPort: () => Promise<IpcResult<{ port: string }>>

  /** Activa la instalación con un código de un solo uso */
  activateInstallation: (payload: ActivateInstallationPayload) => Promise<IpcResult>

  /** Login unificado: detecta el rol automáticamente desde Firestore */
  login: (payload: LoginPayload) => Promise<IpcResult<SessionInfo>>

  /** Login de cajera (Firebase Auth — mismo mecanismo que admin, valida rol y local autorizado) */
  loginCashier: (payload: CashierLoginPayload) => Promise<IpcResult<SessionInfo>>

  /** Login de admin (Firebase Auth) */
  loginAdmin: (payload: AdminLoginPayload) => Promise<IpcResult<SessionInfo>>

  /** Cierra la sesión activa */
  logout: (payload: { role: 'cashier' | 'admin'; storeId?: string }) => Promise<IpcResult>


  /** Retorna el turno activo del local (null si no hay ninguno abierto) */
  getActiveShift: () => Promise<IpcResult<ShiftInfo | null>>

  /** Abre un nuevo turno para la cajera autenticada */
  openShift: (payload: OpenShiftPayload) => Promise<IpcResult<ShiftInfo>>

  /** Retorna resumen del turno activo: ventas, total, horario */
  getShiftSummary: () => Promise<IpcResult<ShiftSummary>>

  /** Cierra el turno activo con datos de arqueo */
  closeShift: (payload: CloseShiftPayload) => Promise<IpcResult>

  /**
   * Suscribe un callback al aviso de inactividad (main → renderer push).
   * Retorna función de cleanup para desuscribir.
   */
  onShiftInactivityWarning: (cb: () => void) => () => void

  /** Descarta el aviso de inactividad y reinicia el timer */
  dismissInactivityWarning: () => Promise<void>

  /** Retorna todos los productos del catálogo con PLU asignado, ordenados por PLU asc */
  getProducts: () => Promise<IpcResult<ProductRow[]>>

  /** Retorna todos los productos (con y sin PLU) con precio y disponibilidad para el local dado — solo admin */
  getAllProducts: (storeId: string) => Promise<IpcResult<AdminProductRow[]>>

  /** Lista de locales del sistema */
  getStores: () => Promise<IpcResult<StoreRow[]>>

  /** Finaliza la sesión con el local elegido por el usuario tras el login */
  selectStore: (payload: { storeId: string }) => Promise<IpcResult<SessionInfo>>

  /** Crea un nuevo local — solo admin */
  createStore: (payload: { name: string; address?: string }) => Promise<IpcResult<StoreRow>>

  /** Crea un producto nuevo — solo admin */
  createProduct: (payload: CreateProductPayload) => Promise<IpcResult<{ id: string }>>

  /** Edita nombre, categoría, unidad, PLU o estado activo de un producto — solo admin */
  updateProduct: (payload: UpdateProductPayload) => Promise<IpcResult>

  /** Cambia el precio vigente de un producto en un local (cierra el anterior y abre uno nuevo) — solo admin */
  setProductPrice: (payload: SetProductPricePayload) => Promise<IpcResult>

  /** Activa o desactiva la disponibilidad de un producto en un local — solo admin */
  setProductAvailability: (payload: SetProductAvailabilityPayload) => Promise<IpcResult>

  /** Historial completo de precios de un producto en un local — solo admin */
  getProductPriceHistory: (payload: GetPriceHistoryPayload) => Promise<IpcResult<PriceHistoryRow[]>>

  /** Lista cajeras del sistema — solo admin */
  listCashiers: () => Promise<IpcResult<CashierRow[]>>

  /** Crea una cuenta de cajera en Firebase Auth + perfil en Firestore — solo admin */
  createCashier: (payload: CreateCashierPayload) => Promise<IpcResult<{ uid: string }>>

  /** Activa o desactiva una cajera en Firestore — solo admin */
  toggleCashier: (payload: ToggleCashierPayload) => Promise<IpcResult>

  /** Elimina (soft-delete) una cajera — solo admin. El Auth user persiste hasta que una Cloud Function lo limpie. */
  deleteCashier: (payload: DeleteCashierPayload) => Promise<IpcResult>

  /** Crea una venta (ítems + pagos) de forma atómica */
  createSale: (payload: CreateSalePayload) => Promise<IpcResult<SaleResult>>

  /** Lista las ventas confirmadas del turno activo (vista en vivo) */
  getShiftSales: () => Promise<IpcResult<ShiftSaleRow[]>>

  /** Cancela una venta (soft delete: status → 'cancelled'). Solo en el turno activo. */
  cancelSale: (saleId: string) => Promise<IpcResult>

  /**
   * Genera ventas ficticias de prueba en el turno activo. Solo disponible en
   * APP_ENV=dev; en producción el handler no se registra.
   */
  devGenerateSales: (payload: DevGenerateSalesPayload) => Promise<IpcResult<{ created: number }>>

  /** Registra un gasto durante el turno activo */
  registerExpense: (payload: RegisterExpensePayload) => Promise<IpcResult<{ id: string }>>

  /** Lista los gastos del turno activo */
  getShiftExpenses: () => Promise<IpcResult<ExpenseRow[]>>

  /** Devuelve el saldo de deuda actual hacia un proveedor */
  getProviderDebt: (payload: { provider: string }) => Promise<IpcResult<ProviderDebtRow | null>>

  /** Devuelve los nombres de proveedores con historial en el local (para autocomplete) */
  getProviderNames: () => Promise<IpcResult<string[]>>

  /**
   * Retorna las categorías de gasto usadas previamente (para autocomplete).
   * Incluye sugerencias predefinidas si aún no hay historial.
   */
  getExpenseCategories: () => Promise<IpcResult<string[]>>

  // ---- Clientes especiales (Fase 6) ----
  /** Crea un cliente nuevo */
  createCustomer: (payload: CreateCustomerPayload) => Promise<IpcResult<CustomerRow>>
  /** Lista clientes (con búsqueda opcional por nombre/DNI/teléfono) */
  getCustomers: (payload?: GetCustomersPayload) => Promise<IpcResult<CustomerRow[]>>
  /** Edita nombre, DNI, teléfono, tipo, notas o estado activo */
  updateCustomer: (payload: UpdateCustomerPayload) => Promise<IpcResult<CustomerRow>>

  // ---- Deudas / cuenta corriente (Fase 6) ----
  /** Marca una venta como deuda y la asocia a un cliente (existente o nuevo) */
  createDebt: (payload: CreateDebtPayload) => Promise<IpcResult<DebtEventRow>>
  /** Lista deudas activas con saldo algebraico por cliente */
  getDebts: () => Promise<IpcResult<CustomerDebtSummary[]>>
  /** Saldo y ledger completo de un cliente */
  getCustomerBalance: (payload: { customerId: string }) => Promise<IpcResult<CustomerDebtSummary>>
  /** Registra un pago parcial o total */
  addDebtPayment: (payload: AddDebtPaymentPayload) => Promise<IpcResult<DebtEventRow>>
  /** Cancela la deuda activa de un cliente (anulación, no borrado) */
  cancelDebt: (payload: CancelDebtPayload) => Promise<IpcResult>

  // ---- Clientes especiales (Fase 6 addendum, solo admins crean/editan) ----
  listSpecialCustomers: () => Promise<IpcResult<SpecialCustomerRow[]>>
  createSpecialCustomer: (payload: CreateSpecialCustomerPayload) => Promise<IpcResult<SpecialCustomerRow>>
  updateSpecialCustomer: (payload: UpdateSpecialCustomerPayload) => Promise<IpcResult>
  deleteSpecialCustomer: (payload: { id: string }) => Promise<IpcResult>
  getSpecialCustomerPrices: (payload: { specialCustomerId: string }) => Promise<IpcResult<SpecialCustomerPriceRow[]>>
  setSpecialCustomerPrice: (payload: SetSpecialCustomerPricePayload) => Promise<IpcResult>
  deleteSpecialCustomerPrice: (payload: { specialCustomerId: string; productId: string }) => Promise<IpcResult>

  // ---- Pedidos (Fase 7) ----
  createOrder: (payload: CreateOrderPayload) => Promise<IpcResult<OrderRow>>
  listOrders: (payload?: ListOrdersPayload) => Promise<IpcResult<OrderRow[]>>
  updateOrderStatus: (payload: UpdateOrderStatusPayload) => Promise<IpcResult<OrderRow>>
  updateOrder: (payload: UpdateOrderPayload) => Promise<IpcResult<OrderRow>>
  deleteOrder: (payload: { id: string }) => Promise<IpcResult>
  hardDeleteOrder: (payload: { id: string }) => Promise<IpcResult>

  // ---- Historial completo (Fase 7 — solo admin) ----
  getHistoryShifts: (payload?: GetHistoryShiftsPayload) => Promise<IpcResult<HistoryShiftRow[]>>
  getHistoryShiftDetail: (payload: { shiftId: string }) => Promise<IpcResult<HistoryShiftDetail>>

  // ---- Gestión de PLUs ----
  /** Prueba de enlace con la balanza (cmd 0002) */
  kretzTestLink: () => Promise<IpcResult<{ linked: boolean }>>
  /** Crea o actualiza un PLU en la balanza (cmd 2005) */
  kretzSendPlu: (payload: SendPluPayload) => Promise<IpcResult<{ pluNumber: string }>>
  /** Borra un PLU de la balanza (cmd 3005) */
  kretzDeletePlu: (payload: DeletePluPayload) => Promise<IpcResult<{ pluNumber: string }>>
  /** Lee un PLU de la balanza por número (cmd 5005) */
  kretzReadPlu: (payload: ReadPluPayload) => Promise<IpcResult<PluRow | null>>
  /** Cantidad de PLUs almacenados en la balanza (cmd 5001) */
  kretzReadPluCount: () => Promise<IpcResult<{ count: number }>>

  /** Carga masiva del catálogo del local a la balanza (verifica enlace R30 primero) */
  kretzSyncCatalog: (storeId: string) => Promise<IpcResult<KretzSyncResult>>

  /** Registra callback de progreso durante la carga masiva. Devuelve función para desuscribir. */
  onKretzSyncProgress: (cb: (progress: KretzSyncProgress) => void) => () => void
}

declare global {
  interface Window {
    hw: HwApi
  }
}
