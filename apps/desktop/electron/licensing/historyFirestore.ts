/**
 * Lectura de historial operativo desde Firestore (turnos, ventas, gastos, vales).
 *
 * Usado por el panel admin cuando la PC no tiene (o no tiene completo)
 * el SQLite del local — ej. admin desde casa.
 *
 * Paths:
 *   licenses/{tenantId}/shifts/{shiftId}
 *   licenses/{tenantId}/sales/{saleId}
 *   licenses/{tenantId}/expenses/{expenseId}
 *   licenses/{tenantId}/employeeVales/{id}
 */

import { getFirestore, collection, getDocs, doc, getDoc, query, where, orderBy } from 'firebase/firestore'
import log from 'electron-log'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getBusinessConfig } from '../businessConfig'
import {
  cashAmountFromDeposit,
  digitalAmountFromDeposit,
  depositPaymentsToJson,
} from '../lib/depositPayments'
import type {
  HistoryShiftRow,
  HistoryShiftDetail,
  HistorySaleRow,
  HistoryExpenseRow,
  HistoryOrderRow,
  HistoryDebtRow,
  HistoryValeRow,
  RemoteEmployeeValeRow,
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
  kind?: 'expense' | 'inject'
}

interface FsOrder {
  id?: string
  customerName?: string
  phone?: string | null
  items?: string
  depositAmount?: number
  depositMethod?: string | null
  depositPayments?: unknown
  depositShiftId?: string | null
  createdAt?: string
  status?: string
  deleted?: boolean
}

interface FsDebtEvent {
  id?: string
  customerId?: string
  saleId?: string | null
  shiftId?: string | null
  amount?: number
  eventType?: string
  notes?: string | null
  createdAt?: string
  paymentMethod?: string | null
  deleted?: boolean
}

const FIRESTORE_IN_LIMIT = 30
const HISTORY_DEFAULT_DAYS = 7

export function defaultHistoryFromDate(now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - HISTORY_DEFAULT_DAYS)
  return d.toISOString().slice(0, 10)
}

function chunkIds(ids: string[], size = FIRESTORE_IN_LIMIT): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
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
 * Lista turnos desde Firestore recortados por fecha (default 7 días) y local.
 * Los totales se piden por shiftId in (...), no bajando sales/gastos enteros.
 */
