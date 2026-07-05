/**
 * Tipos compartidos del POS móvil offline.
 * Usados tanto en la capa de persistencia (db.ts) como en los componentes de UI.
 */

export type PaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'
export type ShiftType = 'morning' | 'evening'
export type SyncStatus = 'pending' | 'synced' | 'error'

export interface LocalProfile {
  uid: string
  displayName: string
  role: 'cashier' | 'admin'
  authorizedStores: string[]
  /** Email para reautenticar al recuperar conexión. */
  email: string
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
}
