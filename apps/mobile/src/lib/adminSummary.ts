/**
 * Resumen del celu: ficha del turno y medias del rango.
 * No baja la colección entera. Un turno de hoy recién cerrado no se calcula.
 */
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  civilYmd,
  mediaResVisits,
  mondayWeekRange,
  mondayWeeksInRange,
  shiftMoneyAction,
  tallyShiftMoney,
  type MediaResVisit,
  type PaymentSplit,
  type ShiftMoneyParts,
  type SummaryShiftCard,
  type TallyDebtEvent,
  type TallyMovement,
  type TallySale,
} from '@carniceria/shared'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { listMerchSpan } from './merchIntake'
import { parseDepositPayments } from './orderMapping'
import {
  patchCachedSummaryShift,
  readCachedSummaryWeek,
  saveSummaryWeek,
  summaryWeekIsMarked,
} from './summaryCache'

export interface MobileSummary {
  shifts: SummaryShiftCard[]
  visits: MediaResVisit[]
  warning: string | null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function moneyParts(data: Record<string, unknown>): ShiftMoneyParts | null {
  const soldTotal = finite(data['soldTotal'])
  const cashTotal = finite(data['cashTotal'])
  const cardWalletTotal = finite(data['cardWalletTotal'])
  const debtTotal = finite(data['debtTotal'])
  const expenseTotal = finite(data['expenseTotal'])
  const contributionTotal = finite(data['contributionTotal'])
  const walletCashTotal = finite(data['walletCashTotal'])
  if (
    soldTotal == null || cashTotal == null || cardWalletTotal == null || debtTotal == null
    || expenseTotal == null || contributionTotal == null || walletCashTotal == null
  ) return null
  return { soldTotal, cashTotal, cardWalletTotal, debtTotal, expenseTotal, contributionTotal, walletCashTotal }
}

function cardFromDoc(id: string, data: Record<string, unknown>, parts: ShiftMoneyParts | null, live: boolean): SummaryShiftCard {
  const userId = text(data['userId']) ?? ''
  return {
    id,
    cashierName: text(data['cashierName']) ?? userId,
    shiftType: data['shiftType'] === 'evening' ? 'evening' : 'morning',
    startedAt: text(data['startedAt']) ?? '',
    closedAt: text(data['closedAt']),
    openingCash: finite(data['openingCash']) ?? 0,
    cashLeft: finite(data['cashLeft']),
    withdrawn: finite(data['deliveredAmount']),
    soldTotal: parts?.soldTotal ?? null,
    cashTotal: parts?.cashTotal ?? null,
    cardWalletTotal: parts?.cardWalletTotal ?? null,
    debtTotal: parts?.debtTotal ?? null,
    expenseTotal: parts?.expenseTotal ?? null,
    contributionTotal: parts?.contributionTotal ?? null,
    walletCashTotal: parts?.walletCashTotal ?? null,
    moneySnapshottedAt: live ? null : (parts ? text(data['moneySnapshottedAt']) : null),
    live,
  }
}

function readSale(data: Record<string, unknown>): TallySale | null {
  const paymentsRaw = Array.isArray(data['payments']) ? data['payments'] : []
  const payments: { method: string; amount: number }[] = []
  for (const item of paymentsRaw) {
    const rec = record(item)
    if (!rec) continue
    const method = text(rec['paymentMethod']) ?? text(rec['method'])
    const amount = finite(rec['amount'])
    if (!method || amount == null) continue
    payments.push({ method, amount })
  }
  return {
    status: text(data['status']) ?? '',
    total: finite(data['total']) ?? 0,
    payments,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function tallyRemoteShift(shiftId: string): Promise<ShiftMoneyParts & { paymentSplit: PaymentSplit }> {
  const db = getFirestore(firebaseApp)
  const base = ['licenses', LICENSE_KEY] as const
  const salesSnap = await getDocs(query(collection(db, ...base, 'sales'), where('shiftId', '==', shiftId)))
  const sales: TallySale[] = []
  const saleIds: string[] = []
  for (const snap of salesSnap.docs) {
    const data = snap.data() as Record<string, unknown>
    if (text(data['shiftId']) !== shiftId) continue
    const sale = readSale(data)
    if (!sale) continue
    sales.push(sale)
    saleIds.push(text(data['id']) ?? snap.id)
  }

  const expenseSnap = await getDocs(query(collection(db, ...base, 'expenses'), where('shiftId', '==', shiftId)))
  const movements: TallyMovement[] = []
  for (const snap of expenseSnap.docs) {
    const data = snap.data() as Record<string, unknown>
    if (data['deleted'] === true) continue
    if (text(data['shiftId']) !== shiftId) continue
    movements.push({
      kind: data['kind'] === 'inject' ? 'inject' : 'expense',
      amount: finite(data['amount']) ?? 0,
      injectReason: text(data['injectReason']),
      concept: text(data['concept']),
    })
  }

  const orderSnap = await getDocs(query(collection(db, ...base, 'orders'), where('depositShiftId', '==', shiftId)))
  let cashDeposits = 0
  let cardDeposits = 0
  for (const snap of orderSnap.docs) {
    const data = snap.data() as Record<string, unknown>
    if (data['deleted'] === true) continue
    if (text(data['depositShiftId']) !== shiftId) continue
    const payments = parseDepositPayments(data['depositPayments'])
    if (payments && payments.length > 0) {
      for (const payment of payments) {
        if (payment.method === 'cash') cashDeposits += payment.amount
        else cardDeposits += payment.amount
      }
      continue
    }
    const amount = finite(data['depositAmount']) ?? 0
    if (text(data['depositMethod']) === 'cash') cashDeposits += amount
    else if (text(data['depositMethod'])) cardDeposits += amount
  }

  const debtsCol = collection(db, ...base, 'customerDebtEvents')
  const debtSnaps = [
    await getDocs(query(debtsCol, where('shiftId', '==', shiftId))),
    ...await Promise.all(chunk(saleIds, 30).map(ids => getDocs(query(debtsCol, where('saleId', 'in', ids))))),
  ]
  const debtEvents: TallyDebtEvent[] = []
  const seen = new Set<string>()
  for (const snap of debtSnaps) {
    for (const row of snap.docs) {
      if (seen.has(row.id)) continue
      const data = row.data() as Record<string, unknown>
      if (data['deleted'] === true) continue
      const eventShift = text(data['shiftId'])
      const saleId = text(data['saleId'])
      const belongs = eventShift === shiftId || (saleId != null && saleIds.includes(saleId))
      if (!belongs) continue
      seen.add(row.id)
      debtEvents.push({
        eventType: text(data['eventType']) ?? '',
        amount: finite(data['amount']) ?? 0,
        paymentMethod: text(data['paymentMethod']),
      })
    }
  }

  return tallyShiftMoney({ sales, cashDeposits, cardDeposits, debtEvents, movements })
}

async function writeShiftMoney(
  shiftId: string,
  parts: ShiftMoneyParts & { paymentSplit: PaymentSplit },
  at: string,
): Promise<void> {
  const db = getFirestore(firebaseApp)
  await updateDoc(doc(db, 'licenses', LICENSE_KEY, 'shifts', shiftId), {
    soldTotal: parts.soldTotal,
    cashTotal: parts.cashTotal,
    cardWalletTotal: parts.cardWalletTotal,
    debtTotal: parts.debtTotal,
    expenseTotal: parts.expenseTotal,
    contributionTotal: parts.contributionTotal,
    walletCashTotal: parts.walletCashTotal,
    debitTotal: parts.paymentSplit.debit,
    walletTotal: parts.paymentSplit.wallet,
    creditTotal: parts.paymentSplit.credit,
    moneySnapshottedAt: at,
  })
}

async function cardFromRemote(
  id: string,
  data: Record<string, unknown>,
  todayYmd: string,
): Promise<SummaryShiftCard> {
  const startedAt = text(data['startedAt']) ?? ''
  const closedAt = text(data['closedAt'])
  const stored = moneyParts(data)
  const snapshottedAt = stored ? text(data['moneySnapshottedAt']) : null
  const action = shiftMoneyAction({
    closedAt,
    startedAt,
    moneySnapshottedAt: snapshottedAt,
    hasLocalLedger: false,
    todayYmd,
  })
  if (action === 'keep') return cardFromDoc(id, data, stored, false)
  if (action !== 'live' && action !== 'backfill') return cardFromDoc(id, data, null, false)
  try {
    const parts = await tallyRemoteShift(id)
    if (action === 'backfill') {
      const at = new Date().toISOString()
      await writeShiftMoney(id, parts, at)
      return cardFromDoc(id, { ...data, moneySnapshottedAt: at }, parts, false)
    }
    return cardFromDoc(id, data, parts, true)
  } catch {
    return cardFromDoc(id, data, null, false)
  }
}

async function resolveCachedCard(
  storeId: string,
  card: SummaryShiftCard,
  todayYmd: string,
): Promise<SummaryShiftCard> {
  const action = shiftMoneyAction({
    closedAt: card.closedAt,
    startedAt: card.startedAt,
    moneySnapshottedAt: card.moneySnapshottedAt,
    hasLocalLedger: false,
    todayYmd,
  })
  if (action !== 'live' && action !== 'backfill') return card
  try {
    const parts = await tallyRemoteShift(card.id)
    const at = new Date().toISOString()
    const next: SummaryShiftCard = action === 'backfill'
      ? { ...card, ...parts, moneySnapshottedAt: at, live: false }
      : { ...card, ...parts, live: true }
    if (action === 'backfill') await writeShiftMoney(card.id, parts, at)
    await patchCachedSummaryShift(storeId, next)
    return next
  } catch {
    return card
  }
}

export async function loadMobileSummary(
  storeId: string,
  startIso: string,
  endIso: string,
  now = new Date(),
): Promise<MobileSummary> {
  const db = getFirestore(firebaseApp)
  const todayYmd = civilYmd(now)
  const currentWeek = mondayWeekRange(0, now).startIso
  let warning: string | null = null
  const shifts: SummaryShiftCard[] = []

  for (const week of mondayWeeksInRange(startIso, endIso)) {
    const current = week.startIso === currentWeek
    if (!current && await summaryWeekIsMarked(storeId, week.startIso)) {
      const cached = await readCachedSummaryWeek(storeId, week.startIso, week.endIso)
      for (const card of cached) {
        if (card.startedAt < startIso || card.startedAt >= endIso) continue
        const resolved = await resolveCachedCard(storeId, card, todayYmd)
        shifts.push(resolved)
      }
      continue
    }

    const snap = await getDocs(query(
      collection(db, 'licenses', LICENSE_KEY, 'shifts'),
      where('storeId', '==', storeId),
      where('startedAt', '>=', week.startIso),
      where('startedAt', '<', week.endIso),
      // Mismo índice que el historial: storeId + startedAt DESC.
      orderBy('startedAt', 'desc'),
    ))
    const resolved: SummaryShiftCard[] = []
    for (const row of snap.docs) {
      const data = row.data() as Record<string, unknown>
      if (text(data['storeId']) !== storeId) continue
      const startedAt = text(data['startedAt']) ?? ''
      if (startedAt < week.startIso || startedAt >= week.endIso) continue
      const card = await cardFromRemote(row.id, data, todayYmd)
      resolved.push(card)
    }
    if (!current) await saveSummaryWeek(storeId, week.startIso, week.endIso, resolved)
    for (const card of resolved) {
      if (card.startedAt < startIso || card.startedAt >= endIso) continue
      shifts.push(card)
    }
  }

  let visits: MediaResVisit[] = []
  try {
    const rows = await listMerchSpan(storeId, startIso, endIso, now)
    visits = mediaResVisits(rows
      .filter(row => row.status !== 'draft')
      .map(row => ({
        id: row.id,
        createdAt: row.createdAt,
        providerName: row.providerName,
        receivedByName: row.createdByName.trim() || '—',
        lines: row.lines.map(line => ({
          rubroId: line.rubroId,
          count: line.count,
          netKg: line.netKg,
          weightsKg: line.weightsKg,
        })),
      })))
  } catch {
    warning = warning ?? 'No se pudieron cargar las medias reses.'
  }

  return { shifts, visits, warning }
}
