/**
 * Armado de filas locales de vale / liquidación (sin I/O).
 * La persistencia vive en Dexie; el sync sube a Firestore.
 */
import type {
  CachedEmployee,
  LocalExpense,
  LocalSalaryPayment,
  LocalVale,
  SalaryValeSnapshotItem,
  ValeItem,
} from '../types/pos'

export function valeExpenseConcept(employeeName: string): string {
  return `Vale: ${employeeName}`.slice(0, 80)
}

export function salaryExpenseConcept(employeeName: string): string {
  return `Salario: ${employeeName}`.slice(0, 80)
}

export function buildCashValeRecords(input: {
  valeId: string
  expenseId: string
  employee: CachedEmployee
  shiftId: string
  storeId: string
  amount: number
  description: string | null
  recordedBy: string
  now: string
}): { vale: LocalVale; expense: LocalExpense } {
  const { valeId, expenseId, employee, shiftId, storeId, amount, description, recordedBy, now } = input
  return {
    vale: {
      id: valeId,
      employeeId: employee.id,
      employeeName: employee.name,
      shiftId,
      storeId,
      amount,
      description,
      items: null,
      paidAt: now,
      recordedBy,
      createdAt: now,
      syncStatus: 'pending',
      syncedAt: null,
    },
    expense: {
      id: expenseId,
      shiftId,
      storeId,
      kind: 'expense',
      concept: valeExpenseConcept(employee.name),
      amount,
      notes: description,
      createdAt: now,
      createdBy: recordedBy,
      syncStatus: 'pending',
      syncedAt: null,
    },
  }
}

export function buildProductValeRecord(input: {
  valeId: string
  employee: CachedEmployee
  shiftId: string
  storeId: string
  items: ValeItem[]
  recordedBy: string
  now: string
}): LocalVale {
  const amount = input.items.reduce((sum, item) => sum + item.subtotal, 0)
  return {
    id: input.valeId,
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    shiftId: input.shiftId,
    storeId: input.storeId,
    amount,
    description: null,
    items: input.items,
    paidAt: input.now,
    recordedBy: input.recordedBy,
    createdAt: input.now,
    syncStatus: 'pending',
    syncedAt: null,
  }
}

export function buildSalaryPayRecords(input: {
  paymentId: string
  expenseId: string
  employee: CachedEmployee
  shiftId: string
  storeId: string
  weekStart: string
  amount: number
  valesDeducted: number
  notes: string | null
  valesSnapshot: SalaryValeSnapshotItem[] | null
  recordedBy: string
  now: string
}): { payment: LocalSalaryPayment; expense: LocalExpense | null } {
  const netPaid = input.amount - input.valesDeducted
  const baseNotes = input.valesDeducted > 0
    ? `Semana ${input.weekStart}. Bruto ${input.amount}, vales ${input.valesDeducted}, neto ${netPaid}.`
    : `Semana ${input.weekStart}. Neto ${netPaid}.`
  const expenseNotes = input.notes ? `${baseNotes} ${input.notes}`.slice(0, 500) : baseNotes

  const payment: LocalSalaryPayment = {
    id: input.paymentId,
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    shiftId: input.shiftId,
    storeId: input.storeId,
    amount: input.amount,
    weekStart: input.weekStart,
    valesDeducted: input.valesDeducted,
    netPaid,
    notes: input.notes,
    valesSnapshot: input.valesSnapshot,
    recordedBy: input.recordedBy,
    paidAt: input.now,
    syncStatus: 'pending',
    syncedAt: null,
  }

  if (netPaid <= 0) return { payment, expense: null }

  return {
    payment,
    expense: {
      id: input.expenseId,
      shiftId: input.shiftId,
      storeId: input.storeId,
      kind: 'expense',
      concept: salaryExpenseConcept(input.employee.name),
      amount: netPaid,
      notes: expenseNotes,
      createdAt: input.now,
      createdBy: input.recordedBy,
      syncStatus: 'pending',
      syncedAt: null,
    },
  }
}
