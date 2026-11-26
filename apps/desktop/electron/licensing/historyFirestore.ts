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
import { buildCashHandoverAudit, parseBillLines, parseMerchLinesFromUnknown } from '@carniceria/shared'
import { historyListRowFromFicha } from './historyListRow'
import { historyVisitLinesFromSnapshots, unpaidArrivalFromIntake } from './historyVisitLines'
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
  cashLeft?: number | null
  deliveredAmount: number | null
  deliveredTo: string | null
  notes: string | null
  source?: string
  openingBills?: unknown
  closingBills?: unknown
  handoverExpectedBills?: unknown
  openingBillsCounted?: boolean
  closingBillsCounted?: boolean
  handoverFromShiftId?: string | null
  handoverFromCashierName?: string | null
  handoverFromClosedAt?: string | null
  soldTotal?: number | null
  cashTotal?: number | null
  cardWalletTotal?: number | null
  debtTotal?: number | null
  expenseTotal?: number | null
  contributionTotal?: number | null
  walletCashTotal?: number | null
  moneySnapshottedAt?: string | null
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
  discountException?: boolean
  discountPercent?: number
  discountAmount?: number
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
  injectReason?: 'aporte' | 'wallet_cash' | string | null
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
  const byMethod = new Map<FsSalePayment['paymentMethod'], number>()
  for (const pay of payments) byMethod.set(pay.paymentMethod, (byMethod.get(pay.paymentMethod) ?? 0) + pay.amount)
  return {
    id: s.id,
    createdAt: s.createdAt,
    total: s.total,
    status: s.status === 'cancelled' ? 'cancelled' : 'confirmed',
    cashAmount,
    digitalAmount,
    paymentMethods: methods,
    payments: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })),
    discountAmount: typeof s.discountAmount === 'number' && Number.isFinite(s.discountAmount)
      ? Math.max(0, Math.round(s.discountAmount))
      : 0,
    manualEntry: s.manualEntry ?? false,
    isDebt: s.isDebt ?? false,
    discountException: s.discountException === true,
    discountPercent: typeof s.discountPercent === 'number' && Number.isFinite(s.discountPercent)
      ? Math.min(100, Math.max(0, Math.round(s.discountPercent)))
      : 0,
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
 * Una lectura por ficha. Ventas, gastos, señas y fiados se piden al abrir el turno.
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

  const rows: HistoryShiftRow[] = []
  for (const d of shiftsSnap.docs) {
    const s = d.data() as FsShift
    if (s.shiftType !== 'morning' && s.shiftType !== 'evening') continue
    if (!s.startedAt) continue
    rows.push(historyListRowFromFicha({
      id: s.id ?? d.id,
      shiftType: s.shiftType,
      startedAt: s.startedAt,
      closedAt: s.closedAt ?? null,
      cashierName: s.cashierName ?? s.userId,
      storeId: s.storeId,
      openingCash: Number(s.openingCash ?? 0),
      source: s.source,
      soldTotal: s.soldTotal ?? null,
      cashTotal: s.cashTotal ?? null,
      cardWalletTotal: s.cardWalletTotal ?? null,
      debtTotal: s.debtTotal ?? null,
      expenseTotal: s.expenseTotal ?? null,
      contributionTotal: s.contributionTotal ?? null,
      walletCashTotal: s.walletCashTotal ?? null,
      moneySnapshottedAt: s.moneySnapshottedAt ?? null,
    }))
  }
  return rows
}

/** Preferir la ficha sellada y, si ambas lo están, la de más vendido. Empate → local. */
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
  const sealed = row.totalsSealed ? 1_000_000_000 : 0
  return sealed + (row.totalRevenue ?? 0) + (row.totalExpenses ?? 0) + (row.totalDeposits ?? 0)
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

