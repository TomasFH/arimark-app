/**
 * Plata del resumen, leída de la ficha del turno.
 * La PC que tiene las ventas escribe esos números. Acá solo se suman.
 */
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'
import type { SoldHourBucket } from './summaryHours'
import { addDaysYmd } from './weekRange'
import { WEEKDAY_SHORT_LABELS, weekdayFromYmd } from './storeHours'
import {
  isWrittenAmount,
  shiftCloseBox,
  type ShiftCloseBox,
} from './shiftCloseBox'

export interface ShiftMoneyParts {
  soldTotal: number
  cashTotal: number
  cardWalletTotal: number
  debtTotal: number
  expenseTotal: number
  contributionTotal: number
  walletCashTotal: number
}

export interface SummaryShiftCard {
  id: string
  cashierName: string
  shiftType: 'morning' | 'evening'
  /** Solo para armar la fila cuando el resumen mira más de un local. */
  storeName?: string | null
  startedAt: string
  closedAt: string | null
  openingCash: number
  cashLeft: number | null
  withdrawn: number | null
  soldTotal: number | null
  cashTotal: number | null
  cardWalletTotal: number | null
  debtTotal: number | null
  expenseTotal: number | null
  contributionTotal: number | null
  walletCashTotal: number | null
  /** Null = la plata de ese turno todavía no llegó. */
  moneySnapshottedAt: string | null
  /** Turno abierto sumado para esta pantalla, sin sellar la ficha. */
  live: boolean
  /**
   * Débito, billetera y crédito leídos de las filas.
   * Null = este turno solo tiene el total agrupado.
   */
  paymentSplit?: PaymentSplit | null
  /**
   * 24 horas selladas en la ficha.
   * Null o ausente = sin dato. Veinticuatro ceros son un día sin ventas.
   */
  soldHours?: SoldHourBucket[] | null
  /**
   * Gastos a proveedores sellados en la ficha.
   * Ausente o null = esta ficha no entra en la cuenta. 0 es un dato.
   */
  providerExpenseTotal?: number | null
}

export interface PaymentSplit {
  debit: number
  wallet: number
  credit: number
}

/**
 * Efectivo que debería haber en la registradora al cierre.
 * Apertura + efectivo que entró + aportes + efectivo por digital − gastos.
 */
export function expectedRegisterCash(parts: {
  openingCash: number
  cashTotal: number
  contributionTotal: number
  walletCashTotal: number
  expenseTotal: number
}): number {
  return parts.openingCash
    + parts.cashTotal
    + parts.contributionTotal
    + parts.walletCashTotal
    - parts.expenseTotal
}

export interface TallySale {
  status: string
  total: number
  payments: { method: string; amount: number }[]
}

export interface TallyDebtEvent {
  eventType: string
  amount: number
  paymentMethod: string | null
}

export interface TallyMovement {
  kind: 'expense' | 'inject'
  amount: number
  injectReason: string | null
  concept: string | null
}

function isWalletCash(row: { injectReason: string | null; concept: string | null }): boolean {
  return row.injectReason === 'wallet_cash' || row.concept === 'Efectivo por digital'
}

function isCreatedDebt(eventType: string): boolean {
  return eventType === 'created' || eventType === 'debt'
}

/**
 * Misma cuenta que la PC arma desde SQLite al adoptar el cierre.
 * El efectivo por digital no es venta ni gasto.
 */
export interface TallyDeposit {
  method: string
  amount: number
}

function emptyPaymentSplit(): PaymentSplit {
  return { debit: 0, wallet: 0, credit: 0 }
}

function addToSplit(split: PaymentSplit, method: string, amount: number): boolean {
  if (method === 'debit') {
    split.debit += amount
    return true
  }
  if (method === 'wallet') {
    split.wallet += amount
    return true
  }
  if (method === 'credit') {
    split.credit += amount
    return true
  }
  return false
}