export async function fetchHistoryShiftsFromFirestore(
  filter: HistoryShiftsFilter,
): Promise<HistoryShiftRow[]> {
  if (!isFirebaseAvailable()) return []

  const config = getBusinessConfig()
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const tenant = config.tenant_id
  const from = filter.fromDate ?? defaultHistoryFromDate()
  const toEnd = `${filter.toDate ?? new Date().toISOString().slice(0, 10)}T23:59:59.999Z`

  const shiftsCol = collection(firestore, 'licenses', tenant, 'shifts')
  const shiftConstraints = [
    where('startedAt', '>=', from),
    where('startedAt', '<=', toEnd),
    orderBy('startedAt', 'desc'),
  ]
  if (filter.effectiveStoreId) {
    shiftConstraints.unshift(where('storeId', '==', filter.effectiveStoreId))
  }
  const shiftsSnap = await getDocs(query(shiftsCol, ...shiftConstraints))

  const shifts: FsShift[] = []
  for (const d of shiftsSnap.docs) {
    const s = d.data() as FsShift
    shifts.push({ ...s, id: s.id ?? d.id })
  }
  const shiftIds = shifts.map(s => s.id)
  if (shiftIds.length === 0) return []

  const salesCol = collection(firestore, 'licenses', tenant, 'sales')
  const expensesCol = collection(firestore, 'licenses', tenant, 'expenses')
  const ordersCol = collection(firestore, 'licenses', tenant, 'orders')
  const debtsCol = collection(firestore, 'licenses', tenant, 'customerDebtEvents')

  const salesSnaps = await Promise.all(
    chunkIds(shiftIds).map(chunk => getDocs(query(salesCol, where('shiftId', 'in', chunk)))),
  )
  const expensesSnaps = await Promise.all(
    chunkIds(shiftIds).map(chunk => getDocs(query(expensesCol, where('shiftId', 'in', chunk)))),
  )
  const ordersSnaps = await Promise.all(
    chunkIds(shiftIds).map(chunk => getDocs(query(ordersCol, where('depositShiftId', 'in', chunk)))),
  )
  const debtsSnaps = await Promise.all(
    chunkIds(shiftIds).map(chunk => getDocs(query(debtsCol, where('shiftId', 'in', chunk)))),
  )

  const salesByShift = new Map<string, { count: number; total: number; cash: number }>()
  for (const snap of salesSnaps) {
    for (const d of snap.docs) {
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
  }

  const expensesByShift = new Map<string, number>()
  const injectsByShift = new Map<string, number>()
  for (const snap of expensesSnaps) {
    for (const d of snap.docs) {
      const e = d.data() as FsExpense
      if (e.deleted === true) continue
      if (e.kind === 'inject') {
        injectsByShift.set(e.shiftId, (injectsByShift.get(e.shiftId) ?? 0) + e.amount)
      } else {
        expensesByShift.set(e.shiftId, (expensesByShift.get(e.shiftId) ?? 0) + e.amount)
      }
    }
  }

  const depositsByShift = new Map<string, number>()
  for (const snap of ordersSnaps) {
    for (const d of snap.docs) {
      const o = d.data() as FsOrder
      if (o.deleted === true) continue
      if (!o.depositShiftId || (o.depositAmount ?? 0) <= 0) continue
      const cash = cashAmountFromDeposit({
        depositAmount: o.depositAmount ?? 0,
        depositMethod: o.depositMethod ?? null,
        depositPayments: depositPaymentsToJson(o.depositPayments),
      })
      depositsByShift.set(o.depositShiftId, (depositsByShift.get(o.depositShiftId) ?? 0) + cash)
    }
  }

  const cashDebtByShift = new Map<string, number>()
  for (const snap of debtsSnaps) {
    for (const d of snap.docs) {
      const e = d.data() as FsDebtEvent
      if (e.deleted === true) continue
      if (!e.shiftId || e.paymentMethod !== 'cash') continue
      cashDebtByShift.set(e.shiftId, (cashDebtByShift.get(e.shiftId) ?? 0) + Math.abs(e.amount ?? 0))
    }
  }

  return shifts.map(s => {
    const sv = salesByShift.get(s.id) ?? { count: 0, total: 0, cash: 0 }
    const exp = expensesByShift.get(s.id) ?? 0
    const inj = injectsByShift.get(s.id) ?? 0
    const dep = depositsByShift.get(s.id) ?? 0
    const debtCash = cashDebtByShift.get(s.id) ?? 0
    return {
      id: s.id,
      shiftType: s.shiftType,
      startedAt: s.startedAt,
      closedAt: s.closedAt ?? null,
      cashierName: s.cashierName ?? s.userId,
      salesCount: sv.count,
      totalRevenue: sv.total,
      totalCashSales: sv.cash,
      totalExpenses: exp,
      cashInHand: s.openingCash + sv.cash + dep + debtCash + inj - exp,
      totalDeposits: dep,
      source: s.source === 'mobile' ? 'mobile' : 'desktop',
    }
  })
}

/** Preferir la fila con más movimiento. Empate → local (esta PC es fuente de verdad). */
export function mergeHistoryShiftRows(
  local: HistoryShiftRow[],
  remote: HistoryShiftRow[],
): HistoryShiftRow[] {
  const byId = new Map<string, HistoryShiftRow>()
  for (const r of remote) byId.set(r.id, r)
  for (const l of local) {
    const existing = byId.get(l.id)
    if (!existing || historyShiftRowScore(l) >= historyShiftRowScore(existing)) {
      byId.set(l.id, l)
    }
  }
  return Array.from(byId.values())
}

export function historyShiftRowScore(row: HistoryShiftRow): number {
  return row.salesCount * 1_000_000 + row.totalRevenue + row.totalExpenses + row.totalDeposits
}

/** Abiertos primero, después los más recientes. Aplicar antes de paginar. */
export function sortHistoryShiftRowsNewestFirst(rows: HistoryShiftRow[]): HistoryShiftRow[] {
  return [...rows].sort((a, b) => {
    const aOpen = a.closedAt ? 0 : 1
    const bOpen = b.closedAt ? 0 : 1
    if (aOpen !== bOpen) return bOpen - aOpen
    return b.startedAt.localeCompare(a.startedAt)
  })
}

export function historyShiftDetailIsEmpty(detail: HistoryShiftDetail): boolean {
  return (
    detail.sales.length === 0
    && detail.expenses.length === 0
    && detail.deposits.length === 0
    && detail.debts.length === 0
    && detail.vales.length === 0
  )
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

    const tenant = config.tenant_id
    const salesCol = collection(firestore, 'licenses', tenant, 'sales')
    const expensesCol = collection(firestore, 'licenses', tenant, 'expenses')
    const ordersCol = collection(firestore, 'licenses', tenant, 'orders')
    const debtsCol = collection(firestore, 'licenses', tenant, 'customerDebtEvents')
    const valesCol = collection(firestore, 'licenses', tenant, 'employeeVales')

    // Queries por shiftId: no bajan la colección entera (a diferencia de la lista).
    const [salesSnap, expensesSnap, ordersSnap, debtsSnap, valesSnap] = await Promise.all([
      getDocs(query(salesCol, where('shiftId', '==', shiftId))),
      getDocs(query(expensesCol, where('shiftId', '==', shiftId))),
      getDocs(query(ordersCol, where('depositShiftId', '==', shiftId))),
      getDocs(query(debtsCol, where('shiftId', '==', shiftId))),
      getDocs(query(valesCol, where('shiftId', '==', shiftId))),
    ])

    const historySales: HistorySaleRow[] = []
    let totalDebitSales = 0
    let totalWalletSales = 0
    let totalCreditSales = 0
    for (const d of salesSnap.docs) {
      const s = { ...(d.data() as FsSale), id: (d.data() as FsSale).id ?? d.id }
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
      if (e.deleted === true) continue
      historyExpenses.push({
        id: e.id ?? d.id,
        createdAt: e.createdAt,
        concept: e.concept ?? undefined,
        provider: e.providerName ?? undefined,
        amount: e.amount,
        notes: e.notes ?? null,
        createdBy: e.createdBy,
        kind: e.kind === 'inject' ? 'inject' : 'expense',
      })
    }
    historyExpenses.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const saleIds = [...new Set(historySales.filter(s => s.isDebt).map(s => s.id))]
    const extraDebtSnaps = await Promise.all(
      chunkIds(saleIds).map(chunk => getDocs(query(debtsCol, where('saleId', 'in', chunk)))),
    )
    const debtsById = new Map<string, FsDebtEvent & { id: string }>()
    for (const snap of [debtsSnap, ...extraDebtSnaps]) {
      for (const d of snap.docs) {
        const e = d.data() as FsDebtEvent
        if (e.deleted === true) continue
        const id = e.id ?? d.id
        if (debtsById.has(id)) continue
        const fromShift = e.shiftId === shiftId
        const type = e.eventType === 'debt' ? 'created' : e.eventType
        const fromSale = type === 'created' && Boolean(e.saleId && saleIds.includes(e.saleId))
        if (!fromShift && !fromSale) continue
        debtsById.set(id, { ...e, id })
      }
    }

    const historyDeposits: HistoryOrderRow[] = []
    for (const d of ordersSnap.docs) {
      const o = d.data() as FsOrder
      if (o.deleted === true) continue
      const depositAmount = o.depositAmount ?? 0
      if (depositAmount <= 0) continue
      const paymentsJson = depositPaymentsToJson(o.depositPayments)
      let parsedPayments: HistoryOrderRow['depositPayments'] = null
      if (paymentsJson) {
        try {
          parsedPayments = JSON.parse(paymentsJson) as HistoryOrderRow['depositPayments']
        } catch { /* ignore */ }
      }
      const status = o.status
      historyDeposits.push({
        id: o.id ?? d.id,
        customerName: o.customerName ?? '(cliente)',
        phone: o.phone ?? null,
        items: o.items ?? '',
        depositAmount,
        depositPayments: parsedPayments,
        depositMethod: (o.depositMethod ?? null) as HistoryOrderRow['depositMethod'],
        createdAt: o.createdAt ?? '',
        status: status === 'pending' || status === 'ready' || status === 'delivered' || status === 'cancelled'
          ? status
          : undefined,
      })
    }
    historyDeposits.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const rawDebts = [...debtsById.values()]
    const customerIds: string[] = []
    for (const e of rawDebts) {
      if (e.customerId) customerIds.push(e.customerId)
    }

    const uniqueCustomerIds = [...new Set(customerIds)]
    const nameById = new Map<string, string>()
    await Promise.all(uniqueCustomerIds.map(async cid => {
      const snap = await getDoc(doc(firestore, 'licenses', tenant, 'customers', cid))
      if (!snap.exists()) return
      const name = (snap.data() as { name?: string }).name
      nameById.set(cid, name?.trim() || '(cliente)')
    }))

    const historyDebts: HistoryDebtRow[] = rawDebts
      .map(e => {
        const rawType = e.eventType === 'debt' ? 'created' : e.eventType
        const eventType: HistoryDebtRow['eventType'] =
          rawType === 'partial_payment'
          || rawType === 'paid'
          || rawType === 'cancelled'
          || rawType === 'reopened'
            ? rawType
            : 'created'
        return {
          id: e.id,
          createdAt: e.createdAt ?? '',
          customerName: nameById.get(e.customerId ?? '') ?? '(cliente)',
          amount: e.amount ?? 0,
          eventType,
          notes: e.notes ?? null,
        }
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const historyVales: HistoryValeRow[] = []
    for (const d of valesSnap.docs) {
      const v = d.data() as {
        id?: string
        employeeName?: string | null
        employeeId?: string
        amount?: number
        description?: string | null
        items?: HistoryValeRow['items']
        cancelledAt?: string | null
        createdAt?: string
        deleted?: boolean
      }
      if (v.deleted === true) continue
      historyVales.push({
        id: v.id ?? d.id,
        employeeName: v.employeeName?.trim() || v.employeeId || '(empleado)',
        amount: v.amount ?? 0,
        description: v.description ?? null,
        items: v.items ?? null,
        cancelledAt: v.cancelledAt ?? null,
        createdAt: v.createdAt ?? '',
      })
    }
    historyVales.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const confirmedSales = historySales.filter(s => s.status === 'confirmed')
    const totalRevenue = confirmedSales.reduce((a, s) => a + s.total, 0)
    const totalCashSales = confirmedSales.reduce((a, s) => a + s.cashAmount, 0)
    const totalExpenses = historyExpenses
      .filter(e => e.kind !== 'inject')
      .reduce((a, e) => a + e.amount, 0)
    const totalCashInjects = historyExpenses
      .filter(e => e.kind === 'inject')
      .reduce((a, e) => a + e.amount, 0)
    const cashDeposits = historyDeposits.reduce((a, d) => a + cashAmountFromDeposit({
      depositAmount: d.depositAmount,
      depositMethod: d.depositMethod,
      depositPayments: depositPaymentsToJson(d.depositPayments),
    }), 0)
    const digitalDeposits = historyDeposits.reduce((a, d) => a + digitalAmountFromDeposit({
      depositAmount: d.depositAmount,
      depositMethod: d.depositMethod,
      depositPayments: depositPaymentsToJson(d.depositPayments),
    }), 0)
    const cashDebtPayments = rawDebts
      .filter(e => e.paymentMethod === 'cash')
      .reduce((a, e) => a + Math.abs(e.amount ?? 0), 0)

    return {
      shift: {
        id: shift.id,
        shiftType: shift.shiftType,
        startedAt: shift.startedAt,
        closedAt: shift.closedAt ?? null,
        cashierName: shift.cashierName ?? shift.userId,
        openingCash: shift.openingCash,
        closingCash: shift.closingCash,
        deliveredAmount: shift.deliveredAmount,
        deliveredTo: shift.deliveredTo,
        notes: shift.notes,
        source: shift.source === 'mobile' ? 'mobile' : 'desktop',
      },
      sales: historySales,
      expenses: historyExpenses,
      debts: historyDebts,
      deposits: historyDeposits,
      vales: historyVales,
      summary: {
        salesCount: confirmedSales.length,
        totalRevenue,
        totalCashSales,
        totalDebitSales,
        totalWalletSales,
        totalCreditSales,
        totalExpenses,
        totalCashInjects,
        cashDeposits,
        digitalDeposits,
        cashInHand: shift.openingCash + totalCashSales + cashDeposits + cashDebtPayments + totalCashInjects - totalExpenses,
        debtsCount: historyDebts.length,
        totalDebts: historyDebts.reduce((a, d) => a + d.amount, 0),
      },
    }
  } catch (err) {
    log.error('[historyFirestore] Error al leer detalle de turno', { shiftId, err })
    return null
  }
}

/**
 * Vales desde Firestore, filtrables por local.
 * Docs viejos sin `storeId` no entran al filtro por local (no se baja `shifts` entero).
 */
export async function fetchEmployeeValesFromFirestore(
  storeIdFilter: string | null,
): Promise<RemoteEmployeeValeRow[]> {
  if (!isFirebaseAvailable()) return []

  try {
    const config = getBusinessConfig()
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const valesCol = collection(firestore, 'licenses', config.tenant_id, 'employeeVales')
    const valesSnap = storeIdFilter
      ? await getDocs(query(valesCol, where('storeId', '==', storeIdFilter)))
      : await getDocs(valesCol)

    const rows: RemoteEmployeeValeRow[] = []
    for (const d of valesSnap.docs) {
      const v = d.data() as {
        id?: string
        employeeId?: string
        employeeName?: string | null
        storeId?: string | null
        shiftId?: string | null
        amount?: number
        description?: string | null
        items?: Array<{
          productName?: string | null
          quantity?: number
          unitPrice?: number
          subtotal?: number
        }> | null
        paidAt?: string
        createdAt?: string
        cancelledAt?: string | null
        deleted?: boolean
      }
      if (v.deleted === true) continue

      const storeId = v.storeId ?? null

      if (storeIdFilter && storeId !== storeIdFilter) continue

      const employeeId = v.employeeId ?? ''
      rows.push({
        id: v.id ?? d.id,
        employeeId,
        employeeName: v.employeeName?.trim() || employeeId || '(sin nombre)',
        storeId,
        shiftId: v.shiftId ?? null,
        amount: v.amount ?? 0,
        description: v.description ?? null,
        items: (v.items ?? []).map(i => ({
          productName: i.productName ?? '(producto)',
          quantity: i.quantity ?? 0,
          unitPrice: i.unitPrice ?? 0,
          subtotal: i.subtotal ?? 0,
        })),
        paidAt: v.paidAt ?? v.createdAt ?? '',
        createdAt: v.createdAt ?? '',
        cancelledAt: v.cancelledAt ?? null,
      })
    }

    rows.sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    return rows
  } catch (err) {
    log.error('[historyFirestore] Error al leer vales remotos', err)
    return []
  }
}
