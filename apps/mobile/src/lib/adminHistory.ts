/**
 * Lectura admin desde Firestore (turnos y ventas operativos).
 *
 * Paths:
 *   licenses/{tenantId}/stores/{storeId}
 *   licenses/{tenantId}/shifts/{shiftId}
 *   licenses/{tenantId}/sales/{saleId}
 *
 * Solo lectura. Los admins no operan el POS desde esta capa.
 */
import { getFirestore, collection, getDocs } from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import type { PaymentMethod, ShiftType } from '../types/pos'

const firestore = getFirestore(firebaseApp)

export interface AdminStore {
  id: string
  name: string
  archivedAt: string | null
}

export interface AdminShift {
  id: string
  storeId: string
  userId: string
  cashierName: string
  shiftType: ShiftType
  startedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
}

export interface AdminSalePayment {
  paymentMethod: PaymentMethod
  amount: number
}

export interface AdminSaleItem {
  productName: string
  quantity: number
  unitPrice: number
  subtotal: number
}

export interface AdminSale {
  id: string
  shiftId: string
  total: number
  status: string
  createdAt: string
  items: AdminSaleItem[]
  payments: AdminSalePayment[]
}

export type PaymentTotals = Record<PaymentMethod, number> & { total: number }

const EMPTY_TOTALS: PaymentTotals = {
  cash: 0,
  debit: 0,
  wallet: 0,
  credit: 0,
  total: 0,
}

/** Agrega montos por medio de pago (puro, testeable). */
export function sumPaymentTotals(sales: AdminSale[]): PaymentTotals {
  const totals: PaymentTotals = { ...EMPTY_TOTALS }
  for (const sale of sales) {
    if (sale.status !== 'confirmed') continue
    for (const p of sale.payments) {
      totals[p.paymentMethod] += p.amount
      totals.total += p.amount
    }
  }
  return totals
}

export async function fetchAdminStores(): Promise<AdminStore[]> {
  const snap = await getDocs(collection(firestore, 'licenses', LICENSE_KEY, 'stores'))
  const stores: AdminStore[] = []
  for (const d of snap.docs) {
    const data = d.data() as {
      id?: string
      name?: string
      archivedAt?: string | null
    }
    const archivedAt = data.archivedAt ?? null
    if (archivedAt) continue
    stores.push({
      id: data.id ?? d.id,
      name: data.name ?? d.id,
      archivedAt,
    })
  }
  stores.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return stores
}

/**
 * Turnos del local, más recientes primero.
 * Incluye abiertos y cerrados (útil para ver en vivo el turno de la cajera).
 */
export async function fetchAdminShifts(storeId: string): Promise<AdminShift[]> {
  const snap = await getDocs(collection(firestore, 'licenses', LICENSE_KEY, 'shifts'))
  const shifts: AdminShift[] = []
  for (const d of snap.docs) {
    const data = d.data() as {
      id?: string
      storeId?: string
      userId?: string
      cashierName?: string | null
      shiftType?: ShiftType
      startedAt?: string
      closedAt?: string | null
      openingCash?: number
      closingCash?: number | null
      source?: string
    }
    if (data.storeId !== storeId) continue
    // Solo turnos operativos de PC (mismo criterio que historyFirestore desktop).
    if (data.source && data.source !== 'desktop') continue
    const userId = data.userId ?? ''
    shifts.push({
      id: data.id ?? d.id,
      storeId: data.storeId,
      userId,
      cashierName: data.cashierName?.trim() || userId,
      shiftType: data.shiftType === 'evening' ? 'evening' : 'morning',
      startedAt: data.startedAt ?? '',
      closedAt: data.closedAt ?? null,
      openingCash: data.openingCash ?? 0,
      closingCash: data.closingCash ?? null,
    })
  }
  shifts.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return shifts
}

export async function fetchAdminSalesForShift(shiftId: string): Promise<AdminSale[]> {
  const snap = await getDocs(collection(firestore, 'licenses', LICENSE_KEY, 'sales'))
  const sales: AdminSale[] = []
  for (const d of snap.docs) {
    const data = d.data() as {
      id?: string
      shiftId?: string
      total?: number
      status?: string
      createdAt?: string
      items?: Array<{
        productName?: string | null
        quantity?: number
        unitPrice?: number
        subtotal?: number
      }>
      payments?: Array<{
        paymentMethod?: PaymentMethod
        amount?: number
      }>
    }
    if (data.shiftId !== shiftId) continue
    sales.push({
      id: data.id ?? d.id,
      shiftId,
      total: data.total ?? 0,
      status: data.status ?? 'confirmed',
      createdAt: data.createdAt ?? '',
      items: (data.items ?? []).map(i => ({
        productName: i.productName ?? '(producto)',
        quantity: i.quantity ?? 0,
        unitPrice: i.unitPrice ?? 0,
        subtotal: i.subtotal ?? 0,
      })),
      payments: (data.payments ?? [])
        .filter((p): p is { paymentMethod: PaymentMethod; amount: number } =>
          p.paymentMethod != null && typeof p.amount === 'number',
        )
        .map(p => ({ paymentMethod: p.paymentMethod, amount: p.amount })),
    })
  }
  sales.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return sales
}
