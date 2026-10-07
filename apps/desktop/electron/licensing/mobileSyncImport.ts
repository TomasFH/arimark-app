/**
 * Importación a SQLite de un turno móvil (staging Firestore → local).
 * Sin I/O de red: se testea con :memory: y lo consume `mobileSync.ts`.
 *
 * Idempotente: reaplicar el mismo payload no duplica filas.
 * Si el turno ya existe, incorpora ventas/gastos/anulaciones que faltaban
 * (el celu sigue subiendo hijos mientras el turno está abierto).
 */
import log from 'electron-log'
import { eq, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/client'
import {
  shifts,
  sales,
  saleItems,
  salePayments,
  users,
  expenses,
  customers,
  debtEvents,
  providers,
  providerDebtEvents,
  employees,
  employeeVales,
  salaryPayments,
  ceboEntries,
  merchandiseIntakes,
  merchandiseIntakeLines,
} from '../db/schema'
import { providerNameKey } from '../ipc/providerUtils'
import { snapshotToDbLine } from './merchIntakeDb'
import {
  coerceInjectReason,
  coerceMerchIntakePaymentKind,
  injectConceptForReason,
  parseMerchLinesFromUnknown,
  parseBillLines,
  type BillLine,
} from '@carniceria/shared'
import { insertBillLinesIfNone } from '../db/billCountStore'

export interface MobileShiftImport {
  id: string
  storeId: string
  userId: string
  displayName: string
  shiftType: 'morning' | 'evening'
  startedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  openingBills?: BillLine[]
  closingBills?: BillLine[]
  handoverExpectedBills?: BillLine[]
  openingBillsCounted?: boolean
  closingBillsCounted?: boolean
  handoverFromShiftId?: string | null
  handoverFromCashierName?: string | null
  handoverFromClosedAt?: string | null
}

export interface MobileSaleItemImport {
  productId: string
  productName: string
  pluNumber: number | null
  quantity: number
  unitPrice: number
  subtotal: number
  weightKg: number | null
  manualEntry: boolean
}

export interface MobileSalePaymentImport {
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit'
  amount: number
}

export interface MobileSaleImport {
  id: string
  shiftId: string
  total: number
  discountAmount?: number
  discountPercent?: number
  discountException?: boolean
  items: MobileSaleItemImport[]
  payments: MobileSalePaymentImport[]
  notes: string | null
  manualEntry: boolean
  createdAt: string
  createdBy: string
  status?: 'confirmed' | 'cancelled' | string | null
  isDebt?: boolean
  customerId?: string | null
  customerName?: string | null
  customerPhone?: string | null
}

export interface MobileExpenseImport {
  id: string
  shiftId: string
  storeId?: string
  kind?: 'expense' | 'inject' | string | null
  injectReason?: 'aporte' | 'wallet_cash' | string | null
  concept: string | null
  amount: number
  notes: string | null
  createdAt: string
  createdBy: string
  providerId?: string | null
  providerName?: string | null
  newDebtAmount?: number | null
  paysOldDebt?: number | null
}

export interface MobileValeItemImport {
  productId: string
  productName: string
  unit: 'kg' | 'unit' | string
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface MobileValeImport {
  id: string
  employeeId: string
  shiftId?: string | null
  amount: number
  description?: string | null
  items?: MobileValeItemImport[] | null
  paidAt: string
  recordedBy: string
  createdAt?: string
}

export interface MobileSalarySnapshotItem {
  id: string
  amount: number
  description?: string | null
  paidAt: string
}

export interface MobileSalaryImport {
  id: string
  employeeId: string
  shiftId?: string | null
  amount: number
  weekStart: string
  valesDeducted: number
  netPaid: number
  notes?: string | null
  valesSnapshot?: MobileSalarySnapshotItem[] | null
  recordedBy: string
  paidAt: string
}

export interface MobileCeboImport {
  id: string
  shiftId: string
  quantityKg: number
  notes: string | null
  createdAt: string
  createdBy: string
  updatedBy?: string | null
  updatedAt?: string | null
}

export interface MobileMerchandiseIntakeImport {
  id: string
  shiftId: string
  category?: string
  unit?: string
  quantity?: number
  lines?: unknown
  notes: string | null
  paymentKind?: string
  paidAmount?: number
  debtAmount?: number
  providerId?: string | null
  providerName?: string | null
  expenseId?: string | null
  status?: 'draft' | 'confirmed' | string | null
  createdAt: string
  createdBy: string
  updatedBy?: string | null
  updatedAt?: string | null
}

export interface MobileShiftImportResult {
  insertedShift: boolean
  salesInserted: number
  salesCancelled: number
  expensesInserted: number
  valesInserted: number
  salaryInserted: number
  ceboInserted: number
  merchInserted: number
  /** Solo true cuando el turno ya cerró: la PC puede marcar importedAt. */
  shouldMarkImported: boolean
}

type AppDb = ReturnType<typeof getDb>

const PAYMENT_METHODS = new Set(['cash', 'debit', 'wallet', 'credit'])

export function coerceSaleStatus(value: unknown): 'confirmed' | 'cancelled' {
  return value === 'cancelled' ? 'cancelled' : 'confirmed'
}

export function coerceExpenseKind(value: unknown): 'expense' | 'inject' {
  return value === 'inject' ? 'inject' : 'expense'
}

export function netDebtFromSale(total: number, payments: MobileSalePaymentImport[]): number {
  const paid = payments.reduce((sum, p) => sum + p.amount, 0)
  return Math.round((total - paid) * 100) / 100
}

export function shouldMarkMobileShiftImported(closedAt: string | null | undefined): boolean {
  return Boolean(closedAt)
}

function ensureUserCache(
  db: AppDb,
  uid: string,
  displayName: string,
  storeId: string,
): void {
  const existing = db.select().from(users).where(eq(users.id, uid)).get()
  if (existing) return
  db.insert(users).values({
    id: uid,
    storeId,
    name: displayName,
    firebaseUid: uid,
    role: 'cashier',
    active: true,
    createdAt: new Date().toISOString(),
  }).run()
}

function ensureCustomer(
  db: AppDb,
  sale: MobileSaleImport,
  storeId: string,
): string | null {
  const customerId = sale.customerId?.trim()
  if (!customerId) return null
  const existing = db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).get()
  if (existing) return customerId

  const name = (sale.customerName ?? '').trim() || 'Cliente'
  db.insert(customers).values({
    id: customerId,
    storeId,
    name: name.slice(0, 100),
    phone: sale.customerPhone?.trim().slice(0, 30) || null,
    active: true,
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
    syncedAt: null,
  }).run()
  return customerId
}

function insertDebtCreated(
  db: AppDb,
  sale: MobileSaleImport,
  storeId: string,
  customerId: string,
  shiftId: string,
): void {
  const existing = db.select({ id: debtEvents.id })
    .from(debtEvents)
    .where(and(eq(debtEvents.saleId, sale.id), eq(debtEvents.eventType, 'created')))
    .get()
  if (existing) return

  db.insert(debtEvents).values({
    id: sale.id,
    customerId,
    saleId: sale.id,
    storeId,
    eventType: 'created',
    amount: netDebtFromSale(sale.total, sale.payments ?? []),
    dueDate: null,
    notes: sale.notes,
    shiftId,
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
    syncedAt: null,
  }).run()
}

function insertDebtCancelled(
  db: AppDb,
  saleId: string,
  createdBy: string,
): void {
  const created = db.select()
    .from(debtEvents)
    .where(and(eq(debtEvents.saleId, saleId), eq(debtEvents.eventType, 'created')))
    .get()
  if (!created) return

  const already = db.select({ id: debtEvents.id })
    .from(debtEvents)
    .where(and(eq(debtEvents.saleId, saleId), eq(debtEvents.eventType, 'cancelled')))
    .get()
  if (already) return

  db.insert(debtEvents).values({
    id: uuidv4(),
    customerId: created.customerId,
    saleId,
    storeId: created.storeId,
    eventType: 'cancelled',
    amount: -created.amount,
    dueDate: null,
    notes: 'Anulada en POS móvil',
    shiftId: created.shiftId,
    createdAt: new Date().toISOString(),
    createdBy,
    syncedAt: null,
  }).run()
}

function insertSaleRow(
  db: AppDb,
  storeId: string,
  shiftId: string,
  sale: MobileSaleImport,
): void {
  const status = coerceSaleStatus(sale.status)
  const isDebt = sale.isDebt === true
  let customerId: string | null = null
  if (isDebt) {
    customerId = ensureCustomer(db, sale, storeId)
  }

  db.insert(sales).values({
    id: sale.id,
    storeId,
    shiftId,
    customerId,
    total: sale.total,
    isDebt,
    status,
    manualEntry: sale.manualEntry,
    notes: sale.notes,
    discountAmount: Math.max(0, Math.round(sale.discountAmount ?? 0)),
    discountPercent: Math.max(0, Math.round(sale.discountPercent ?? 0)),
    discountException: sale.discountException === true,
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
  }).run()

  for (const item of sale.items ?? []) {
    try {
      db.insert(saleItems).values({
        id: uuidv4(),
        saleId: sale.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      }).run()
    } catch {
      log.warn('[mobileSync] Item omitido por FK inválido', { productId: item.productId, saleId: sale.id })
    }
  }

  const now = sale.createdAt
  for (const payment of sale.payments ?? []) {
    if (!PAYMENT_METHODS.has(payment.paymentMethod) || payment.amount <= 0) continue
    db.insert(salePayments).values({
      id: uuidv4(),
      saleId: sale.id,
      paymentMethod: payment.paymentMethod,
      amount: payment.amount,
      createdAt: now,
      createdBy: sale.createdBy,
    }).run()
  }

  if (isDebt && customerId && status === 'confirmed') {
    insertDebtCreated(db, sale, storeId, customerId, shiftId)
  }
}

function upsertProvider(
  db: AppDb,
  providerId: string,
  providerName: string,
  createdAt: string,
  createdBy: string,
): void {
  const name = providerName.trim().slice(0, 100) || providerId
  db.insert(providers).values({
    id: providerId,
    name,
    nameKey: providerNameKey(name),
    createdAt,
    createdBy,
    syncedAt: createdAt,
  }).onConflictDoUpdate({
    target: providers.id,
    set: {
      name,
      nameKey: providerNameKey(name),
    },
  }).run()
}

function insertProviderLedger(
  db: AppDb,
  storeId: string,
  shiftId: string,
  expense: MobileExpenseImport,
): void {
  const providerId = expense.providerId?.trim()
  const providerName = (expense.providerName ?? '').trim()
  if (!providerId || !providerName) return

  const newDebt = Number(expense.newDebtAmount ?? 0)
  const paysOld = Number(expense.paysOldDebt ?? 0)
  if (newDebt > 0) {
    const id = `${expense.id}:debt`
    const existing = db.select({ id: providerDebtEvents.id }).from(providerDebtEvents).where(eq(providerDebtEvents.id, id)).get()
    if (!existing) {
      db.insert(providerDebtEvents).values({
        id,
        storeId,
        providerId,
        provider: providerName,
        type: 'debt',
        amount: newDebt,
        expenseId: expense.id,
        shiftId,
        createdAt: expense.createdAt,
        createdBy: expense.createdBy,
        syncedAt: expense.createdAt,
      }).run()
    }
  }
  if (paysOld > 0) {
    const id = `${expense.id}:payment`
    const existing = db.select({ id: providerDebtEvents.id }).from(providerDebtEvents).where(eq(providerDebtEvents.id, id)).get()
    if (!existing) {
      db.insert(providerDebtEvents).values({
        id,
        storeId,
        providerId,
        provider: providerName,
        type: 'payment',
        amount: paysOld,
        expenseId: expense.id,
        shiftId,
        createdAt: expense.createdAt,
        createdBy: expense.createdBy,
        syncedAt: expense.createdAt,
      }).run()
    }
  }
}

function insertValeRow(db: AppDb, shiftId: string, vale: MobileValeImport): boolean {
  const existing = db.select({ id: employeeVales.id }).from(employeeVales).where(eq(employeeVales.id, vale.id)).get()
  if (existing) return false
  const emp = db.select({ id: employees.id }).from(employees).where(eq(employees.id, vale.employeeId)).get()
  if (!emp) {
    log.warn('[mobileSync] Vale omitido: empleado no está en cache local', { valeId: vale.id, employeeId: vale.employeeId })
    return false
  }
  const items = vale.items && vale.items.length > 0 ? JSON.stringify(vale.items) : null
  db.insert(employeeVales).values({
    id: vale.id,
    employeeId: vale.employeeId,
    shiftId,
    amount: vale.amount,
    description: vale.description ?? null,
    items,
    paidAt: vale.paidAt,
    recordedBy: vale.recordedBy,
    createdAt: vale.createdAt ?? vale.paidAt,
    syncedAt: vale.paidAt,
  }).run()
  return true
}

function insertSalaryRow(db: AppDb, shiftId: string, payment: MobileSalaryImport): boolean {
  const existing = db.select({ id: salaryPayments.id }).from(salaryPayments).where(eq(salaryPayments.id, payment.id)).get()
  if (existing) return false
  const already = db.select({ id: salaryPayments.id }).from(salaryPayments)
    .where(and(eq(salaryPayments.employeeId, payment.employeeId), eq(salaryPayments.weekStart, payment.weekStart)))
    .get()
  if (already) return false
  const emp = db.select({ id: employees.id }).from(employees).where(eq(employees.id, payment.employeeId)).get()
  if (!emp) {
    log.warn('[mobileSync] Liquidación omitida: empleado no está en cache local', {
      paymentId: payment.id,
      employeeId: payment.employeeId,
    })
    return false
  }
  const snapshot = payment.valesSnapshot && payment.valesSnapshot.length > 0
    ? JSON.stringify(payment.valesSnapshot)
    : null
  db.insert(salaryPayments).values({
    id: payment.id,
    employeeId: payment.employeeId,
    shiftId,
    amount: payment.amount,
    weekStart: payment.weekStart,
    valesDeducted: payment.valesDeducted,
    netPaid: payment.netPaid,
    notes: payment.notes ?? null,
    valesSnapshot: snapshot,
    recordedBy: payment.recordedBy,
    paidAt: payment.paidAt,
    syncedAt: payment.paidAt,
  }).run()
  return true
}

/**
 * Aplica el payload de un turno móvil sobre SQLite.
 * No marca Firestore; el caller decide `shouldMarkImported`.
 */
export function applyMobileShiftImport(
  db: AppDb,
  storeId: string,
  shiftData: MobileShiftImport,
  salesData: MobileSaleImport[],
  expensesData: MobileExpenseImport[],
  valesData: MobileValeImport[] = [],
  salaryData: MobileSalaryImport[] = [],
  ceboData: MobileCeboImport[] = [],
  merchData: MobileMerchandiseIntakeImport[] = [],
): MobileShiftImportResult {
  ensureUserCache(db, shiftData.userId, shiftData.displayName, storeId)
  for (const sale of salesData) {
    if (sale.createdBy && sale.createdBy !== shiftData.userId) {
      ensureUserCache(db, sale.createdBy, shiftData.displayName, storeId)
    }
  }
  for (const expense of expensesData) {
    if (expense.createdBy && expense.createdBy !== shiftData.userId) {
      ensureUserCache(db, expense.createdBy, shiftData.displayName, storeId)
    }
  }
  for (const vale of valesData) {
    if (vale.recordedBy && vale.recordedBy !== shiftData.userId) {
      ensureUserCache(db, vale.recordedBy, shiftData.displayName, storeId)
    }
  }
  for (const payment of salaryData) {
    if (payment.recordedBy && payment.recordedBy !== shiftData.userId) {
      ensureUserCache(db, payment.recordedBy, shiftData.displayName, storeId)
    }
  }
  for (const cebo of ceboData) {
    if (cebo.createdBy && cebo.createdBy !== shiftData.userId) {
      ensureUserCache(db, cebo.createdBy, shiftData.displayName, storeId)
    }
    if (cebo.updatedBy && cebo.updatedBy !== shiftData.userId) {
      ensureUserCache(db, cebo.updatedBy, shiftData.displayName, storeId)
    }
  }
  for (const merch of merchData) {
    if (merch.createdBy && merch.createdBy !== shiftData.userId) {
      ensureUserCache(db, merch.createdBy, shiftData.displayName, storeId)
    }
    if (merch.updatedBy && merch.updatedBy !== shiftData.userId) {
      ensureUserCache(db, merch.updatedBy, shiftData.displayName, storeId)
    }
  }

  let insertedShift = false
  let salesInserted = 0
  let salesCancelled = 0
  let expensesInserted = 0
  let valesInserted = 0
  let salaryInserted = 0
  let ceboInserted = 0
  let merchInserted = 0

  db.transaction(tx => {
    const existing = tx.select().from(shifts).where(eq(shifts.id, shiftData.id)).get()
    if (!existing) {
      tx.insert(shifts).values({
        id: shiftData.id,
        storeId,
        userId: shiftData.userId,
        shiftType: shiftData.shiftType,
        startedAt: shiftData.startedAt,
        closedAt: shiftData.closedAt,
        openingCash: shiftData.openingCash,
        closingCash: shiftData.closingCash,
        source: 'mobile',
        openingCounted: shiftData.openingBillsCounted === true,
        closingCounted: shiftData.closingBillsCounted === true,
        handoverFromShiftId: shiftData.handoverFromShiftId ?? null,
        handoverFromCashierName: shiftData.handoverFromCashierName ?? null,
        handoverFromClosedAt: shiftData.handoverFromClosedAt ?? null,
      }).run()
      insertedShift = true
    } else {
      const closedAt = shiftData.closedAt ?? existing.closedAt
      const closingCash = shiftData.closingCash ?? existing.closingCash
      const closingCounted = existing.closingCounted || shiftData.closingBillsCounted === true
      const openingCounted = existing.openingCounted || shiftData.openingBillsCounted === true
      if (
        closedAt !== existing.closedAt
        || closingCash !== existing.closingCash
        || closingCounted !== existing.closingCounted
        || openingCounted !== existing.openingCounted
      ) {
        tx.update(shifts)
          .set({ closedAt, closingCash, closingCounted, openingCounted })
          .where(eq(shifts.id, shiftData.id))
          .run()
      }
    }

    const t = tx as unknown as AppDb
    if (!existing?.openingCounted) {
      insertBillLinesIfNone(t, shiftData.id, 'opening', parseBillLines(shiftData.openingBills))
      insertBillLinesIfNone(t, shiftData.id, 'expected', parseBillLines(shiftData.handoverExpectedBills))
    }
    if (!existing?.closingCounted) {
      insertBillLinesIfNone(t, shiftData.id, 'closing', parseBillLines(shiftData.closingBills))
    }

    for (const sale of salesData) {
      const existingSale = tx.select().from(sales).where(eq(sales.id, sale.id)).get()
      const incomingStatus = coerceSaleStatus(sale.status)
      if (!existingSale) {
        insertSaleRow(tx as unknown as AppDb, storeId, shiftData.id, sale)
        salesInserted += 1
        continue
      }
      if (existingSale.status !== 'cancelled' && incomingStatus === 'cancelled') {
        tx.update(sales).set({ status: 'cancelled' }).where(eq(sales.id, sale.id)).run()
        insertDebtCancelled(tx as unknown as AppDb, sale.id, sale.createdBy)
        salesCancelled += 1
      }
    }

    for (const expense of expensesData) {
      const existingExp = tx.select().from(expenses).where(eq(expenses.id, expense.id)).get()
      if (existingExp) continue
      const providerId = expense.providerId?.trim() || null
      const providerName = (expense.providerName ?? '').trim()
      if (providerId && providerName) {
        upsertProvider(tx as unknown as AppDb, providerId, providerName, expense.createdAt, expense.createdBy)
      }
      const kind = coerceExpenseKind(expense.kind)
      const injectReason = kind === 'inject' ? coerceInjectReason(expense.injectReason) : null
      tx.insert(expenses).values({
        id: expense.id,
        storeId,
        shiftId: shiftData.id,
        kind,
        concept: kind === 'inject'
          ? (expense.concept?.trim() || injectConceptForReason(injectReason ?? 'aporte'))
          : expense.concept,
        injectReason,
        providerId,
        amount: expense.amount,
        notes: expense.notes,
        createdAt: expense.createdAt,
        createdBy: expense.createdBy,
        syncedAt: null,
      }).run()
      insertProviderLedger(tx as unknown as AppDb, storeId, shiftData.id, expense)
      expensesInserted += 1
    }

    for (const vale of valesData) {
      if (insertValeRow(tx as unknown as AppDb, shiftData.id, vale)) valesInserted += 1
    }
    for (const payment of salaryData) {
      if (insertSalaryRow(tx as unknown as AppDb, shiftData.id, payment)) salaryInserted += 1
    }
    for (const cebo of ceboData) {
      const existingCebo = tx.select().from(ceboEntries).where(eq(ceboEntries.id, cebo.id)).get()
      if (existingCebo) continue
      const kg = Number(cebo.quantityKg)
      if (!Number.isFinite(kg) || kg <= 0) continue
      tx.insert(ceboEntries).values({
        id: cebo.id,
        storeId,
        shiftId: shiftData.id,
        quantityKg: kg,
        notes: cebo.notes,
        createdBy: cebo.createdBy,
        createdAt: cebo.createdAt,
        updatedBy: cebo.updatedBy ?? null,
        updatedAt: cebo.updatedAt ?? null,
        syncedAt: null,
      }).run()
      ceboInserted += 1
    }
    for (const merch of merchData) {
      if (merch.status === 'draft') continue
      const existingMerch = tx.select().from(merchandiseIntakes).where(eq(merchandiseIntakes.id, merch.id)).get()
      if (existingMerch) continue
      const lines = parseMerchLinesFromUnknown(merch.lines, {
        intakeId: merch.id,
        category: merch.category,
        unit: merch.unit,
        quantity: merch.quantity,
      })
      if (lines.length === 0) continue
      const paymentKind = coerceMerchIntakePaymentKind(merch.paymentKind) ?? 'none'
      const providerId = merch.providerId?.trim() || null
      const providerName = (merch.providerName ?? '').trim() || null
      if (providerId && providerName) {
        upsertProvider(tx as unknown as AppDb, providerId, providerName, merch.createdAt, merch.createdBy)
      }
      const paidAmount = Number(merch.paidAmount)
      const debtAmount = Number(merch.debtAmount)
      tx.insert(merchandiseIntakes).values({
        id: merch.id,
        storeId,
        shiftId: shiftData.id,
        notes: merch.notes,
        paymentKind,
        paidAmount: Number.isFinite(paidAmount) ? Math.max(0, Math.round(paidAmount)) : 0,
        debtAmount: Number.isFinite(debtAmount) ? Math.max(0, Math.round(debtAmount)) : 0,
        providerId,
        providerName,
        expenseId: merch.expenseId?.trim() || null,
        status: 'confirmed',
        createdBy: merch.createdBy,
        createdAt: merch.createdAt,
        updatedBy: merch.updatedBy ?? null,
        updatedAt: merch.updatedAt ?? null,
        syncedAt: null,
      }).run()
      for (const line of lines) {
        tx.insert(merchandiseIntakeLines).values(snapshotToDbLine(merch.id, line)).run()
      }
      merchInserted += 1
    }
  })

  return {
    insertedShift,
    salesInserted,
    salesCancelled,
    expensesInserted,
    valesInserted,
    salaryInserted,
    ceboInserted,
    merchInserted,
    shouldMarkImported: shouldMarkMobileShiftImported(shiftData.closedAt),
  }
}
