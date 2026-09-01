/**
 * Payloads puros del sync celular → Firestore.
 * Sin Firebase: se testean y los consume `sync.ts`.
 */
import { CASH_INJECT_CONCEPT } from '../types/pos'
import type {
  LocalExpense,
  LocalProviderDebtEvent,
  LocalSalaryPayment,
  LocalSale,
  LocalShift,
  LocalVale,
  SalePaymentDraft,
} from '../types/pos'
import { resolvedSaleStatus } from './shiftCash'

export function isInitialShiftUpload(syncedAt: string | null): boolean {
  return syncedAt === null
}

export function collectShiftIdsToSync(
  shiftsPending: Array<{ id: string }>,
  salesPending: Array<{ shiftId: string }>,
  expensesPending: Array<{ shiftId: string }>,
  extraPending: Array<{ shiftId: string }> = [],
): string[] {
  const ids = new Set<string>()
  for (const shift of shiftsPending) ids.add(shift.id)
  for (const sale of salesPending) ids.add(sale.shiftId)
  for (const expense of expensesPending) ids.add(expense.shiftId)
  for (const extra of extraPending) ids.add(extra.shiftId)
  return [...ids]
}

export interface ShiftFirestorePayload {
  id: string
  storeId: string
  userId: string
  displayName: string
  shiftType: LocalShift['shiftType']
  startedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  source: 'mobile'
  updatedAt: string
  importedAt?: null
}

export function buildShiftFirestorePayload(
  shift: LocalShift,
  updatedAt: string,
  isCreate: boolean,
): ShiftFirestorePayload {
  const base: ShiftFirestorePayload = {
    id: shift.id,
    storeId: shift.storeId,
    userId: shift.userId,
    displayName: shift.displayName,
    shiftType: shift.shiftType,
    startedAt: shift.startedAt,
    closedAt: shift.closedAt,
    openingCash: shift.openingCash,
    closingCash: shift.closingCash,
    source: 'mobile',
    updatedAt,
  }
  if (isCreate) {
    return { ...base, importedAt: null }
  }
  return base
}

/** Copia operativa para el historial admin (`licenses/{key}/shifts/{id}`). */
export interface ShiftOpsPayload {
  id: string
  storeId: string
  userId: string
  cashierName: string
  displayName: string
  shiftType: LocalShift['shiftType']
  startedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  source: 'mobile'
  updatedAt: string
}

export function buildShiftOpsPayload(shift: LocalShift, updatedAt: string): ShiftOpsPayload {
  return {
    id: shift.id,
    storeId: shift.storeId,
    userId: shift.userId,
    cashierName: shift.displayName,
    displayName: shift.displayName,
    shiftType: shift.shiftType,
    startedAt: shift.startedAt,
    closedAt: shift.closedAt,
    openingCash: shift.openingCash,
    closingCash: shift.closingCash,
    source: 'mobile',
    updatedAt,
  }
}

export interface SaleFirestorePayload {
  id: string
  shiftId: string
  total: number
  items: LocalSale['items']
  payments: LocalSale['payments']
  notes: string | null
  manualEntry: boolean
  createdAt: string
  createdBy: string
  status: 'confirmed' | 'cancelled'
  isDebt: boolean
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  importedAt: null
}

export function buildSaleFirestorePayload(sale: LocalSale): SaleFirestorePayload {
  return {
    id: sale.id,
    shiftId: sale.shiftId,
    total: sale.total,
    items: sale.items,
    payments: sale.payments,
    notes: sale.notes,
    manualEntry: sale.manualEntry,
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
    status: resolvedSaleStatus(sale),
    isDebt: sale.isDebt === true,
    customerId: sale.customerId ?? null,
    customerName: sale.customerName ?? null,
    customerPhone: sale.customerPhone ?? null,
    importedAt: null,
  }
}

