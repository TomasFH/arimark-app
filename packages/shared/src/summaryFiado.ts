/**
 * Fiados del resumen. La PC los arma con eventos que ya están en SQLite.
 * El celu no baja el libro: cobros y deuda de ahora quedan pendientes.
 *
 * La deuda de ahora del dueño no recorre el libro: usa el checkpoint
 * más la cola que el login ya tiene en memoria.
 */
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'
import {
  liveSaldoFromCheckpoint,
  type CompactableDebtEvent,
  type DebtCheckpointFields,
} from './debtCheckpoint'

export interface SummaryPayment {
  /** Pesos del cobro, en positivo. */
  amount: number
  createdAt: string
  /** Null = se cobró sin turno abierto. */
  shiftId: string | null
}

export interface SummaryFiadoSlice {
  /** Null = ese local no tiene eventos en la base. No es cero. */
  debtNow: number | null
  /**
   * Null = no hay eventos, no se sabe si cobraron.
   * [] = hay libro y en el rango no hubo cobros.
   */
  payments: SummaryPayment[] | null
}

export interface LedgerEvent {
  customerId: string
  storeId: string
  eventType: string
  amount: number
  createdAt: string
  shiftId: string | null
}

export interface PeriodCollections {
  total: number
  /** Cobros con shiftId vacío. Ya están dentro de total. */
  unshifted: number
}

const PAYMENT_TYPES = new Set(['paid', 'partial_payment'])

/** Un centavo o menos no es deuda. La misma regla que la pantalla de Fiados. */
const BALANCE_DUST = 0.01

interface StoreBalance {
  customerId: string
  storeId: string
  balance: number
}

/**
 * Suma clientes con saldo de ese local por encima del polvo y saldo global igual.
 * Sin filas de ese local, null. Un saldo en cero no se cuenta como deuda.
 */
function sumStoreBalances(storeId: string, rows: StoreBalance[]): number | null {
  const local = new Map<string, number>()
  const global = new Map<string, number>()
  for (const row of rows) {
    global.set(row.customerId, (global.get(row.customerId) ?? 0) + row.balance)
    if (row.storeId !== storeId) continue
    local.set(row.customerId, (local.get(row.customerId) ?? 0) + row.balance)
  }
  if (local.size === 0) return null
  let total = 0
  for (const [customerId, balance] of local) {
    if (balance <= BALANCE_DUST) continue
    if ((global.get(customerId) ?? 0) <= BALANCE_DUST) continue
    total += balance
  }
  return total
}

/**
 * Saldo que muestra Fiados para un local.
 * Suma clientes con saldo de ese local > 0 y saldo global > 0.
 * Sin eventos de ese local, null.
 */
export function storeFiadoBalance(
  storeId: string,
  events: Pick<LedgerEvent, 'customerId' | 'storeId' | 'amount'>[],
): number | null {
  return sumStoreBalances(storeId, events.map(event => ({
    customerId: event.customerId,
    storeId: event.storeId,
    balance: event.amount,
  })))
}

/** Par cliente + local, con el checkpoint y la cola todavía no plegada. */
export interface CustomerLivePair {
  customerId: string
  storeId: string
  checkpoint: DebtCheckpointFields
  events: CompactableDebtEvent[]
}

/**
 * Deuda de ahora de un local, con los pares que el login ya escuchó.
 * Sin pares de ese local, null. No es cero.
 * Un saldo de un centavo o menos no suma. Si el cliente no debe en el
 * total de los locales, su saldo local tampoco.
 */
export function storeLiveFiadoBalance(
  storeId: string,
  pairs: CustomerLivePair[],
): number | null {
  const byPair = new Map<string, StoreBalance>()
  for (const pair of pairs) {
    if (pair.checkpoint.kind !== 'customer') continue
    byPair.set(`${pair.customerId}\0${pair.storeId}`, {
      customerId: pair.customerId,
      storeId: pair.storeId,
      balance: liveSaldoFromCheckpoint('customer', pair.checkpoint, pair.events),
    })
  }
  return sumStoreBalances(storeId, [...byPair.values()])
}

