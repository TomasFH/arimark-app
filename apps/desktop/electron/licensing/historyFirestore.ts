/**
 * Lectura de historial operativo desde Firestore (turnos, ventas, gastos).
 *
 * Usado por el panel admin cuando la PC no tiene (o no tiene completo)
 * el SQLite del local — ej. admin desde casa.
 *
 * Paths:
 *   licenses/{tenantId}/shifts/{shiftId}
 *   licenses/{tenantId}/sales/{saleId}
 *   licenses/{tenantId}/expenses/{expenseId}
 */

import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore'
import log from 'electron-log'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getBusinessConfig } from '../businessConfig'
import type {
  HistoryShiftRow,
  HistoryShiftDetail,
  HistorySaleRow,
  HistoryExpenseRow,
  ShiftType,
} from '../../src/types/hw-api'

interface FsShift {
  id: string
  storeId: string
  userId: string
  cashierName?: string | null
  shiftType: ShiftType
  startedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  deliveredAmount: number | null
  deliveredTo: string | null
  notes: string | null
  source?: string
}

interface FsSaleItem {
  productName?: string | null
  quantity: number
  unitPrice: number
  subtotal: number
}

interface FsSalePayment {
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit'
  amount: number
}

interface FsSale {
  id: string
  shiftId: string
  storeId: string
  total: number
  status: string
  isDebt: boolean
  manualEntry: boolean
  createdAt: string
  items?: FsSaleItem[]
  payments?: FsSalePayment[]
}

interface FsExpense {
  id: string
  shiftId: string
  concept?: string | null
  providerName?: string | null
  amount: number
  notes?: string | null
  createdAt: string
  createdBy: string
  deleted?: boolean
}

export interface HistoryShiftsFilter {
  fromDate?: string
  toDate?: string
  effectiveStoreId: string | null
}

function saleToHistoryRow(s: FsSale): HistorySaleRow {
  const payments = s.payments ?? []
  const cashAmount = payments.filter(p => p.paymentMethod === 'cash').reduce((a, p) => a + p.amount, 0)
  const digitalAmount = payments.filter(p => p.paymentMethod !== 'cash').reduce((a, p) => a + p.amount, 0)
  const methods = [...new Set(payments.map(p => p.paymentMethod))]
  return {
    id: s.id,
    createdAt: s.createdAt,
    total: s.total,
    status: s.status === 'cancelled' ? 'cancelled' : 'confirmed',
    cashAmount,
    digitalAmount,
    paymentMethods: methods,
    manualEntry: s.manualEntry ?? false,
    isDebt: s.isDebt ?? false,
    customerName: null,
    items: (s.items ?? []).map(i => ({
      productName: i.productName ?? '(producto)',
      quantity: i.quantity,
      unit: 'kg' as const,
      unitPrice: i.unitPrice,
      subtotal: i.subtotal,
    })),
  }
}

/**
 * Lista turnos cerrados desde Firestore con resumen de ventas/gastos.
 * No incluye señas ni fiados (aún no sincronizados).
 */
export async function fetchHistoryShiftsFromFirestore(
  filter: HistoryShiftsFilter,
): Promise<HistoryShiftRow[]> {
  if (!isFirebaseAvailable()) return []

  const config = getBusinessConfig()
  const app = getFirebaseApp()
  const firestore = getFirestore(app)

  const [shiftsSnap, salesSnap, expensesSnap] = await Promise.all([
    getDocs(collection(firestore, 'licenses', config.tenant_id, 'shifts')),
    getDocs(collection(firestore, 'licenses', config.tenant_id, 'sales')),
    getDocs(collection(firestore, 'licenses', config.tenant_id, 'expenses')),
  ])

  const shifts: FsShift[] = []
  for (const d of shiftsSnap.docs) {
    const s = d.data() as FsShift
    if (!s.closedAt) continue
    if (s.source && s.source !== 'desktop') continue
    if (filter.effectiveStoreId && s.storeId !== filter.effectiveStoreId) continue
    if (filter.fromDate && s.startedAt < filter.fromDate) continue
    if (filter.toDate && s.startedAt > filter.toDate + 'T23:59:59.999Z') continue
    shifts.push({ ...s, id: s.id ?? d.id })
  }

  const salesByShift = new Map<string, { count: number; total: number; cash: number }>()
  for (const d of salesSnap.docs) {
    const s = d.data() as FsSale
    if (s.status !== 'confirmed') continue
    const entry = salesByShift.get(s.shiftId) ?? { count: 0, total: 0, cash: 0 }
    entry.count += 1
    entry.total += s.total
    entry.cash += (s.payments ?? [])
      .filter(p => p.paymentMethod === 'cash')
      .reduce((a, p) => a + p.amount, 0)
    salesByShift.set(s.shiftId, entry)
  }

  const expensesByShift = new Map<string, number>()
  for (const d of expensesSnap.docs) {
    const e = d.data() as FsExpense
    if (e.deleted === true) continue
    expensesByShift.set(e.shiftId, (expensesByShift.get(e.shiftId) ?? 0) + e.amount)
  }

  return shifts.map(s => {
    const sv = salesByShift.get(s.id) ?? { count: 0, total: 0, cash: 0 }
    const exp = expensesByShift.get(s.id) ?? 0
    return {
      id: s.id,
      shiftType: s.shiftType,
      startedAt: s.startedAt,
      closedAt: s.closedAt!,
      cashierName: s.cashierName ?? s.userId,
      salesCount: sv.count,
      totalRevenue: sv.total,
      totalCashSales: sv.cash,
      totalExpenses: exp,
      cashInHand: s.openingCash + sv.cash - exp,
      totalDeposits: 0,
    }
  })
}