/** Copia operativa para el historial admin (`licenses/{key}/sales/{id}`). */
export interface SaleOpsPayload {
  id: string
  storeId: string
  shiftId: string
  total: number
  items: LocalSale['items']
  payments: LocalSale['payments']
  notes: string | null
  manualEntry: boolean
  createdAt: string
  createdBy: string
  status: 'confirmed' | 'cancelled'
  isDebt: boolean
  customerId: string | null
}

export function buildSaleOpsPayload(sale: LocalSale): SaleOpsPayload {
  const staging = buildSaleFirestorePayload(sale)
  return {
    id: staging.id,
    storeId: sale.storeId,
    shiftId: staging.shiftId,
    total: staging.total,
    items: staging.items,
    payments: staging.payments,
    notes: staging.notes,
    manualEntry: staging.manualEntry,
    createdAt: staging.createdAt,
    createdBy: staging.createdBy,
    status: staging.status,
    isDebt: staging.isDebt,
    customerId: staging.customerId,
  }
}

export interface ExpenseStagingPayload {
  id: string
  shiftId: string
  storeId: string
  kind: LocalExpense['kind']
  concept: string | null
  amount: number
  notes: string | null
  createdAt: string
  createdBy: string
  importedAt: null
  providerId: string | null
  providerName: string | null
  newDebtAmount: number
  paysOldDebt: number
}

export function buildExpenseStagingPayload(expense: LocalExpense): ExpenseStagingPayload {
  return {
    id: expense.id,
    shiftId: expense.shiftId,
    storeId: expense.storeId,
    kind: expense.kind,
    concept: expense.concept,
    amount: expense.amount,
    notes: expense.notes,
    createdAt: expense.createdAt,
    createdBy: expense.createdBy,
    importedAt: null,
    providerId: expense.providerId ?? null,
    providerName: expense.providerName ?? null,
    newDebtAmount: expense.newDebtAmount ?? 0,
    paysOldDebt: expense.paysOldDebt ?? 0,
  }
}

/** Copia operativa para el historial admin (`licenses/{key}/expenses/{id}`). */
export interface ExpenseOpsPayload {
  id: string
  storeId: string
  shiftId: string
  kind: LocalExpense['kind']
  concept: string | null
  amount: number
  notes: string | null
  createdAt: string
  createdBy: string
  deleted: false
  providerId: string | null
  providerName: string | null
}

export function buildExpenseOpsPayload(expense: LocalExpense): ExpenseOpsPayload {
  const concept = expense.kind === 'inject'
    ? (expense.concept ?? CASH_INJECT_CONCEPT)
    : expense.concept
  return {
    id: expense.id,
    storeId: expense.storeId,
    shiftId: expense.shiftId,
    kind: expense.kind,
    concept,
    amount: expense.amount,
    notes: expense.notes,
    createdAt: expense.createdAt,
    createdBy: expense.createdBy,
    deleted: false,
    providerId: expense.providerId ?? null,
    providerName: expense.providerName ?? null,
  }
}

export interface ValeOpsPayload {
  id: string
  employeeId: string
  employeeName: string
  storeId: string
  shiftId: string
  amount: number
  description: string | null
  items: LocalVale['items']
  paidAt: string
  recordedBy: string
  createdAt: string
  cancelledAt: null
  cancelledBy: null
  deleted: false
  source: 'mobile'
  importedAt: null
}

export function buildValeOpsPayload(vale: LocalVale): ValeOpsPayload {
  return {
    id: vale.id,
    employeeId: vale.employeeId,
    employeeName: vale.employeeName,
    storeId: vale.storeId,
    shiftId: vale.shiftId,
    amount: vale.amount,
    description: vale.description,
    items: vale.items,
    paidAt: vale.paidAt,
    recordedBy: vale.recordedBy,
    createdAt: vale.createdAt,
    cancelledAt: null,
    cancelledBy: null,
    deleted: false,
    source: 'mobile',
    importedAt: null,
  }
}