export function tallyShiftMoney(input: {
  sales: TallySale[]
  cashDeposits?: number
  cardDeposits?: number
  /** Si viene, reemplaza cashDeposits y cardDeposits y parte la seña por medio. */
  deposits?: TallyDeposit[]
  debtEvents: TallyDebtEvent[]
  movements: TallyMovement[]
}): ShiftMoneyParts & { paymentSplit: PaymentSplit } {
  const paymentSplit = emptyPaymentSplit()
  let soldTotal = 0
  let cashSales = 0
  let cardSales = 0
  for (const sale of input.sales) {
    if (sale.status !== 'confirmed') continue
    soldTotal += Number(sale.total) || 0
    for (const payment of sale.payments) {
      const amount = Number(payment.amount) || 0
      if (payment.method === 'cash') cashSales += amount
      else if (addToSplit(paymentSplit, payment.method, amount)) cardSales += amount
    }
  }

  let cashDeposits = input.cashDeposits ?? 0
  let cardDeposits = input.cardDeposits ?? 0
  if (input.deposits) {
    cashDeposits = 0
    cardDeposits = 0
    for (const deposit of input.deposits) {
      const amount = Number(deposit.amount) || 0
      if (deposit.method === 'cash') cashDeposits += amount
      else if (addToSplit(paymentSplit, deposit.method, amount)) cardDeposits += amount
    }
  }

  let cashDebt = 0
  let cardDebt = 0
  let debtTotal = 0
  for (const event of input.debtEvents) {
    if (event.paymentMethod) {
      const amount = Math.abs(Number(event.amount) || 0)
      if (event.paymentMethod === 'cash') cashDebt += amount
      else if (addToSplit(paymentSplit, event.paymentMethod, amount)) cardDebt += amount
      continue
    }
    if (isCreatedDebt(event.eventType)) debtTotal += Number(event.amount) || 0
  }

  let expenseTotal = 0
  let contributionTotal = 0
  let walletCashTotal = 0
  for (const row of input.movements) {
    const amount = Number(row.amount) || 0
    if (row.kind === 'inject') {
      if (isWalletCash(row)) walletCashTotal += amount
      else contributionTotal += amount
    } else {
      expenseTotal += amount
    }
  }

  return {
    soldTotal,
    cashTotal: cashSales + cashDeposits + cashDebt,
    cardWalletTotal: cardSales + cardDeposits + cardDebt,
    debtTotal,
    expenseTotal,
    contributionTotal,
    walletCashTotal,
    paymentSplit,
  }
}

export type ShiftMoneyAction = 'recompute' | 'live' | 'keep' | 'backfill' | 'pending'

/**
 * Qué hacer con la ficha.
 * Cerrada y ya escrita: se lee. No se vuelven a sumar las ventas.
 * Hoy cerrado y sin movimientos en esta máquina: no se inventa.
 * Ayer o antes, sin ficha: se suma una vez.
 * Hoy abierto: se suma para la pantalla y no se sella.
 */
export function shiftMoneyAction(input: {
  closedAt: string | null
  startedAt: string
  moneySnapshottedAt: string | null
  hasLocalLedger: boolean
  todayYmd: string
  timeZone?: string
}): ShiftMoneyAction {
  const zone = input.timeZone ?? DISPLAY_TIMEZONE
  const startedYmd = civilYmd(new Date(input.startedAt), zone)
  const closedYmd = input.closedAt ? civilYmd(new Date(input.closedAt), zone) : null
  if (input.closedAt && input.moneySnapshottedAt) return 'keep'
  if (input.hasLocalLedger) {
    return input.closedAt ? 'recompute' : 'live'
  }
  if (input.moneySnapshottedAt) return 'keep'
  if (!input.closedAt) {
    return startedYmd === input.todayYmd ? 'live' : 'pending'
  }
  if (closedYmd === input.todayYmd) return 'pending'
  return 'backfill'
}

export interface MoneyLine {
  label: string
  /** Null = todavía no llegó. No es un cero. */
  amount: number | null
}

export interface SummaryBoxRow {
  id: string
  cashierName: string
  shiftType: 'morning' | 'evening'
  storeName: string | null
  startedAt: string
  box: ShiftCloseBox
  /**
   * Aporte de esa caja. No entra en las estadísticas.
   * Si la diferencia no cierra sin este monto, el detalle puede mostrarlo.
   */
  contributionTotal: number | null
}

export interface SummaryMoneyView {
  lines: MoneyLine[]
  separate: MoneyLine[]
  /** Turnos cerrados o abiertos de hoy cuya plata no está en la ficha. */
  pendingCount: number
  boxes: SummaryBoxRow[]
}

function partsOf(card: SummaryShiftCard): ShiftMoneyParts | null {
  if (
    card.soldTotal == null
    || card.cashTotal == null
    || card.cardWalletTotal == null
    || card.debtTotal == null
    || card.expenseTotal == null
    || card.contributionTotal == null
    || card.walletCashTotal == null
  ) return null
  return {
    soldTotal: card.soldTotal,
    cashTotal: card.cashTotal,
    cardWalletTotal: card.cardWalletTotal,
    debtTotal: card.debtTotal,
    expenseTotal: card.expenseTotal,
    contributionTotal: card.contributionTotal,
    walletCashTotal: card.walletCashTotal,
  }
}

