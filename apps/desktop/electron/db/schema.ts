import { sqliteTable, text, real, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------
export const stores = sqliteTable('stores', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
})

// ---------------------------------------------------------------------------
// Usuarios (caché local de perfil de cajeras — sin credenciales).
//
// La identidad y la contraseña viven en Firebase Auth; esta tabla es solo un
// caché para que los FK de shifts/sales/product_prices resuelvan localmente
// sin depender de internet. `id` = `firebaseUid` para las cajeras nuevas
// (se upsertea automáticamente al loguearse por primera vez en un local).
// Los admins NO tienen fila acá — se autentican via Firebase Auth y su rol
// se resuelve en Firestore (licenses/{key}/users/{uid}), nunca en SQLite.
// ---------------------------------------------------------------------------
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  storeId: text('store_id').references(() => stores.id),
  name: text('name').notNull(),
  firebaseUid: text('firebase_uid').unique(),
  role: text('role', { enum: ['cashier'] }).notNull().default('cashier'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// Dispositivos de admin (solo auditoría)
// ---------------------------------------------------------------------------
export const adminDevices = sqliteTable('admin_devices', {
  uid: text('uid').primaryKey(),
  licenseKey: text('license_key').notNull(),
  deviceHint: text('device_hint'),
  firstSeen: text('first_seen').notNull(),
  lastSeen: text('last_seen').notNull(),
})

// ---------------------------------------------------------------------------
// Catálogo de productos (global — agnóstico al local)
// ---------------------------------------------------------------------------
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category', { enum: ['beef_cut', 'poultry', 'pork', 'other'] }).notNull(),
  unit: text('unit', { enum: ['kg', 'unit'] }).notNull(),
  /**
   * Número de PLU en la balanza KRETZ (1–999). Único por local.
   * Rangos acordados:
   *   1–99   → Cortes vacunos
   *   100–149 → Pollo y aves
   *   150–199 → Cerdo
   *   200–249 → Embutidos y chacinados
   *   250–299 → Productos especiales (huevos, carbón, leña, etc.)
   *   300+    → Reservado / uso libre
   */
  pluNumber: integer('plu_number').unique(),
  barcode: text('barcode'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// Disponibilidad de productos por local
// Resuelve el caso de productos que solo existen en un local (carbón, leña)
// ---------------------------------------------------------------------------
export const storeProducts = sqliteTable(
  'store_products',
  {
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    available: integer('available', { mode: 'boolean' }).notNull().default(true),
  },
  table => [primaryKey({ columns: [table.storeId, table.productId] })]
)

// ---------------------------------------------------------------------------
// Precios por local con historial (valid_from / valid_to)
// ---------------------------------------------------------------------------
export const productPrices = sqliteTable(
  'product_prices',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    price: real('price').notNull(),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [index('idx_prices_product').on(table.productId, table.storeId, table.validFrom)]
)

// ---------------------------------------------------------------------------
// Clientes especiales
// ---------------------------------------------------------------------------
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  name: text('name').notNull(),
  dni: text('dni'),
  phone: text('phone'),
  type: text('type', { enum: ['restaurant', 'wholesale', 'other'] }),
  notes: text('notes'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  syncedAt: text('synced_at'),
})

// ---------------------------------------------------------------------------
// Precios especiales por cliente
// ---------------------------------------------------------------------------
export const customerPrices = sqliteTable('customer_prices', {
  id: text('id').primaryKey(),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  price: real('price').notNull(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  syncedAt: text('synced_at'),
})

// ---------------------------------------------------------------------------
// Clientes especiales (entidad admin — separada de customers/fiados)
// ---------------------------------------------------------------------------
export const specialCustomers = sqliteTable('special_customers', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .references(() => stores.id),          // nullable: null = todos los locales
  name: text('name').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  updatedAt: text('updated_at'),
  updatedBy: text('updated_by').references(() => users.id),
})

export const specialCustomerPrices = sqliteTable(
  'special_customer_prices',
  {
    id: text('id').primaryKey(),
    specialCustomerId: text('special_customer_id')
      .notNull()
      .references(() => specialCustomers.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    price: real('price').notNull(),
    notes: text('notes'),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id),
  },
  table => [index('idx_sc_prices_customer').on(table.specialCustomerId)]
)

// ---------------------------------------------------------------------------
// Jornadas / turnos
// ---------------------------------------------------------------------------
export const shifts = sqliteTable(
  'shifts',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    shiftType: text('shift_type', { enum: ['morning', 'evening'] }).notNull(),
    startedAt: text('started_at').notNull(),
    closedAt: text('closed_at'),
    openingCash: real('opening_cash').notNull(),
    closingCash: real('closing_cash'),
    safeAmount: real('safe_amount'),
    deliveredAmount: real('delivered_amount'),
    deliveredTo: text('delivered_to'),
    notes: text('notes'),
    syncedAt: text('synced_at'),
    /**
     * Origen del turno.
     * 'desktop' → creado desde la PC (valor por defecto).
     * 'mobile'  → importado desde la PWA móvil (no afecta la lógica de turno activo).
     */
    source: text('source', { enum: ['desktop', 'mobile'] }).notNull().default('desktop'),
  },
  table => [index('idx_shifts_store').on(table.storeId, table.startedAt)]
)

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id),
    customerId: text('customer_id').references(() => customers.id),
    total: real('total').notNull(),
    isDebt: integer('is_debt', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['in_progress', 'confirmed', 'discarded', 'cancelled'] }).notNull(),
    manualEntry: integer('manual_entry', { mode: 'boolean' }).notNull().default(false),
    manualApprovedBy: text('manual_approved_by').references(() => users.id),
    manualApprovedAt: text('manual_approved_at'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [
    index('idx_sales_shift').on(table.shiftId),
    index('idx_sales_store').on(table.storeId, table.createdAt),
  ]
)

