/**
 * Fichas de turno y, solo si falta el resumen, las ventas de ESE turno.
 * No baja la colección entera.
 */
import { collection, doc, getDocs, getFirestore, orderBy, query, setDoc, where } from 'firebase/firestore'
import {
  parseSoldHoursJson,
  sealedSoldHoursJson,
  tallyShiftMoney,
  type PaymentSplit,
  type ShiftMoneyParts,
} from '@carniceria/shared'
import { getFirebaseApp } from './firebase'
import { getBusinessConfig } from '../businessConfig'
import {
  addDepositToTotals,
  depositPaymentsToJson,
  emptyDepositTotals,
} from '../lib/depositPayments'
import { finiteAmount } from '../db/shiftCloseAmounts'

const IN_LIMIT = 30

export interface RemoteSummaryShift {
  id: string
  cashierName: string
  shiftType: 'morning' | 'evening'
  startedAt: string
  closedAt: string | null
  openingCash: number
  cashLeft: number | null
  deliveredAmount: number | null
  soldTotal: number | null
  cashTotal: number | null
  cardWalletTotal: number | null
  debtTotal: number | null
  expenseTotal: number | null
  contributionTotal: number | null
  walletCashTotal: number | null
  debitTotal: number | null
  walletTotal: number | null
  creditTotal: number | null
  moneySnapshottedAt: string | null
  /** 24 montos. Null = la ficha no los tiene. */
  soldHoursJson: string | null
  /** Null = la ficha no trajo el número. 0 es un dato. */
  providerExpenseTotal: number | null
}

function sealedHoursField(value: unknown): string | null {
  const raw = text(value)
  if (!raw || !parseSoldHoursJson(raw)) return null
  return raw
}

function chunk<T>(items: T[], size = IN_LIMIT): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function moneyParts(data: Record<string, unknown>): ShiftMoneyParts | null {
  const at = text(data['moneySnapshottedAt'])
  if (!at) return null
  const soldTotal = finiteAmount(data['soldTotal'])
  const cashTotal = finiteAmount(data['cashTotal'])
  const cardWalletTotal = finiteAmount(data['cardWalletTotal'])
  const debtTotal = finiteAmount(data['debtTotal'])
  const expenseTotal = finiteAmount(data['expenseTotal'])
  const contributionTotal = finiteAmount(data['contributionTotal'])
  const walletCashTotal = finiteAmount(data['walletCashTotal'])
  if (
    soldTotal == null || cashTotal == null || cardWalletTotal == null || debtTotal == null
    || expenseTotal == null || contributionTotal == null || walletCashTotal == null
  ) return null
  return { soldTotal, cashTotal, cardWalletTotal, debtTotal, expenseTotal, contributionTotal, walletCashTotal }
}

export async function fetchRemoteSummaryShifts(
  storeId: string,
  startIso: string,
  endIso: string,
): Promise<RemoteSummaryShift[]> {
  const tenant = getBusinessConfig().tenant_id
  const firestore = getFirestore(getFirebaseApp())
  const snap = await getDocs(query(
    collection(firestore, 'licenses', tenant, 'shifts'),
    where('storeId', '==', storeId),
    where('startedAt', '>=', startIso),
    where('startedAt', '<', endIso),
    // El índice publicado es storeId + startedAt DESC (el del historial).
    // Sin este orderBy Firestore pide el ASC y la lectura falla.
    orderBy('startedAt', 'desc'),
  ))
  const shifts: RemoteSummaryShift[] = []
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, unknown>
    const startedAt = text(data['startedAt'])
    if (!startedAt || startedAt < startIso || startedAt >= endIso) continue
    const parts = moneyParts(data)
    const userId = text(data['userId']) ?? ''
    shifts.push({
      id: text(data['id']) ?? docSnap.id,
      cashierName: text(data['cashierName']) ?? userId,
      shiftType: data['shiftType'] === 'evening' ? 'evening' : 'morning',
      startedAt,
      closedAt: text(data['closedAt']),
      openingCash: finiteAmount(data['openingCash']) ?? 0,
      cashLeft: finiteAmount(data['cashLeft']),
      deliveredAmount: finiteAmount(data['deliveredAmount']),
      soldTotal: parts?.soldTotal ?? null,
      cashTotal: parts?.cashTotal ?? null,
      cardWalletTotal: parts?.cardWalletTotal ?? null,
      debtTotal: parts?.debtTotal ?? null,
      expenseTotal: parts?.expenseTotal ?? null,
      contributionTotal: parts?.contributionTotal ?? null,
      walletCashTotal: parts?.walletCashTotal ?? null,
      debitTotal: finiteAmount(data['debitTotal']),
      walletTotal: finiteAmount(data['walletTotal']),
      creditTotal: finiteAmount(data['creditTotal']),
      moneySnapshottedAt: parts ? text(data['moneySnapshottedAt']) : null,
      soldHoursJson: sealedHoursField(data['soldHoursJson']),
      providerExpenseTotal: finiteAmount(data['providerExpenseTotal']),
    })
  }
  return shifts
}