/** Cobros del rango y saldo de ahora, para un local. */
export function storeFiadoSlice(
  storeId: string,
  events: LedgerEvent[],
  startIso: string,
  endIso: string,
): SummaryFiadoSlice {
  const mine = events.filter(event => event.storeId === storeId)
  if (mine.length === 0) return { debtNow: null, payments: null }
  const payments: SummaryPayment[] = []
  for (const event of mine) {
    if (!PAYMENT_TYPES.has(event.eventType)) continue
    if (event.createdAt < startIso || event.createdAt >= endIso) continue
    payments.push({
      amount: Math.abs(event.amount),
      createdAt: event.createdAt,
      shiftId: event.shiftId,
    })
  }
  return {
    debtNow: storeFiadoBalance(storeId, events),
    payments,
  }
}

/**
 * Todos los locales: suma local por local.
 * Un local sin eventos no entra como cero. Si ninguno tiene, queda null.
 */
export function combineFiadoSlices(slices: SummaryFiadoSlice[]): SummaryFiadoSlice {
  const knownDebt = slices.filter(slice => slice.debtNow != null)
  const knownPay = slices.filter(slice => slice.payments != null)
  return {
    debtNow: knownDebt.length === 0
      ? null
      : knownDebt.reduce((sum, slice) => sum + (slice.debtNow ?? 0), 0),
    payments: knownPay.length === 0
      ? null
      : knownPay.flatMap(slice => slice.payments ?? []),
  }
}

export function paymentsInCivilRange(
  payments: SummaryPayment[],
  startYmd: string,
  endYmd: string,
  timeZone = DISPLAY_TIMEZONE,
): SummaryPayment[] {
  return payments.filter(payment => {
    const ymd = civilYmd(new Date(payment.createdAt), timeZone)
    return ymd >= startYmd && ymd <= endYmd
  })
}

export function sumCollections(payments: SummaryPayment[]): PeriodCollections {
  let total = 0
  let unshifted = 0
  for (const payment of payments) {
    const amount = Math.abs(payment.amount)
    total += amount
    if (!payment.shiftId) unshifted += amount
  }
  return { total, unshifted }
}

/**
 * Solo si hay cobros sin turno. No dice que el resto ya esté en efectivo o tarjeta.
 */
export function collectionNote(unshifted: number): string | null {
  if (!(unshifted > 0)) return null
  return 'Hay cobros sin turno. No entran en efectivo ni en tarjeta.'
}

/** Tope de la consulta del período. 500 documentos llenos no alcanzan para un total. */
export const PERIOD_FIADO_LIMIT = 500

const NEW_DEBT_TYPES = new Set(['created', 'debt', 'reopened'])

export interface PeriodFiadoAccount {
  /** Null si el período no entró en el tope. No es la suma parcial. */
  newDebt: number | null
  /** Null si el período no entró en el tope. Incluye los cobros sin turno. */
  collections: number | null
  /** Parte de collections cobrada sin turno. Null junto con collections. */
  unshifted: number | null
  incomplete: boolean
}

/**
 * Fiado nuevo y cobros de un período.
 * startIso es la medianoche civil de Argentina inclusive; endIso, la siguiente exclusive.
 * El mismo corte que Compras. No lee Firestore: solo transforma la lista.
 * Si la lista llega al tope, no hay número: queda incompleto.
 */
export function periodFiadoAccount(
  events: Array<Pick<LedgerEvent, 'eventType' | 'amount' | 'createdAt' | 'shiftId'>>,
  startIso: string,
  endIso: string,
  limit = PERIOD_FIADO_LIMIT,
): PeriodFiadoAccount {
  if (events.length >= limit) {
    return { newDebt: null, collections: null, unshifted: null, incomplete: true }
  }
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  let newDebt = 0
  let collections = 0
  let unshifted = 0
  for (const event of events) {
    const at = Date.parse(event.createdAt)
    if (!Number.isFinite(at) || !Number.isFinite(start) || !Number.isFinite(end)) continue
    if (at < start || at >= end) continue
    const amount = Math.abs(event.amount)
    if (NEW_DEBT_TYPES.has(event.eventType)) {
      newDebt += amount
    } else if (PAYMENT_TYPES.has(event.eventType)) {
      collections += amount
      if (!event.shiftId) unshifted += amount
    }
  }
  return { newDebt, collections, unshifted, incomplete: false }
}