function cardHasMoney(card: SummaryShiftCard): boolean {
  if (card.live) return partsOf(card) != null
  return card.moneySnapshottedAt != null && partsOf(card) != null
}

export function summaryMoneyView(cards: SummaryShiftCard[]): SummaryMoneyView {
  const totals: ShiftMoneyParts = {
    soldTotal: 0,
    cashTotal: 0,
    cardWalletTotal: 0,
    debtTotal: 0,
    expenseTotal: 0,
    contributionTotal: 0,
    walletCashTotal: 0,
  }
  let arrived = 0
  let pendingCount = 0
  const boxes: SummaryBoxRow[] = []

  for (const card of cards) {
    const parts = partsOf(card)
    if (cardHasMoney(card) && parts) {
      arrived += 1
      totals.soldTotal += parts.soldTotal
      totals.cashTotal += parts.cashTotal
      totals.cardWalletTotal += parts.cardWalletTotal
      totals.expenseTotal += parts.expenseTotal
      totals.contributionTotal += parts.contributionTotal
      totals.walletCashTotal += parts.walletCashTotal
    } else {
      pendingCount += 1
    }

    if (!card.closedAt) continue
    const expected = cardHasMoney(card) && parts
      ? expectedRegisterCash({
        openingCash: card.openingCash,
        cashTotal: parts.cashTotal,
        contributionTotal: parts.contributionTotal,
        walletCashTotal: parts.walletCashTotal,
        expenseTotal: parts.expenseTotal,
      })
      : null
    boxes.push({
      id: card.id,
      cashierName: card.cashierName,
      shiftType: card.shiftType,
      storeName: card.storeName ?? null,
      startedAt: card.startedAt,
      contributionTotal: cardHasMoney(card) && parts ? parts.contributionTotal : null,
      box: shiftCloseBox({
        cashLeft: card.cashLeft,
        withdrawn: card.withdrawn,
        expectedCash: expected,
      }),
    })
  }

  boxes.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id))

  const amount = (value: number): number | null => {
    if (cards.length === 0) return 0
    if (arrived === 0) return null
    return value
  }
  return {
    lines: [
      { label: 'Vendió', amount: amount(totals.soldTotal) },
      { label: 'Entró en efectivo', amount: amount(totals.cashTotal) },
      { label: 'Tarjeta y billetera', amount: amount(totals.cardWalletTotal) },
      { label: 'Gastos', amount: amount(totals.expenseTotal) },
    ],
    separate: [
      { label: 'Aportes', amount: amount(totals.contributionTotal) },
      { label: 'Efectivo por digital', amount: amount(totals.walletCashTotal) },
    ],
    pendingCount,
    boxes,
  }
}

export function pickWrittenAmount(
  local: number | null | undefined,
  remote: number | null | undefined,
): number | null {
  if (isWrittenAmount(local)) return local
  if (isWrittenAmount(remote)) return remote
  return null
}

export interface SaleSplitSlice {
  key: 'cash' | 'card'
  label: string
  amount: number
  fraction: number
}

/** La torta usa efectivo y tarjeta, los mismos números del texto. */
export function saleSplitSlices(
  cash: number,
  cardWallet: number,
): SaleSplitSlice[] {
  const rows: SaleSplitSlice[] = [
    { key: 'cash', label: 'Entró en efectivo', amount: Math.max(0, cash), fraction: 0 },
    { key: 'card', label: 'Tarjeta y billetera', amount: Math.max(0, cardWallet), fraction: 0 },
  ]
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  if (total <= 0) return rows
  for (const row of rows) row.fraction = row.amount / total
  return rows
}

/**
 * Montos que se ven en las estadísticas.
 * Aportes no está: sigue solo dentro del efectivo esperado de la caja.
 */
export function summaryShownAmounts(view: SummaryMoneyView): {
  vendio: number | null
  efectivo: number | null
  tarjeta: number | null
  gastos: number | null
  digital: number | null
} {
  return {
    vendio: view.lines[0]?.amount ?? null,
    efectivo: view.lines[1]?.amount ?? null,
    tarjeta: view.lines[2]?.amount ?? null,
    gastos: view.lines[3]?.amount ?? null,
    digital: view.separate[1]?.amount ?? null,
  }
}

/**
 * Fiado nuevo del período: debtTotal de las fichas que llegaron.
 * Un turno sin ficha no suma cero. Si no llegó ninguna, null.
 */