function unionUnpaidArrivals(
  remote: HistoryShiftDetail['unpaidArrivals'],
  local: HistoryShiftDetail['unpaidArrivals'],
): NonNullable<HistoryShiftDetail['unpaidArrivals']> {
  const byId = new Map<string, NonNullable<HistoryShiftDetail['unpaidArrivals']>[number]>()
  for (const row of remote ?? []) byId.set(row.intakeId, row)
  for (const row of local ?? []) byId.set(row.intakeId, row)
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function unionById<T extends { id: string; createdAt: string }>(remote: T[], local: T[]): T[] {
  const byId = new Map<string, T>()
  for (const row of remote) byId.set(row.id, row)
  for (const row of local) byId.set(row.id, row)
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * La PC del admin no tiene el SQLite del local. Si acá hay un fiado o el cierre
 * y en la nube están las ventas y los gastos, se muestran los dos lados.
 * El mismo id no se duplica: gana el de esta PC.
 */
export function mergeHistoryShiftDetails(
  local: HistoryShiftDetail,
  remote: HistoryShiftDetail,
): HistoryShiftDetail {
  const sales = unionById(remote.sales, local.sales)
  const expenses = unionById(remote.expenses, local.expenses)
  const debts = unionById(remote.debts, local.debts)
  const deposits = unionById(remote.deposits, local.deposits)
  const vales = unionById(remote.vales, local.vales)
  const shift = local.shift.closedAt
    ? local.shift
    : remote.shift.closedAt
      ? remote.shift
      : local.shift

  const confirmed = sales.filter(s => s.status === 'confirmed')
  const totalRevenue = confirmed.reduce((a, s) => a + s.total, 0)
  const totalCashSales = confirmed.reduce((a, s) => a + s.cashAmount, 0)
  const totalDebitSales = confirmed.reduce((a, s) => a + (s.paymentMethods.includes('debit') ? s.digitalAmount : 0), 0)
  const totalWalletSales = confirmed.reduce((a, s) => a + (s.paymentMethods.includes('wallet') ? s.digitalAmount : 0), 0)
  const totalCreditSales = confirmed.reduce((a, s) => a + (s.paymentMethods.includes('credit') ? s.digitalAmount : 0), 0)
  const totalExpenses = expenses.filter(e => e.kind !== 'inject').reduce((a, e) => a + e.amount, 0)
  const totalCashInjects = expenses.filter(e => e.kind === 'inject').reduce((a, e) => a + e.amount, 0)
  const cashDeposits = deposits.reduce((a, d) => a + cashAmountFromDeposit({
    depositAmount: d.depositAmount,
    depositMethod: d.depositMethod,
    depositPayments: depositPaymentsToJson(d.depositPayments),
  }), 0)
  const digitalDeposits = deposits.reduce((a, d) => a + digitalAmountFromDeposit({
    depositAmount: d.depositAmount,
    depositMethod: d.depositMethod,
    depositPayments: depositPaymentsToJson(d.depositPayments),
  }), 0)
  const cashDebtPayments = debts
    .filter(d => d.eventType === 'partial_payment' || d.eventType === 'paid')
    .reduce((a, d) => a + Math.abs(d.amount), 0)

  return {
    shift,
    cashHandover: local.cashHandover ?? remote.cashHandover,
    sales,
    expenses,
    debts,
    deposits,
    vales,
    unpaidArrivals: unionUnpaidArrivals(remote.unpaidArrivals, local.unpaidArrivals),
    summary: {
      salesCount: confirmed.length,
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
      debtsCount: debts.length,
      totalDebts: debts.reduce((a, d) => a + d.amount, 0),
    },
  }
}

/**
 * Detalle de un turno desde Firestore. null si no existe.
 */
export async function fetchHistoryShiftDetailFromFirestore(
  shiftId: string,
  hideMediaResPrice = false,
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
        injectReason: e.kind === 'inject'
          ? (e.injectReason === 'wallet_cash' ? 'wallet_cash' : 'aporte')
          : undefined,
      })
    }
    historyExpenses.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const intakesSnap = await getDocs(query(
      collection(firestore, 'licenses', tenant, 'merchandiseIntakes'),
      where('shiftId', '==', shiftId),
    ))
    const unpaidArrivals: NonNullable<HistoryShiftDetail['unpaidArrivals']> = []
    for (const intakeDoc of intakesSnap.docs) {
      const data = intakeDoc.data() as Record<string, unknown>
      if (data['deleted'] === true || data['status'] === 'draft') continue
      const lines = parseMerchLinesFromUnknown(data['lines'], {
        intakeId: intakeDoc.id,
        category: data['category'],
        unit: data['unit'],
        quantity: data['quantity'],
      })
      const intakeId = typeof data['id'] === 'string' ? data['id'] : intakeDoc.id
      const createdAt = typeof data['createdAt'] === 'string' ? data['createdAt'] : ''
      if (data['paymentKind'] === 'none') {
        const arrival = unpaidArrivalFromIntake({
          intakeId,
          createdAt,
          providerName: typeof data['providerName'] === 'string' ? data['providerName'] : null,
          paymentKind: 'none',
          status: typeof data['status'] === 'string' ? data['status'] : 'confirmed',
          lines,
        })
        if (arrival) unpaidArrivals.push(arrival)
        continue
      }
      const expenseId = typeof data['expenseId'] === 'string' ? data['expenseId'] : ''
      const expense = historyExpenses.find(row => row.id === expenseId)
      if (!expense) continue
      const visitLines = historyVisitLinesFromSnapshots(lines, hideMediaResPrice)
      if (visitLines.length === 0) continue
      expense.lineNames = visitLines.map(line => line.name)
      expense.visitLines = visitLines
      expense.intakeId = intakeId
      expense.intakeCreatedAt = createdAt || expense.createdAt
    }

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
        cashLeft: shift.cashLeft ?? null,
        deliveredAmount: shift.deliveredAmount,
        deliveredTo: shift.deliveredTo,
        notes: shift.notes,
        source: shift.source === 'mobile' ? 'mobile' : 'desktop',
      },
      cashHandover: buildCashHandoverAudit({
        cashierName: shift.cashierName ?? shift.userId,
        startedAt: shift.startedAt,
        closedAt: shift.closedAt ?? null,
        openingBills: parseBillLines(shift.openingBills),
        closingBills: parseBillLines(shift.closingBills),
        openingCounted: shift.openingBillsCounted === true,
        closingCounted: shift.closingBillsCounted === true,
        handover: {
          fromShiftId: shift.handoverFromShiftId,
          fromCashierName: shift.handoverFromCashierName,
          fromClosedAt: shift.handoverFromClosedAt,
          expectedBills: parseBillLines(shift.handoverExpectedBills),
        },
      }),
      sales: historySales,
      expenses: historyExpenses,
      debts: historyDebts,
      deposits: historyDeposits,
      vales: historyVales,
      unpaidArrivals,
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
 * Siempre hay un piso de fecha (default: últimos 7 días). Si viene un local,
 * la fecha entra en la misma consulta: no se bajan todos los vales de ese local.
 * Docs viejos sin `storeId` no entran al filtro por local.
 */
export async function fetchEmployeeValesFromFirestore(
  storeIdFilter: string | null,
  createdAtFrom?: string,
): Promise<RemoteEmployeeValeRow[]> {
  if (!isFirebaseAvailable()) return []

  try {
    const config = getBusinessConfig()
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const valesCol = collection(firestore, 'licenses', config.tenant_id, 'employeeVales')
    const from = createdAtFrom ?? `${defaultHistoryFromDate()}T03:00:00.000Z`
    const constraints = [
      ...(storeIdFilter ? [where('storeId', '==', storeIdFilter)] : []),
      where('createdAt', '>=', from),
    ]
    const valesSnap = await getDocs(query(valesCol, ...constraints))

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
