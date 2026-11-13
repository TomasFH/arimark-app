/**
 * Fiados del resumen. La PC los arma con eventos que ya están en SQLite.
 * El celu no baja el libro: cobros y deuda de ahora quedan pendientes.
 */
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'

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

/**
 * Saldo que muestra Fiados para un local.
 * Suma clientes con saldo de ese local > 0 y saldo global > 0.
 * Sin eventos de ese local, null.
 */
export function storeFiadoBalance(
  storeId: string,
  events: Pick<LedgerEvent, 'customerId' | 'storeId' | 'amount'>[],
): number | null {
  const local = new Map<string, number>()
  const global = new Map<string, number>()
  for (const event of events) {
    global.set(event.customerId, (global.get(event.customerId) ?? 0) + event.amount)
    if (event.storeId !== storeId) continue
    local.set(event.customerId, (local.get(event.customerId) ?? 0) + event.amount)
  }
  if (local.size === 0) return null
  let total = 0
  for (const [customerId, balance] of local) {
    if (balance <= 0.01) continue
    if ((global.get(customerId) ?? 0) <= 0.01) continue
    total += balance
  }
  return total
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
