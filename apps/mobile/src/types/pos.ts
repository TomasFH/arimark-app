/**
 * Tipos compartidos del POS móvil offline.
 * Usados tanto en la capa de persistencia (db.ts) como en los componentes de UI.
 */

export type PaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'
export type ShiftType = 'morning' | 'evening'
export type SyncStatus = 'pending' | 'synced' | 'error'
export type SaleStatus = 'confirmed' | 'cancelled'
export type ExpenseKind = 'expense' | 'inject'

/**
 * Concepto persistido de un ingreso de efectivo a caja.
 * La UI dice “Ingreso”; el valor en DB/Firestore sigue siendo este
 * para no romper historial ni el import de la PC.
 */
export const CASH_INJECT_CONCEPT = 'Aporte'

export interface LocalProfile {
  uid: string
  displayName: string
  role: 'cashier' | 'admin' | 'butcher'
  authorizedStores: string[]
  /** Email para reautenticar al recuperar conexión. */
  email: string
  /** FK al empleado en SQLite de la PC. Solo para carniceros. */
  employeeId?: string
}

export interface CatalogProduct {
  productId: string
  pluNumber: number
  name: string
  category: string
  unit: 'kg' | 'unit'
  /** Precio vigente en pesos (no centavos). */
  price: number
}

export interface LocalShift {
  /** UUID generado en el celular — fuente de verdad del ID. */
  id: string
  storeId: string
  userId: string
  displayName: string
  shiftType: ShiftType
  startedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  syncStatus: SyncStatus
  syncedAt: string | null
}

export interface SaleItemDraft {
  productId: string
  productName: string
  pluNumber: number | null
  quantity: number
  unitPrice: number
  subtotal: number
  /** Presente cuando se trata de un producto por kg. */
  weightKg: number | null
  manualEntry: boolean
}

export interface SalePaymentDraft {
  paymentMethod: PaymentMethod
  amount: number
}

export interface LocalSale {
  id: string
  shiftId: string
  storeId: string
  total: number
  items: SaleItemDraft[]
  payments: SalePaymentDraft[]
  notes: string | null
  manualEntry: boolean
  createdAt: string
  createdBy: string
  syncStatus: SyncStatus
  syncedAt: string | null
  /**
   * Ausente en ventas guardadas antes del pack de emergencia:
   * se trata como `'confirmed'`.
   */
  status?: SaleStatus
  isDebt?: boolean
  customerId?: string | null
  customerName?: string | null
  customerPhone?: string | null
}

export interface LocalExpense {
  id: string
  shiftId: string
  storeId: string
  kind: ExpenseKind
  concept: string | null
  amount: number
  notes: string | null
  createdAt: string
  createdBy: string
  syncStatus: SyncStatus
  syncedAt: string | null
  providerId?: string | null
  providerName?: string | null
  newDebtAmount?: number | null
  paysOldDebt?: number | null
}

export interface CachedProvider {
  id: string
  name: string
  archivedAt: string | null
  updatedAt: string
}

export interface CachedEmployee {
  id: string
  name: string
  weeklyWage: number
  kind: 'butcher' | 'cashier'
  homeStoreId: string | null
  archivedAt: string | null
  updatedAt: string
}

export interface ValeItem {
  productId: string
  productName: string
  unit: 'kg' | 'unit'
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface LocalVale {
  id: string
  employeeId: string
  employeeName: string
  shiftId: string
  storeId: string
  amount: number
  description: string | null
  items: ValeItem[] | null
  paidAt: string
  recordedBy: string
  createdAt: string
  syncStatus: SyncStatus
  syncedAt: string | null
}

export interface SalaryValeSnapshotItem {
  id: string
  amount: number
  description: string | null
  paidAt: string
}

export interface LocalSalaryPayment {
  id: string
  employeeId: string
  employeeName: string
  shiftId: string
  storeId: string
  amount: number
  weekStart: string
  valesDeducted: number
  netPaid: number
  notes: string | null
  valesSnapshot: SalaryValeSnapshotItem[] | null
  recordedBy: string
  paidAt: string
  syncStatus: SyncStatus
  syncedAt: string | null
}

export interface LocalProviderDebtEvent {
  id: string
  expenseId: string
  shiftId: string
  storeId: string
  providerId: string
  providerName: string
  type: 'debt' | 'payment'
  amount: number
  createdAt: string
  createdBy: string
  syncStatus: SyncStatus
  syncedAt: string | null
}