interface SaleDoc {
  id: string
  shiftId: string
  status: string
  total: number
  createdAt: string
  payments: { method: string; amount: number }[]
}

function readSale(data: Record<string, unknown>, id: string): SaleDoc | null {
  const shiftId = text(data['shiftId'])
  if (!shiftId) return null
  const paymentsRaw = Array.isArray(data['payments']) ? data['payments'] : []
  const payments: { method: string; amount: number }[] = []
  for (const item of paymentsRaw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { paymentMethod?: unknown; method?: unknown; amount?: unknown }
    const method = typeof rec.paymentMethod === 'string'
      ? rec.paymentMethod
      : typeof rec.method === 'string' ? rec.method : ''
    const amount = finiteAmount(rec.amount)
    if (!method || amount == null) continue
    payments.push({ method, amount })
  }
  return {
    id: text(data['id']) ?? id,
    shiftId,
    status: text(data['status']) ?? '',
    total: finiteAmount(data['total']) ?? 0,
    createdAt: text(data['createdAt']) ?? '',
    payments,
  }
}

/**
 * Suma las ventas ya subidas de esos turnos y nada más.
 * El llamador solo pide turnos de ayer o antes sin ficha, o el abierto de hoy.
 */
export async function fetchRemoteShiftMoney(
  shiftIds: string[],
  startedAtById: Readonly<Record<string, string>> = {},
): Promise<Map<string, ShiftMoneyParts & { paymentSplit: PaymentSplit; soldHoursJson: string | null }>> {
  const result = new Map<string, ShiftMoneyParts & { paymentSplit: PaymentSplit; soldHoursJson: string | null }>()
  if (shiftIds.length === 0) return result
  const tenant = getBusinessConfig().tenant_id
  const firestore = getFirestore(getFirebaseApp())
  const salesCol = collection(firestore, 'licenses', tenant, 'sales')
  const expensesCol = collection(firestore, 'licenses', tenant, 'expenses')
  const ordersCol = collection(firestore, 'licenses', tenant, 'orders')
  const debtsCol = collection(firestore, 'licenses', tenant, 'customerDebtEvents')

  const salesByShift = new Map<string, SaleDoc[]>()
  const saleIds = new Map<string, string>()
  for (const ids of chunk(shiftIds)) {
    const snap = await getDocs(query(salesCol, where('shiftId', 'in', ids)))
    for (const docSnap of snap.docs) {
      const sale = readSale(docSnap.data() as Record<string, unknown>, docSnap.id)
      if (!sale || !shiftIds.includes(sale.shiftId)) continue
      const list = salesByShift.get(sale.shiftId) ?? []
      list.push(sale)
      salesByShift.set(sale.shiftId, list)
      saleIds.set(sale.id, sale.shiftId)
    }
  }

  const movements = new Map<string, { kind: 'expense' | 'inject'; amount: number; injectReason: string | null; concept: string | null }[]>()
  for (const ids of chunk(shiftIds)) {
    const snap = await getDocs(query(expensesCol, where('shiftId', 'in', ids)))
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>
      if (data['deleted'] === true) continue
      const shiftId = text(data['shiftId'])
      if (!shiftId) continue
      const amount = finiteAmount(data['amount']) ?? 0
      const kind = data['kind'] === 'inject' ? 'inject' as const : 'expense' as const
      const list = movements.get(shiftId) ?? []
      list.push({
        kind,
        amount,
        injectReason: text(data['injectReason']),
        concept: text(data['concept']),
      })
      movements.set(shiftId, list)
    }
  }

  const deposits = new Map<string, { cash: number; debit: number; wallet: number; credit: number }>()
  for (const ids of chunk(shiftIds)) {
    const snap = await getDocs(query(ordersCol, where('depositShiftId', 'in', ids)))
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>
      if (data['deleted'] === true) continue
      const shiftId = text(data['depositShiftId'])
      if (!shiftId) continue
      const totals = emptyDepositTotals()
      addDepositToTotals({
        depositAmount: finiteAmount(data['depositAmount']) ?? 0,
        depositMethod: text(data['depositMethod']),
        depositPayments: depositPaymentsToJson(data['depositPayments']),
      }, totals)
      const prev = deposits.get(shiftId) ?? emptyDepositTotals()
      prev.cash += totals.cash
      prev.debit += totals.debit
      prev.wallet += totals.wallet
      prev.credit += totals.credit
      deposits.set(shiftId, prev)
    }
  }

  const debts = new Map<string, { eventType: string; amount: number; paymentMethod: string | null }[]>()
  const seenDebt = new Set<string>()
  function pushDebt(id: string, data: Record<string, unknown>, fallbackShiftId: string | null): void {
    if (seenDebt.has(id)) return
    if (data['deleted'] === true) return
    const shiftId = text(data['shiftId']) ?? fallbackShiftId
    if (!shiftId || !shiftIds.includes(shiftId)) return
    seenDebt.add(id)
    const list = debts.get(shiftId) ?? []
    list.push({
      eventType: text(data['eventType']) ?? '',
      amount: finiteAmount(data['amount']) ?? 0,
      paymentMethod: text(data['paymentMethod']),
    })
    debts.set(shiftId, list)
  }
  for (const ids of chunk(shiftIds)) {
    const snap = await getDocs(query(debtsCol, where('shiftId', 'in', ids)))
    for (const docSnap of snap.docs) {
      pushDebt(docSnap.id, docSnap.data() as Record<string, unknown>, null)
    }
  }
  const createdSaleIds = [...saleIds.keys()]
  for (const ids of chunk(createdSaleIds)) {
    const snap = await getDocs(query(debtsCol, where('saleId', 'in', ids)))
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>
      const saleId = text(data['saleId'])
      pushDebt(docSnap.id, data, saleId ? saleIds.get(saleId) ?? null : null)
    }
  }

  for (const shiftId of shiftIds) {
    const deposit = deposits.get(shiftId) ?? emptyDepositTotals()
    const shiftSales = salesByShift.get(shiftId) ?? []
    const startedAt = startedAtById[shiftId]
    result.set(shiftId, {
      ...tallyShiftMoney({
        sales: shiftSales.map(sale => ({
          status: sale.status,
          total: sale.total,
          payments: sale.payments,
        })),
        deposits: [
          { method: 'cash', amount: deposit.cash },
          { method: 'debit', amount: deposit.debit },
          { method: 'wallet', amount: deposit.wallet },
          { method: 'credit', amount: deposit.credit },
        ],
        debtEvents: debts.get(shiftId) ?? [],
        movements: movements.get(shiftId) ?? [],
      }),
      soldHoursJson: startedAt
        ? sealedSoldHoursJson(shiftSales, startedAt)
        : null,
    })
  }
  return result
}