/** Preferir filas locales (más completas) ante el mismo id. */
export function mergeHistoryShiftRows(
  local: HistoryShiftRow[],
  remote: HistoryShiftRow[],
): HistoryShiftRow[] {
  const byId = new Map<string, HistoryShiftRow>()
  for (const r of remote) byId.set(r.id, r)
  for (const l of local) byId.set(l.id, l)
  return Array.from(byId.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/**
 * Detalle de un turno desde Firestore. null si no existe.
 */
export async function fetchHistoryShiftDetailFromFirestore(
  shiftId: string,
): Promise<HistoryShiftDetail | null> {
  if (!isFirebaseAvailable()) return null

  const config = getBusinessConfig()
  const app = getFirebaseApp()
  const firestore = getFirestore(app)

  try {
    const shiftRef = doc(firestore, 'licenses', config.tenant_id, 'shifts', shiftId)
    const shiftSnap = await getDoc(shiftRef)
    if (!shiftSnap.exists()) return null

    const shift = { ...(shiftSnap.data() as FsShift), id: shiftId }
    if (!shift.closedAt) return null

    const [salesSnap, expensesSnap] = await Promise.all([
      getDocs(collection(firestore, 'licenses', config.tenant_id, 'sales')),
      getDocs(collection(firestore, 'licenses', config.tenant_id, 'expenses')),
    ])

    const historySales: HistorySaleRow[] = []
    let totalDebitSales = 0
    let totalWalletSales = 0
    let totalCreditSales = 0
    for (const d of salesSnap.docs) {
      const s = { ...(d.data() as FsSale), id: (d.data() as FsSale).id ?? d.id }
      if (s.shiftId !== shiftId) continue
      historySales.push(saleToHistoryRow(s))
      if (s.status === 'confirmed') {
        for (const p of s.payments ?? []) {
          if (p.paymentMethod === 'debit') totalDebitSales += p.amount
          else if (p.paymentMethod === 'wallet') totalWalletSales += p.amount
          else if (p.paymentMethod === 'credit') totalCreditSales += p.amount
        }
      }
    }
    historySales.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const historyExpenses: HistoryExpenseRow[] = []
    for (const d of expensesSnap.docs) {
      const e = d.data() as FsExpense
      if (e.shiftId !== shiftId) continue
      if (e.deleted === true) continue
      historyExpenses.push({
        id: e.id ?? d.id,
        createdAt: e.createdAt,
        concept: e.concept ?? undefined,
        provider: e.providerName ?? undefined,
        amount: e.amount,
        notes: e.notes ?? null,
        createdBy: e.createdBy,
      })
    }
    historyExpenses.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const confirmedSales = historySales.filter(s => s.status === 'confirmed')
    const totalRevenue = confirmedSales.reduce((a, s) => a + s.total, 0)
    const totalCashSales = confirmedSales.reduce((a, s) => a + s.cashAmount, 0)
    const totalExpenses = historyExpenses.reduce((a, e) => a + e.amount, 0)

    return {
      shift: {
        id: shift.id,
        shiftType: shift.shiftType,
        startedAt: shift.startedAt,
        closedAt: shift.closedAt,
        cashierName: shift.cashierName ?? shift.userId,
        openingCash: shift.openingCash,
        closingCash: shift.closingCash,
        deliveredAmount: shift.deliveredAmount,
        deliveredTo: shift.deliveredTo,
        notes: shift.notes,
      },
      sales: historySales,
      expenses: historyExpenses,
      debts: [],
      deposits: [],
      summary: {
        salesCount: confirmedSales.length,
        totalRevenue,
        totalCashSales,
        totalDebitSales,
        totalWalletSales,
        totalCreditSales,
        totalExpenses,
        cashDeposits: 0,
        digitalDeposits: 0,
        cashInHand: shift.openingCash + totalCashSales - totalExpenses,
        debtsCount: 0,
        totalDebts: 0,
      },
    }
  } catch (err) {
    log.error('[historyFirestore] Error al leer detalle de turno', { shiftId, err })
    return null
  }
}