// ---------------------------------------------------------------------------
// Ítems de cada venta
// ---------------------------------------------------------------------------
export const saleItems = sqliteTable(
  'sale_items',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull(),
    unitPrice: real('unit_price').notNull(),
    subtotal: real('subtotal').notNull(),
    notes: text('notes'),
    syncedAt: text('synced_at'),
  },
  table => [index('idx_sale_items_sale').on(table.saleId)]
)

// ---------------------------------------------------------------------------
// Pagos por venta (soporta cobros combinados)
// ---------------------------------------------------------------------------
export const salePayments = sqliteTable(
  'sale_payments',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id),
    paymentMethod: text('payment_method', {
      enum: ['cash', 'debit', 'wallet', 'credit'],
    }).notNull(),
    amount: real('amount').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [index('idx_sale_payments_sale').on(table.saleId)]
)

// ---------------------------------------------------------------------------
// Eventos de deuda (modelo de ledger por cliente — NUNCA sobreescritura)
// amount positivo = deuda generada, negativo = pago aplicado
// ---------------------------------------------------------------------------
export const debtEvents = sqliteTable(
  'debt_events',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    // Obligatorio solo en evento 'created' desde una venta. NULL en pagos genéricos.
    saleId: text('sale_id').references(() => sales.id),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    eventType: text('event_type', {
      enum: ['created', 'partial_payment', 'paid', 'cancelled', 'reopened'],
    }).notNull(),
    amount: real('amount').notNull(),
    // Fecha acordada de pago — solo se usa en eventos 'created'. UTC ISO 8601.
    dueDate: text('due_date'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [
    index('idx_debt_events_customer').on(table.customerId, table.createdAt),
    index('idx_debt_events_sale').on(table.saleId, table.createdAt),
  ]
)

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------
export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id),
    /** Categoría del gasto — texto libre, sin enum para permitir categorías personalizadas. */
    category: text('category').notNull(),
    /** Proveedor relacionado con el gasto (texto libre, opcional). Usado para seguimiento de deudas. */
    provider: text('provider'),
    amount: real('amount').notNull(),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [index('idx_expenses_shift').on(table.shiftId)]
)

// ---------------------------------------------------------------------------
// Billetes al cierre
// ---------------------------------------------------------------------------
export const billDenominations = sqliteTable('bill_denominations', {
  id: text('id').primaryKey(),
  shiftId: text('shift_id')
    .notNull()
    .references(() => shifts.id),
  denomination: integer('denomination').notNull(),
  quantity: integer('quantity').notNull(),
  subtotal: real('subtotal').notNull(),
})

