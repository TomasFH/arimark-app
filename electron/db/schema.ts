import { sqliteTable, text, real, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------
export const stores = sqliteTable('stores', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// Usuarios (solo cajeras — los admins se autentican via Firebase Auth)
// ---------------------------------------------------------------------------
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  storeId: text('store_id').references(() => stores.id),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password').notNull(),
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
    /** Pedido de balanza del que proviene esta venta (null si es entrada manual) */
    scaleOrderId: text('scale_order_id'),
    total: real('total').notNull(),
    isDebt: integer('is_debt', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['in_progress', 'confirmed', 'discarded'] }).notNull(),
    manualEntry: integer('manual_entry', { mode: 'boolean' }).notNull().default(false),
    manualApprovedBy: text('manual_approved_by').references(() => users.id),
    manualApprovedAt: text('manual_approved_at'),
    fiscalReceiptIssued: integer('fiscal_receipt_issued', { mode: 'boolean' })
      .notNull()
      .default(false),
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
// Pedidos de balanza — unidad que llega al confirmar el canal (imprimir ticket)
// ---------------------------------------------------------------------------
export const scaleOrders = sqliteTable(
  'scale_orders',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id),
    /** Canal de la balanza que generó este pedido (A/B/C/D) */
    channel: text('channel', { enum: ['A', 'B', 'C', 'D'] }).notNull(),
    total: real('total').notNull(),
    status: text('status', { enum: ['pending', 'confirmed', 'discarded'] }).notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncedAt: text('synced_at'),
  },
  table => [
    index('idx_scale_orders_shift').on(table.shiftId, table.status),
    index('idx_scale_orders_store').on(table.storeId, table.createdAt),
  ]
)

// ---------------------------------------------------------------------------
// Ítems de cada pedido de balanza
// ---------------------------------------------------------------------------
export const scaleOrderItems = sqliteTable(
  'scale_order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => scaleOrders.id),
    productCode: text('product_code').notNull(),
    productId: text('product_id').references(() => products.id),
    weightKg: real('weight_kg').notNull(),
    unitPrice: real('unit_price').notNull(),
    subtotal: real('subtotal').notNull(),
    syncedAt: text('synced_at'),
  },
  table => [index('idx_scale_order_items_order').on(table.orderId)]
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
// Tareas de cobros digitales fuera de horario (admin → cajera)
// ---------------------------------------------------------------------------
export const pendingFiscalPayments = sqliteTable(
  'pending_fiscal_payments',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    saleId: text('sale_id').references(() => sales.id),
    amount: real('amount').notNull(),
    paymentMethod: text('payment_method', {
      enum: ['debit', 'wallet', 'credit'],
    }).notNull(),
    registeredBy: text('registered_by')
      .notNull()
      .references(() => users.id),
    registeredAt: text('registered_at').notNull(),
    targetStoreId: text('target_store_id').references(() => stores.id),
    status: text('status', { enum: ['pending', 'confirmed', 'rejected'] }).notNull(),
    processedBy: text('processed_by').references(() => users.id),
    processedAt: text('processed_at'),
    rejectionReason: text('rejection_reason'),
    syncedAt: text('synced_at'),
  },
  table => [
    index('idx_pending_fiscal_customer').on(table.customerId, table.status),
    index('idx_pending_fiscal').on(table.status, table.targetStoreId),
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
    category: text('category', {
      enum: ['supplies', 'cleaning', 'services', 'other'],
    }).notNull(),
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
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  customerName: text('customer_name').notNull(),
  phone: text('phone'),
  items: text('items').notNull(),
  pickupDate: text('pickup_date').notNull(),
  status: text('status', { enum: ['pending', 'ready', 'delivered', 'cancelled'] }).notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  syncedAt: text('synced_at'),
})

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
