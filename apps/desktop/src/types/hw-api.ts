/**
 * API tipada expuesta al renderer via window.hw (preload).
 * El renderer NUNCA accede a hardware, Firebase ni red directamente.
 * Todo pasa por este contrato.
 */

import type { StoreHoursBlock } from '@carniceria/shared'

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
// UI settings — preferencias de la aplicación, persisten entre sesiones
// ---------------------------------------------------------------------------
export interface UiSettings {
  zoomFactor: number
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
  /** Nombre de Firestore. Para filtrar vales (cajera = solo su ficha). */
  displayName?: string
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
  /** true solo cuando OPEN_SHIFT retomó un turno ya existente (no creó uno nuevo). */
  resumed?: boolean
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
  /** Total gastado en efectivo durante el turno (no incluye aportes) */
  totalExpenses: number
  /** Ingresos de efectivo a caja durante el turno */
  totalCashInjects: number
  /**
   * Efectivo estimado en caja = apertura + ventas en efectivo + señas en efectivo
   * + cobranzas de fiado en efectivo + aportes − gastos en efectivo.
   * No incluye el efectivo declarado al cerrar.
   */
  cashInHand: number
  /** Cantidad de fiados registrados en este turno */
  debtsCount: number
  /** Monto total de fiados del turno */
  totalDebts: number
  /** Cobranzas de fiado en efectivo asociadas a este turno */
  totalCashDebtPayments: number
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
  /** Concepto libre del gasto (cuando no hay proveedor). */
  concept?: string
  /** Nombre de pantalla del proveedor asociado. */
  provider?: string
  /** ID del proveedor (para consultar deuda). */
  providerId?: string
  /** Monto efectivamente pagado (lo que salió de caja). */
  amount: number
  /** Deuda nueva generada en esta visita (total - pagado). Undefined si no hubo. */
  newDebtAmount?: number
  /** Deuda anterior del proveedor que se pagó en esta visita. Undefined si no hubo. */
  paysOldDebt?: number
  notes?: string
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

export interface CatalogRevisionRow {
  id: string
  archivedAt: string
  updatedAt: string | null
  productCount: number
}

export type CatalogAuditAction =
  | 'create'
  | 'update_identity'
  | 'hide_store'
  | 'show_store'
  | 'retire_global'
  | 'restore_revision'

export interface CatalogAuditRow {
  id: string
  productId: string
  storeId: string | null
  action: CatalogAuditAction
  actorUserId: string
  actorName: string
  summary: string
  createdAt: string
}

export interface StoreRow {
  id: string
  name: string
  address?: string | null
  archivedAt?: string | null
  /** Hora de inicio del turno mañana, formato "HH:MM". Null = sin autodetección. */
  morningStart?: string | null
  /** Hora de fin del turno mañana, formato "HH:MM". */
  morningEnd?: string | null
  /** Hora de inicio del turno tarde, formato "HH:MM". */
  afternoonStart?: string | null
  /** Hora de fin del turno tarde, formato "HH:MM". */
  afternoonEnd?: string | null
  /** Horarios por grupos de días. Null = los 4 campos valen los 7 días. */
  hoursSchedule?: StoreHoursBlock[] | null
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

export interface SetProductPricesPayload {
  storeId: string
  items: Array<{ productId: string; price: number }>
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
  /** Solo crédito: cantidad de cuotas. 1 = contado. Null/undefined para otros métodos. */
  installments?: number
}

export interface CreateSalePayload {
  items: SaleItemPayload[]
  payments: SalePaymentPayload[]
  customerId?: string
  isDebt?: boolean
  /** Venta ingresada manualmente (sin pedido de balanza). Requiere aprobación admin en producción. */
  manualEntry?: boolean
  notes?: string
  /** Si se pasa, marca el pedido como entregado al confirmar la venta */
  orderId?: string
  /**
   * Crédito de seña pre-pagada. sale.total = itemTotal − depositCredit.
   * Los pagos deben cubrir ese neto. Si el neto es 0, payments puede estar vacío.
   */
  depositCredit?: number
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
  /** Locales autorizados (al menos uno). */
  authorizedStores: string[]
}

export interface UpdateCashierPayload {
  uid: string
  authorizedStores: string[]
  displayName?: string
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
  /** Medio de cobro — solo en pagos. Null en alta/cancelación. */
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit' | null
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
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit'
  notes?: string
  /** Admin: local destino, o 'all' para imputar en los locales con saldo. */
  storeId?: string
}

export interface CancelDebtPayload {
  customerId: string
  saleId?: string
  notes?: string
  /** Admin: local a cancelar, o 'all' para saldar todos los locales. */
  storeId?: string
}

// ---------------------------------------------------------------------------
// Clientes especiales (Fase 6 addendum)
// ---------------------------------------------------------------------------

export interface SpecialCustomerRow {
  id: string
  storeId: string | null   // null = visible en todos los locales
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
  storeId?: string | null  // null | omitido = todos los locales
}

export interface UpdateSpecialCustomerPayload {
  id: string
  name?: string
  notes?: string
  storeId?: string | null  // null = todos los locales; omitir para no cambiar
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

/** Línea del carrito de presupuesto (se guarda en orders.budgetItems como JSON) */
export interface BudgetCartLine {
  productId: string
  name: string
  /** 'kg' para productos a granel; 'unit' para unidades enteras */
  unit: 'kg' | 'unit'
  pluNumber: number | null
  /** Cantidad estimada al crear el pedido (kg o unidades de catálogo) */
  estimatedQty: number
  /** Precio unitario en ARS al momento de crear el pedido (referencia) */
  unitPrice: number
  /**
   * Piezas que pidió el cliente cuando el producto se cobra por kg
   * (ej. 3 morcillas). Null/omitido = pidió kilos.
   */
  requestedUnits?: number | null
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
  /** ISO timestamp de cuando se marcó como listo (auditoría) */
  readyAt: string | null
  /** ID del usuario/carnicero que marcó listo */
  readyBy: string | null
  /** Nombre denormalizado del que marcó listo */
  readyByName: string | null
  /** Carrito de presupuesto con productos y cantidades estimadas */
  budgetItems: BudgetCartLine[] | null
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
  /** Solo admin: sobreescribe el local de sesión para asignar el pedido a ese local */
  storeId?: string
  /** Carrito de presupuesto con productos y cantidades estimadas */
  budgetItems?: BudgetCartLine[]
}

export interface UpdateOrderStatusPayload {
  id: string
  status: OrderStatus
  /** Nombre del que marca Listo (solo cuando status='ready' desde el celu) */
  readyByName?: string
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
  /** Carrito de presupuesto con productos y cantidades estimadas */
  budgetItems?: BudgetCartLine[] | null
}

export interface ChargeOrderPayload {
  orderId: string
  remaining: number
  payments: SalePaymentPayload[]
  notes?: string
}

export interface ListOrdersPayload {
  status?: OrderStatus
  fromDate?: string
  toDate?: string
  /** Admin: 'all' = todos los locales; storeId específico = ese local */
  storeIdFilter?: string
}

// ---------------------------------------------------------------------------
// Deuda a proveedores
// ---------------------------------------------------------------------------

export interface ProviderDebtRow {
  provider: string
  /** ID del proveedor (para consultas y vinculación). */
  providerId: string
  /** Saldo pendiente. >0 = le debemos al proveedor; <0 = saldo a favor del negocio. */
  balance: number
  lastEventAt: string
  /** Nombre del cajero/admin que realizó el último pago (si la deuda está saldada) */
  lastPaymentBy?: string
  /** Nombre del local desde el que se registró el pago (solo si fue cross-local) */
  lastPaymentStoreName?: string
  /** ISO timestamp del último pago */
  lastPaymentAt?: string
  /** Nota del último movimiento (p. ej. ajuste de admin), visible también para cajeras. */
  lastEventNotes?: string | null
}

export interface RegisterExpensePayload {
  /** Concepto libre (obligatorio cuando no hay proveedor). */
  concept?: string
  /** ID del proveedor elegido del autocomplete. */
  providerId?: string
  /** Nombre de proveedor nuevo (se crea implícitamente). */
  provider?: string
  amount: number
  notes?: string
  /** Monto que NO se pagó ahora y queda como deuda para la próxima visita */
  newDebtAmount?: number
  /** Monto de deuda anterior que se paga en este gasto */
  paysOldDebt?: number
  /**
   * Local al que se imputa la deuda con el proveedor.
   * Si se omite, se usa el local de la sesión activa.
   * Permite pagar deuda de otro local desde la caja actual.
   */
  debtStoreId?: string
}

/** Payload para actualizar un gasto existente del turno activo. */
export interface UpdateExpensePayload extends RegisterExpensePayload {
  id: string
}

// ---------------------------------------------------------------------------
// Proveedores (entidades globales sincronizadas — Fase S1)
// ---------------------------------------------------------------------------

export interface ProviderRow {
  id: string
  name: string
  phone?: string
  notes?: string
  archivedAt?: string
}

export interface ProviderWithDebtRow {
  id: string
  name: string
  /** Deuda total combinada entre todos los locales. */
  total: number
  /** Desglose por local (solo visible para admin). */
  perStore: Array<{ storeId: string; storeName: string; balance: number }>
  archivedAt?: string
  phone?: string
  notes?: string
}

/** Un evento individual del ledger de deuda de un proveedor. */
export interface ProviderDebtEventRow {
  id: string
  /** 'debt' = deuda nueva generada; 'payment' = pago de deuda anterior. */
  type: 'debt' | 'payment'
  amount: number
  storeId: string
  storeName: string
  createdAt: string
  /** Nombre del usuario que registró el evento; fallback al userId si no se encuentra en SQLite. */
  createdByName: string
  expenseId: string | null
  /** Nota visible (ajuste de admin, compensación, etc.). */
  notes?: string | null
}

export interface SettleProviderDebtPayload {
  providerId: string
  /** Monto total a saldar (entero positivo, en pesos). */
  amount: number
  /**
   * Local desde el que se registra el pago. Si no se provee, usa session.storeId.
   * Permite al admin saldar la deuda de un local específico cuando filtra el historial
   * por local (evita compensaciones cruzadas entre locales).
   */
  storeId?: string
}

// ---------------------------------------------------------------------------
// Empleados / carniceros (Bloque D)
// ---------------------------------------------------------------------------

export interface EmployeeRow {
  id: string
  name: string
  weeklyWage: number
  active: boolean
  createdAt: string
  kind: 'butcher' | 'cashier'
  /** null = aparece en las listas de todos los locales. */
  homeStoreId: string | null
  /** Firebase UID de la cuenta de acceso celular. null = sin cuenta. Solo carniceros. */
  firebaseUid?: string | null
}

export interface CreateEmployeePayload {
  name: string
  weeklyWage: number
  kind?: 'butcher' | 'cashier'
  homeStoreId?: string | null
}

export interface UpdateEmployeePayload {
  id: string
  name?: string
  weeklyWage?: number
  homeStoreId?: string | null
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'early_departure'

export interface AttendanceRow {
  id: string
  employeeId: string
  employeeName: string
  date: string
  status: AttendanceStatus
  note: string | null
  recordedBy: string
  createdAt: string
  /** Local donde se marcó. null en filas viejas. */
  storeId: string | null
}

export interface RecordAttendancePayload {
  employeeId: string
  date: string
  status: AttendanceStatus
  note?: string | null
  storeId?: string | null
}

export interface UpdateAttendancePayload {
  id: string
  status?: AttendanceStatus
  note?: string | null
}

export interface ListAttendancePayload {
  startDate: string
  endDate: string
  employeeId?: string
}

export interface EmployeeValeRow {
  id: string
  employeeId: string
  shiftId: string | null
  amount: number
  description: string | null
  /** Ítems registrados (solo vales con productos). null = adelanto en efectivo. */
  items: ValeItem[] | null
  paidAt: string
  recordedBy: string
  createdAt: string
  cancelledAt: string | null
  cancelledBy: string | null
}

/** Ítem individual dentro de un vale con productos. */
export interface ValeItem {
  productId: string
  productName: string
  unit: 'kg' | 'unit'
  /** Para kg: decimal. Para unidades: entero. */
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface RegisterValePayload {
  employeeId: string
  amount: number
  description?: string | null
  /** Items del vale. Si se provee, el amount debe coincidir con la suma de subtotales. */
  items?: ValeItem[] | null
}

export interface ListValesPayload {
  employeeId: string
  weekStart?: string
  weekEnd?: string
}

export interface WeeklyValeSummary {
  employeeId: string
  weekStart: string
  weekEnd: string
  totalVales: number
  weeklyWage: number
  netToPay: number
}

export interface GetWeeklyValeSummaryPayload {
  employeeId: string
  weekStart: string
}

export interface SalaryValeSnapshotItem {
  id: string
  amount: number
  description: string | null
  paidAt: string
}

export interface SalaryPaymentRow {
  id: string
  employeeId: string
  shiftId: string | null
  amount: number
  weekStart: string
  valesDeducted: number
  netPaid: number
  recordedBy: string
  paidAt: string
  notes: string | null
  valesSnapshot: SalaryValeSnapshotItem[] | null
}

export interface PayWeeklySalaryPayload {
  employeeId: string
  weekStart: string
  amount: number
  valesDeducted: number
  notes?: string | null
  valesSnapshot?: SalaryValeSnapshotItem[] | null
}

export interface ListSalaryPaymentsPayload {
  weekStart: string
}

export interface GetRemoteSalaryWeekPayload {
  weekStart: string
}

export interface RemoteSalaryWeek {
  payments: SalaryPaymentRow[]
  vales: RemoteEmployeeValeRow[]
}

// ---------------------------------------------------------------------------
// Conteo de stock (Bloque E)
// ---------------------------------------------------------------------------

export type StockCountStatus = 'draft' | 'final'

export interface StockCountItemSnapshot {
  productId: number
  productName: string
  quantityKg: number | null
  quantityUnits: number | null
  notes: string | null
}

export interface StockCountItemRow {
  id: string
  stockCountId: string
  /** PLU */
  productId: number
  productName: string
  /** Gramos (null si no aplica). */
  quantityKg: number | null
  quantityUnits: number | null
  notes: string | null
}

export interface StockCountRow {
  id: string
  storeId: string
  storeName: string
  countDate: string
  recordedBy: string
  recordedByName: string
  itemCount: number
  createdAt: string
  status: StockCountStatus
  updatedAt: string | null
  lastEditedBy: string | null
  lastEditedByName: string | null
  lastEditedAt: string | null
  originalItems: StockCountItemSnapshot[] | null
}

export interface StockCountDetail extends StockCountRow {
  items: StockCountItemRow[]
}

export interface CreateStockCountItemPayload {
  productId: number
  productName: string
  quantityKg?: number | null
  quantityUnits?: number | null
  notes?: string | null
}

export interface CreateStockCountPayload {
  /** Si hay un conteo en curso, se pasa su id para actualizarlo. */
  id?: string
  countDate: string
  storeId?: string
  items: CreateStockCountItemPayload[]
  /** draft = en curso; final = confirmado (sigue editable). Default final. */
  status?: StockCountStatus
}

export interface ListStockCountsPayload {
  storeId?: string
  startDate?: string
  endDate?: string
}

export interface GetStockCountDetailPayload {
  stockCountId: string
}

export interface GetDraftStockCountPayload {
  storeId?: string
  /** Si no hay borrador, reanuda el conteo de esta fecha (YYYY-MM-DD). */
  countDate?: string
}

// ---------------------------------------------------------------------------
// Historial completo (Fase 7 — solo admin)
// ---------------------------------------------------------------------------

export interface HistoryShiftRow {
  id: string
  shiftType: ShiftType
  startedAt: string
  /** Null si el turno sigue abierto. */
  closedAt: string | null
  cashierName: string
  salesCount: number
  totalRevenue: number
  totalCashSales: number
  totalExpenses: number
  cashInHand: number
  totalDeposits: number
  /** Origen del turno. Ausente en filas viejas = desktop. */
  source?: 'desktop' | 'mobile'
}

export interface RemoteEmployeeValeRow {
  id: string
  employeeId: string
  employeeName: string
  storeId: string | null
  shiftId: string | null
  amount: number
  description: string | null
  items: Array<{
    productName: string
    quantity: number
    unitPrice: number
    subtotal: number
  }>
  paidAt: string
  createdAt: string
  cancelledAt: string | null
}

export interface GetRemoteEmployeeValesPayload {
  /** 'all' o omitido = todos; storeId = filtrar por local. */
  storeIdFilter?: string
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
  concept?: string
  provider?: string
  amount: number
  notes: string | null
  createdBy: string
  kind?: 'expense' | 'inject'
}

export interface HistoryDebtRow {
  id: string
  createdAt: string
  customerName: string
  amount: number
  eventType: 'created' | 'partial_payment' | 'paid' | 'cancelled' | 'reopened'
  notes: string | null
}

export interface HistoryValeRow {
  id: string
  employeeName: string
  amount: number
  description: string | null
  items: ValeItem[] | null
  cancelledAt: string | null
  createdAt: string
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
  /** Estado del pedido; los cancelados siguen visibles para auditoría. */
  status?: 'pending' | 'ready' | 'delivered' | 'cancelled'
}

export interface HistoryShiftDetail {
  shift: {
    id: string
    shiftType: ShiftType
    startedAt: string
    closedAt: string | null
    cashierName: string
    openingCash: number
    closingCash: number | null
    deliveredAmount: number | null
    deliveredTo: string | null
    notes: string | null
    source?: 'desktop' | 'mobile'
  }
  sales: HistorySaleRow[]
  expenses: HistoryExpenseRow[]
  debts: HistoryDebtRow[]
  deposits: HistoryOrderRow[]
  vales: HistoryValeRow[]
  summary: {
    salesCount: number
    totalRevenue: number
    totalCashSales: number
    totalDebitSales: number
    totalWalletSales: number
    totalCreditSales: number
    totalExpenses: number
    totalCashInjects: number
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
  /** Admin: 'all' = todos los locales; storeId específico = ese local */
  storeIdFilter?: string
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

  /**
   * Re-sincroniza locales, empleados y catálogo desde Firestore sin cerrar sesión.
   * Usado por el botón ↺ de la UI.
   */
  refreshRemoteData: () => Promise<IpcResult<{ storeId: string | null }>>


  /** Retorna el turno activo del local (null si no hay ninguno abierto) */
  getActiveShift: () => Promise<IpcResult<ShiftInfo | null>>

  /**
   * Retorna el turno abierto del local actual (cualquier usuario), o null si no hay ninguno.
   * Solo consulta turnos de fuente 'desktop'. Usado para pre-verificación en OpenShiftScreen.
   */
  getStoreOpenShift: () => Promise<IpcResult<{ userId: string; shiftId: string; userName: string } | null>>

  /**
   * Retorna el turno abierto del usuario en sesión (cualquier local), o null si no hay ninguno.
   * Usado al post-login de cajeras para detectar si tienen un turno sin cerrar y reanudarlas
   * directamente, salteando el store picker y la pantalla de apertura de turno.
   */
  getUserOpenShift: () => Promise<IpcResult<{ shiftId: string; storeId: string; shiftType: string; openingCash: number } | null>>

  /** Abre un nuevo turno para la cajera autenticada */
  openShift: (payload: OpenShiftPayload) => Promise<IpcResult<ShiftInfo>>

  /** Retorna resumen del turno activo: ventas, total, horario */
  getShiftSummary: () => Promise<IpcResult<ShiftSummary>>

  /** Cierra el turno activo con datos de arqueo */
  closeShift: (payload: CloseShiftPayload) => Promise<IpcResult>

  /**
   * Cierra un turno abierto (propio o ajeno) sin arqueo. Solo admin.
   * Sirve para desbloquear el local cuando el turno quedó colgado.
   */
  forceCloseOpenShift: (payload: { shiftId: string }) => Promise<IpcResult>

  /**
   * Suscribe un callback al aviso de inactividad (main → renderer push).
   * Retorna función de cleanup para desuscribir.
   */
  onShiftInactivityWarning: (cb: () => void) => () => void

  /** Fiados remotos aplicados en SQLite (main → renderer). */
  onDebtSyncUpdated: (cb: () => void) => () => void

  /** Clientes especiales / precios remotos aplicados en SQLite (main → renderer). */
  onSpecialCustomerSyncUpdated: (cb: () => void) => () => void

  /** Zoom u otras preferencias cambiaron desde main (atajos Ctrl+/-). */
  onUiSettingsChanged: (cb: (settings: UiSettings) => void) => () => void

  /** Catálogo remoto mergeado en SQLite (BLOQUE I-A). Recargar GET_PRODUCTS / GET_ALL_PRODUCTS. No mutar ítems ya en el ticket. */
  onCatalogSyncUpdated: (cb: (payload?: { storeId?: string }) => void) => () => void
  /** Pedidos remotos aplicados en SQLite (Listo del celu). Recargar listOrders. */
  onOrderSyncUpdated: (cb: () => void) => () => void

  /** Descarta el aviso de inactividad y reinicia el timer */
  dismissInactivityWarning: () => Promise<void>

  /** Retorna todos los productos del catálogo con PLU asignado, ordenados por PLU asc */
  getProducts: () => Promise<IpcResult<ProductRow[]>>

  /** Retorna todos los productos (con y sin PLU) con precio y disponibilidad para el local dado — solo admin */
  getAllProducts: (storeId: string) => Promise<IpcResult<AdminProductRow[]>>

  /** Lista de locales del sistema */
  getStores: (payload?: { includeArchived?: boolean }) => Promise<IpcResult<StoreRow[]>>

  /** Finaliza la sesión con el local elegido por el usuario tras el login */
  selectStore: (payload: { storeId: string }) => Promise<IpcResult<SessionInfo>>

  /** Crea un nuevo local — solo admin */
  createStore: (payload: {
    name: string
    address?: string
    morningStart?: string | null
    morningEnd?: string | null
    afternoonStart?: string | null
    afternoonEnd?: string | null
    hoursSchedule?: StoreHoursBlock[] | null
  }) => Promise<IpcResult<StoreRow>>

  /** Actualiza nombre, dirección y/o horarios de un local — solo admin */
  updateStore: (payload: {
    id: string
    name?: string
    address?: string | null
    morningStart?: string | null
    morningEnd?: string | null
    afternoonStart?: string | null
    afternoonEnd?: string | null
    hoursSchedule?: StoreHoursBlock[] | null
  }) => Promise<IpcResult<StoreRow>>

  /** Elimina un local — solo admin; solo si no tiene datos asociados */
  deleteStore: (payload: { id: string }) => Promise<IpcResult>

  /** Archiva un local — oculta de operaciones pero preserva historial */
  archiveStore: (payload: { id: string }) => Promise<IpcResult<StoreRow>>

  /** Desarchiva un local — lo vuelve a activar */
  unarchiveStore: (payload: { id: string }) => Promise<IpcResult<StoreRow>>

  /** Crea un producto nuevo — admin o cajera (BLOQUE I-B) */
  createProduct: (payload: CreateProductPayload) => Promise<IpcResult<{ id: string }>>

  /** Edita nombre, categoría, unidad, PLU. `active: false` (retiro global) solo admin. */
  updateProduct: (payload: UpdateProductPayload) => Promise<IpcResult>

  /** Cambia el precio vigente. Cajera: solo el local de la sesión. */
  setProductPrice: (payload: SetProductPricePayload) => Promise<IpcResult>

  /** Cambia varios precios del mismo local en una transacción (Editar precios). Una versión. */
  setProductPrices: (payload: SetProductPricesPayload) => Promise<IpcResult>

  /** Activa o desactiva la disponibilidad en un local. Cajera: solo su local. */
  setProductAvailability: (payload: SetProductAvailabilityPayload) => Promise<IpcResult>

  /** Historial completo de precios de un producto en un local */
  getProductPriceHistory: (payload: GetPriceHistoryPayload) => Promise<IpcResult<PriceHistoryRow[]>>

  /** Versiones archivadas del catálogo de un local (snapshots previos a cada confirmación de precios) — solo admin */
  listCatalogRevisions: (payload: { storeId: string }) => Promise<IpcResult<CatalogRevisionRow[]>>

  /** Restaura un snapshot archivado como catálogo vigente y lo baja a SQLite — solo admin */
  restoreCatalogRevision: (payload: { storeId: string; revisionId: string }) => Promise<IpcResult<{ productCount: number }>>

  /** Auditoría de ficha / visibilidad / retiro global (BLOQUE I-B) */
  listCatalogAudit: (payload: { productId?: string; storeId?: string }) => Promise<IpcResult<CatalogAuditRow[]>>

  /** Lista cajeras del sistema — solo admin */
  listCashiers: () => Promise<IpcResult<CashierRow[]>>

  /** Crea una cuenta de cajera en Firebase Auth + perfil en Firestore — solo admin */
  createCashier: (payload: CreateCashierPayload) => Promise<IpcResult<{ uid: string }>>

  /** Actualiza locales autorizados (y opcionalmente nombre) — solo admin */
  updateCashier: (payload: UpdateCashierPayload) => Promise<IpcResult>

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

  /** Registra un aporte de efectivo a caja durante el turno activo */
  registerCashInject: (payload: { amount: number; notes?: string }) => Promise<IpcResult<{ id: string }>>

  /** Actualiza un gasto del turno activo (solo mientras el turno está abierto) */
  updateExpense: (payload: UpdateExpensePayload) => Promise<IpcResult<{ id: string }>>

  /** Elimina un gasto del turno activo y sus eventos de deuda asociados */
  deleteExpense: (id: string) => Promise<IpcResult<undefined>>

  /** Lista los gastos del turno activo */
  getShiftExpenses: () => Promise<IpcResult<ExpenseRow[]>>

  /** Devuelve el saldo de deuda actual hacia un proveedor (por providerId).
   *  storeId opcional: si se provee, consulta ese local en lugar del local de sesión. */
  getProviderDebt: (payload: { providerId: string; storeId?: string }) => Promise<IpcResult<ProviderDebtRow | null>>

  /** Devuelve los nombres de proveedores desde la cache (legacy; preferir listProviders) */
  getProviderNames: () => Promise<IpcResult<string[]>>

  /**
   * Retorna los conceptos de gasto usados previamente (para autocomplete).
   * Incluye sugerencias predefinidas si aún no hay historial.
   */
  getExpenseCategories: () => Promise<IpcResult<string[]>>

  // ---- Proveedores (Fase S1) ----
  /** Lista proveedores activos desde la cache local. */
  listProviders: (payload?: { includeArchived?: boolean }) => Promise<IpcResult<ProviderRow[]>>
  /** Crea un proveedor nuevo (admin; también implícito desde el registro de gasto). */
  createProvider: (payload: { name: string; phone?: string; notes?: string }) => Promise<IpcResult<ProviderRow>>
  /** Edita nombre, teléfono o notas de un proveedor. */
  updateProvider: (payload: { id: string; name?: string; phone?: string | null; notes?: string | null }) => Promise<IpcResult<ProviderRow>>
  /** Archiva un proveedor (lo oculta; conserva deuda e historial). */
  archiveProvider: (payload: { id: string }) => Promise<IpcResult<void>>
  /** Restaura un proveedor archivado. */
  unarchiveProvider: (payload: { id: string }) => Promise<IpcResult<void>>
  /**
   * Oculta el proveedor. Conserva deuda e historial para poder restaurarlo.
   */
  deleteProvider: (payload: { id: string }) => Promise<IpcResult<void>>
  /** Lista proveedores con deuda combinada cross-local (solo admin; lee Firestore). */
  getProvidersWithDebt: (payload?: { includeArchived?: boolean }) => Promise<IpcResult<ProviderWithDebtRow[]>>
  /** Historial de eventos de deuda de un proveedor (solo admin). */
  getProviderDebtHistory: (payload: { providerId: string }) => Promise<IpcResult<ProviderDebtEventRow[]>>
  /**
   * Registra un pago de deuda con un proveedor (solo admin, sin caja).
   * El monto puede ser parcial.
   */
  settleProviderDebt: (payload: SettleProviderDebtPayload) => Promise<IpcResult<{ eventId: string }>>
  /** Admin: registra deuda o pago manual en un local (sin mover caja). */
  recordProviderLedger: (payload: {
    providerId: string
    storeId: string
    type: 'debt' | 'payment'
    amount: number
    notes?: string
  }) => Promise<IpcResult<{ eventId: string }>>
  /** Admin: aplica saldos a favor contra deudas de otros locales. */
  compensateProviderStores: (payload: { providerId: string }) => Promise<IpcResult<{ events: number }>>
  /**
   * Cajera con turno: el efectivo sale de esta caja y se imputa como pago
   * en uno o varios locales.
   */
  payProviderFromShift: (payload: {
    providerId: string
    allocations: Array<{ storeId: string; amount: number }>
    notes?: string
  }) => Promise<IpcResult<{ expenseId: string }>>

  // ---- Empleados / carniceros (Bloque D) ----
  listEmployees: (payload?: { includeArchived?: boolean }) => Promise<IpcResult<EmployeeRow[]>>
  createEmployee: (payload: CreateEmployeePayload) => Promise<IpcResult<EmployeeRow>>
  updateEmployee: (payload: UpdateEmployeePayload) => Promise<IpcResult<EmployeeRow>>
  archiveEmployee: (payload: { id: string }) => Promise<IpcResult<EmployeeRow>>
  unarchiveEmployee: (payload: { id: string }) => Promise<IpcResult<EmployeeRow>>
  /** Crea o restablece la cuenta Firebase del carnicero (email solo la primera vez). Guarda firebaseUid en SQLite. */
  grantButcherAccess: (payload: { employeeId: string; email?: string }) => Promise<IpcResult<{ uid: string }>>
  /** Desactiva la cuenta Firebase del carnicero y borra firebaseUid en SQLite. */
  revokeButcherAccess: (payload: { employeeId: string }) => Promise<IpcResult>

  // ---- Asistencia (Bloque D) ----
  recordAttendance: (payload: RecordAttendancePayload) => Promise<IpcResult<AttendanceRow>>
  updateAttendance: (payload: UpdateAttendancePayload) => Promise<IpcResult<AttendanceRow>>
  listAttendance: (payload: ListAttendancePayload) => Promise<IpcResult<AttendanceRow[]>>

  // ---- Vales / adelantos (Bloque D) ----
  registerVale: (payload: RegisterValePayload) => Promise<IpcResult<EmployeeValeRow>>
  listVales: (payload: ListValesPayload) => Promise<IpcResult<EmployeeValeRow[]>>
  getWeeklyValeSummary: (payload: GetWeeklyValeSummaryPayload) => Promise<IpcResult<WeeklyValeSummary>>
  cancelVale: (payload: { id: string }) => Promise<IpcResult<EmployeeValeRow>>

  // ---- Pago de salario semanal (Bloque D) ----
  payWeeklySalary: (payload: PayWeeklySalaryPayload) => Promise<IpcResult<SalaryPaymentRow>>
  listSalaryPayments: (payload: ListSalaryPaymentsPayload) => Promise<IpcResult<SalaryPaymentRow[]>>
  getRemoteSalaryWeek: (payload: GetRemoteSalaryWeekPayload) => Promise<IpcResult<RemoteSalaryWeek>>

  // ---- Conteo de stock (Bloque E) ----
  createStockCount: (payload: CreateStockCountPayload) => Promise<IpcResult<StockCountDetail>>
  listStockCounts: (payload?: ListStockCountsPayload) => Promise<IpcResult<StockCountRow[]>>
  getStockCountDetail: (payload: GetStockCountDetailPayload) => Promise<IpcResult<StockCountDetail>>
  getDraftStockCount: (payload?: GetDraftStockCountPayload) => Promise<IpcResult<StockCountDetail | null>>
  discardStockCountDraft: (payload: GetStockCountDetailPayload) => Promise<IpcResult>

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
  getDebts: (payload?: { storeIdFilter?: string }) => Promise<IpcResult<CustomerDebtSummary[]>>
  /** Saldo y ledger completo de un cliente */
  getCustomerBalance: (payload: { customerId: string }) => Promise<IpcResult<CustomerDebtSummary>>
  /** Registra un pago parcial o total */
  addDebtPayment: (payload: AddDebtPaymentPayload) => Promise<IpcResult<DebtEventRow>>
  /** Cancela la deuda activa de un cliente (anulación, no borrado) */
  cancelDebt: (payload: CancelDebtPayload) => Promise<IpcResult>

  // ---- Clientes especiales (Fase 6 addendum, solo admins crean/editan) ----
  listSpecialCustomers: (payload?: { storeIdFilter?: string }) => Promise<IpcResult<SpecialCustomerRow[]>>
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
  /** Cobra el resto del pedido (seña ya descontada) y lo marca entregado. */
  chargeOrder: (payload: ChargeOrderPayload) => Promise<IpcResult<OrderRow>>

  // ---- Historial completo (Fase 7 — solo admin) ----
  getHistoryShifts: (payload?: GetHistoryShiftsPayload) => Promise<IpcResult<HistoryShiftRow[]>>
  getHistoryShiftDetail: (payload: { shiftId: string }) => Promise<IpcResult<HistoryShiftDetail>>
  getRemoteEmployeeVales: (payload?: GetRemoteEmployeeValesPayload) => Promise<IpcResult<RemoteEmployeeValeRow[]>>

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

  // ---- Preferencias de UI ----
  getUiSettings: () => Promise<IpcResult<UiSettings>>
  setUiSettings: (payload: UiSettings) => Promise<IpcResult<UiSettings>>
}

declare global {
  interface Window {
    hw: HwApi
  }
}