export interface SalaryPaymentOpsPayload {
  id: string
  employeeId: string
  employeeName: string
  shiftId: string
  storeId: string
  amount: number
  weekStart: string
  valesDeducted: number
  netPaid: number
  recordedBy: string
  paidAt: string
  notes: string | null
  valesSnapshot: LocalSalaryPayment['valesSnapshot']
  deleted: false
  source: 'mobile'
  importedAt: null
}

export function buildSalaryPaymentOpsPayload(payment: LocalSalaryPayment): SalaryPaymentOpsPayload {
  return {
    id: payment.id,
    employeeId: payment.employeeId,
    employeeName: payment.employeeName,
    shiftId: payment.shiftId,
    storeId: payment.storeId,
    amount: payment.amount,
    weekStart: payment.weekStart,
    valesDeducted: payment.valesDeducted,
    netPaid: payment.netPaid,
    recordedBy: payment.recordedBy,
    paidAt: payment.paidAt,
    notes: payment.notes,
    valesSnapshot: payment.valesSnapshot,
    deleted: false,
    source: 'mobile',
    importedAt: null,
  }
}

export interface ProviderOpsPayload {
  id: string
  name: string
  nameKey: string
  archivedAt: null
  deleted: false
  createdAt: string
  createdBy: string
}

export function buildProviderOpsPayload(input: {
  id: string
  name: string
  nameKey: string
  createdAt: string
  createdBy: string
}): ProviderOpsPayload {
  return {
    id: input.id,
    name: input.name,
    nameKey: input.nameKey,
    archivedAt: null,
    deleted: false,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  }
}

export interface ProviderDebtEventOpsPayload {
  id: string
  storeId: string
  providerId: string
  provider: string
  type: 'debt' | 'payment'
  amount: number
  expenseId: string
  shiftId: string
  createdAt: string
  createdBy: string
  description: null
  notes: null
  source: 'mobile'
}

export function buildProviderDebtEventOpsPayload(
  event: LocalProviderDebtEvent,
): ProviderDebtEventOpsPayload {
  return {
    id: event.id,
    storeId: event.storeId,
    providerId: event.providerId,
    provider: event.providerName,
    type: event.type,
    amount: event.amount,
    expenseId: event.expenseId,
    shiftId: event.shiftId,
    createdAt: event.createdAt,
    createdBy: event.createdBy,
    description: null,
    notes: null,
    source: 'mobile',
  }
}

export function paymentsTotal(payments: SalePaymentDraft[]): number {
  return payments.reduce((sum, p) => sum + p.amount, 0)
}

export function netDebtAmount(total: number, payments: SalePaymentDraft[]): number {
  return Math.round((total - paymentsTotal(payments)) * 100) / 100
}

export function debtEventIdForSale(saleId: string): string {
  return saleId
}

export interface CustomerFirestorePayload {
  id: string
  storeId: string
  name: string
  phone: string | null
  active: true
  createdAt: string
  createdBy: string
  deleted: false
}

export function buildCustomerFirestorePayload(sale: LocalSale): CustomerFirestorePayload | null {
  if (!sale.isDebt || !sale.customerId || !sale.customerName) return null
  return {
    id: sale.customerId,
    storeId: sale.storeId,
    name: sale.customerName,
    phone: sale.customerPhone ?? null,
    active: true,
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
    deleted: false,
  }
}

export interface DebtEventFirestorePayload {
  id: string
  customerId: string
  saleId: string
  shiftId: string
  storeId: string
  eventType: 'created'
  amount: number
  createdAt: string
  createdBy: string
  deleted: false
}

export function buildDebtEventFirestorePayload(sale: LocalSale): DebtEventFirestorePayload | null {
  if (!sale.isDebt || !sale.customerId) return null
  return {
    id: debtEventIdForSale(sale.id),
    customerId: sale.customerId,
    saleId: sale.id,
    shiftId: sale.shiftId,
    storeId: sale.storeId,
    eventType: 'created',
    amount: netDebtAmount(sale.total, sale.payments),
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
    deleted: false,
  }
}