export interface RemoteExpenseLine {
  id: string
  shiftId: string
  createdAt: string
  concept: string | null
  providerName: string | null
  amount: number
  notes: string | null
  kind: string
}

/**
 * Gastos de esos turnos, de a 30. La misma consulta por shiftId.
 * kind inject no entra: no es un gasto. No baja la colección.
 */
export async function fetchRemoteExpenseLines(shiftIds: string[]): Promise<RemoteExpenseLine[]> {
  const lines: RemoteExpenseLine[] = []
  if (shiftIds.length === 0) return lines
  const wanted = new Set(shiftIds)
  const tenant = getBusinessConfig().tenant_id
  const firestore = getFirestore(getFirebaseApp())
  const expensesCol = collection(firestore, 'licenses', tenant, 'expenses')
  for (const ids of chunk(shiftIds)) {
    const snap = await getDocs(query(expensesCol, where('shiftId', 'in', ids)))
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>
      if (data['deleted'] === true) continue
      if (data['kind'] === 'inject') continue
      const shiftId = text(data['shiftId'])
      if (!shiftId || !wanted.has(shiftId)) continue
      lines.push({
        id: text(data['id']) ?? docSnap.id,
        shiftId,
        createdAt: text(data['createdAt']) ?? '',
        concept: text(data['concept']),
        providerName: text(data['providerName']),
        amount: finiteAmount(data['amount']) ?? 0,
        notes: text(data['notes']),
        kind: 'expense',
      })
    }
  }
  return lines
}

/** Escribe solo la plata. No toca ventas ni el cierre. */
export async function writeRemoteShiftMoney(
  shiftId: string,
  parts: ShiftMoneyParts & {
    paymentSplit?: PaymentSplit | null
    soldHoursJson?: string | null
    providerExpenseTotal?: number | null
  },
  at: string,
): Promise<void> {
  const tenant = getBusinessConfig().tenant_id
  const firestore = getFirestore(getFirebaseApp())
  const split = parts.paymentSplit
  const hoursJson = typeof parts.soldHoursJson === 'string' && parts.soldHoursJson.length > 0
    ? parts.soldHoursJson
    : null
  await setDoc(doc(firestore, 'licenses', tenant, 'shifts', shiftId), {
    soldTotal: parts.soldTotal,
    cashTotal: parts.cashTotal,
    cardWalletTotal: parts.cardWalletTotal,
    debtTotal: parts.debtTotal,
    expenseTotal: parts.expenseTotal,
    contributionTotal: parts.contributionTotal,
    walletCashTotal: parts.walletCashTotal,
    ...(split
      ? {
        debitTotal: split.debit,
        walletTotal: split.wallet,
        creditTotal: split.credit,
      }
      : {}),
    ...(hoursJson ? { soldHoursJson: hoursJson } : {}),
    ...(typeof parts.providerExpenseTotal === 'number' ? { providerExpenseTotal: parts.providerExpenseTotal } : {}),
    moneySnapshottedAt: at,
  }, { merge: true })
}