// ---------------------------------------------------------------------------
// Ingreso de mercadería (stock)
// ---------------------------------------------------------------------------
export const stockEntries = sqliteTable('stock_entries', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  grossWeight: real('gross_weight'),
  trimWeight: real('trim_weight'),
  netWeight: real('net_weight').notNull(),
  supplier: text('supplier'),
  entryDate: text('entry_date').notNull(),
  notes: text('notes'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  syncedAt: text('synced_at'),
})

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------
export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    customerName: text('customer_name').notNull(),
    phone: text('phone'),
    items: text('items').notNull(),
    pickupDate: text('pickup_date').notNull(),
    /** Slot horario opcional: 'morning' | 'afternoon' | 'specific' */
    timeSlot: text('time_slot', { enum: ['morning', 'afternoon', 'specific'] }),
    /** Hora específica (HH:MM) solo cuando timeSlot='specific' */
    pickupTime: text('pickup_time'),
    /** Pedido marcado como prioritario/importante */
    priority: integer('priority', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['pending', 'ready', 'delivered', 'cancelled'] }).notNull(),
    notes: text('notes'),
    depositAmount: real('deposit_amount').notNull().default(0),
    /** Legado: medio de pago único. Usar depositPayments para multi-método. */
    depositMethod: text('deposit_method', { enum: ['cash', 'debit', 'wallet', 'credit'] }),
    /** JSON: Array<{method: 'cash'|'debit'|'wallet'|'credit', amount: number}> */
    depositPayments: text('deposit_payments'),
    depositShiftId: text('deposit_shift_id').references(() => shifts.id),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: text('updated_at'),
    updatedBy: text('updated_by').references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [
    index('idx_orders_store_pickup').on(table.storeId, table.pickupDate),
    index('idx_orders_shift').on(table.depositShiftId),
  ]
)

// ---------------------------------------------------------------------------
// Deuda a proveedores (ledger de eventos)
// ---------------------------------------------------------------------------
export const providerDebtEvents = sqliteTable(
  'provider_debt_events',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    /** Nombre del proveedor normalizado (trim, sin cambiar mayúsculas en almacenamiento) */
    provider: text('provider').notNull(),
    /** 'debt' = nueva deuda generada al pagar menos de lo facturado; 'payment' = pago de deuda anterior */
    type: text('type', { enum: ['debt', 'payment'] }).notNull(),
    amount: real('amount').notNull(),
    /** Gasto origen de este evento (puede ser null para pagos de deuda previos) */
    expenseId: text('expense_id').references(() => expenses.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
  },
  table => [
    index('idx_provider_debt_store_provider').on(table.storeId, table.provider),
  ]
)

// ---------------------------------------------------------------------------
// Empleados
// ---------------------------------------------------------------------------
export const employees = sqliteTable('employees', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  name: text('name').notNull(),
  role: text('role', { enum: ['butcher', 'cashier', 'other'] }).notNull(),
  weeklySalary: real('weekly_salary').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// Vales y adelantos
// ---------------------------------------------------------------------------
export const employeeAdvances = sqliteTable(
  'employee_advances',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    amount: real('amount').notNull(),
    reason: text('reason'),
    advanceDate: text('advance_date').notNull(),
    paidInWeek: text('paid_in_week'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [index('idx_advances_employee').on(table.employeeId, table.paidInWeek)]
)

// ---------------------------------------------------------------------------
// Asistencia
// ---------------------------------------------------------------------------
export const attendance = sqliteTable('attendance', {
  id: text('id').primaryKey(),
  employeeId: text('employee_id')
    .notNull()
    .references(() => employees.id),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  date: text('date').notNull(),
  status: text('status', {
    enum: ['present', 'late', 'early_leave', 'absent'],
  }).notNull(),
  justification: text('justification', { enum: ['medical', 'personal', 'other'] }),
  notes: text('notes'),
  photoPath: text('photo_path'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  syncedAt: text('synced_at'),
})