export const PAYMENT_SPLIT_GAP_CAUSE =
  'Las filas de débito, billetera y crédito no suman el total de la ficha.'

export interface PaymentGap {
  shiftId: string
  /** Total de la ficha menos la suma del desglose. No se corrige el número. */
  difference: number
  cause: string
}

export interface SummaryPaymentBreakdown {
  /** Null = ningún turno con ficha tiene las filas. No es un cero. */
  debit: number | null
  wallet: number | null
  credit: number | null
  /** Turnos con ficha y sin filas. Los que no tienen ficha no entran. */
  totalOnlyCount: number
  gaps: PaymentGap[]
}

/** Débito, billetera y crédito de las fichas que tienen filas. */
export function summaryPaymentBreakdown(cards: SummaryShiftCard[]): SummaryPaymentBreakdown {
  let debit = 0
  let wallet = 0
  let credit = 0
  let known = 0
  let totalOnlyCount = 0
  const gaps: PaymentGap[] = []
  for (const card of cards) {
    const parts = partsOf(card)
    if (!cardHasMoney(card) || !parts) continue
    const split = card.paymentSplit
    if (split == null) {
      totalOnlyCount += 1
      continue
    }
    known += 1
    debit += split.debit
    wallet += split.wallet
    credit += split.credit
    const splitTotal = split.debit + split.wallet + split.credit
    if (Math.round(splitTotal) !== Math.round(parts.cardWalletTotal)) {
      gaps.push({
        shiftId: card.id,
        difference: parts.cardWalletTotal - splitTotal,
        cause: PAYMENT_SPLIT_GAP_CAUSE,
      })
    }
  }
  if (known === 0) {
    return { debit: null, wallet: null, credit: null, totalOnlyCount, gaps }
  }
  return { debit, wallet, credit, totalOnlyCount, gaps }
}

export function summaryNewDebt(cards: SummaryShiftCard[]): number | null {
  let arrived = 0
  let total = 0
  for (const card of cards) {
    const parts = partsOf(card)
    if (!cardHasMoney(card) || !parts) continue
    arrived += 1
    total += parts.debtTotal
  }
  if (arrived === 0) return null
  return total
}

export interface SoldDayBar {
  ymd: string
  label: string
  /** Null = ese día no tiene ficha. No es un vendido en cero. */
  amount: number | null
}

/**
 * Una barra por día civil del rango, de startYmd a endYmd inclusive.
 * Suma soldTotal de las fichas de ese día. Sin ficha, amount es null.
 */
export function summarySoldByDay(
  cards: SummaryShiftCard[],
  startYmd: string,
  endYmd: string,
  timeZone = DISPLAY_TIMEZONE,
): SoldDayBar[] {
  if (!startYmd || !endYmd || startYmd > endYmd) return []
  const days: string[] = []
  let ymd = startYmd
  while (ymd <= endYmd && days.length < 45) {
    days.push(ymd)
    ymd = addDaysYmd(ymd, 1)
  }
  const many = days.length > 7
  return days.map(day => {
    let arrived = false
    let total = 0
    for (const card of cards) {
      if (civilYmd(new Date(card.startedAt), timeZone) !== day) continue
      const parts = partsOf(card)
      if (!cardHasMoney(card) || !parts) continue
      arrived = true
      total += parts.soldTotal
    }
    const label = many
      ? `${day.slice(8, 10)}/${day.slice(5, 7)}`
      : WEEKDAY_SHORT_LABELS[weekdayFromYmd(day)]
    return { ymd: day, label, amount: arrived ? total : null }
  })
}

/**
 * Aportes de una caja con diferencia. Null si no hace falta para leerla.
 */
export function boxAporteAmount(row: SummaryBoxRow): number | null {
  if (row.box.kind !== 'difference') return null
  if (row.contributionTotal == null || row.contributionTotal === 0) return null
  return row.contributionTotal
}

/** Fecha, mañana/tarde y quién. El local entra solo si el resumen suma varios. */
export function summaryBoxLabel(
  row: Pick<SummaryBoxRow, 'startedAt' | 'shiftType' | 'cashierName' | 'storeName'>,
  showStore: boolean,
  timeZone = DISPLAY_TIMEZONE,
): string {
  const ymd = civilYmd(new Date(row.startedAt), timeZone)
  const day = `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
  const turn = row.shiftType === 'morning' ? 'Mañana' : 'Tarde'
  const who = showStore && row.storeName ? `${row.storeName} · ${row.cashierName}` : row.cashierName
  return `${day} · ${turn} · ${who}`
}
