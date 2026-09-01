import { parseNumericInput } from './numericInput'
import type { PaymentMethod, SalePaymentDraft } from '../types/pos'

const METHODS: PaymentMethod[] = ['cash', 'debit', 'wallet', 'credit']

/** Cuánto falta asignar a `field` para cubrir `total`, ignorando lo ya puesto en ese campo. */
export function remainderForField(
  total: number,
  amounts: Record<string, string>,
  field: string,
): number {
  const others = Object.entries(amounts)
    .filter(([key]) => key !== field)
    .reduce((sum, [, value]) => sum + (parseNumericInput(value) ?? 0), 0)
  return Math.max(0, Math.round(total - others))
}

export function paidTotal(amounts: Record<string, string>): number {
  return Object.values(amounts).reduce((sum, value) => sum + (parseNumericInput(value) ?? 0), 0)
}

export function methodAmount(amounts: Record<string, string>, method: string): number {
  return parseNumericInput(amounts[method] ?? '') ?? 0
}

export function nonCashPaid(amounts: Record<string, string>): number {
  return METHODS
    .filter(m => m !== 'cash')
    .reduce((sum, m) => sum + methodAmount(amounts, m), 0)
}

export interface SettledSalePayments {
  payments: SalePaymentDraft[]
  /** Vuelto a entregar (solo efectivo puro, como en PC). */
  change: number
  /** Cuánto falta para cubrir el total (0 si hay vuelto o está justo). */
  remaining: number
  canConfirm: boolean
  /** Débito/billetera/crédito superan el total: no hay vuelto. */
  mixedOverage: boolean
}

/**
 * Igual que en PC: si el cliente paga solo en efectivo y entrega de más,
 * se registra el total (el resto es vuelto). En cobro mixto la suma tiene
 * que dar justo. `allowPartial` = fiado (puede pagar menos).
 */
export function settleSalePayments(
  total: number,
  amounts: Record<string, string>,
  opts?: { allowPartial?: boolean },
): SettledSalePayments {
  const allowPartial = opts?.allowPartial === true
  const cash = methodAmount(amounts, 'cash')
  const others = nonCashPaid(amounts)
  const paid = cash + others
  const cashOnly = others <= 0.005

  if (cashOnly && cash > total + 0.005) {
    return {
      payments: [{ paymentMethod: 'cash', amount: Math.round(total) }],
      change: Math.round(cash - total),
      remaining: 0,
      canConfirm: true,
      mixedOverage: false,
    }
  }

  const remaining = Math.round((total - paid) * 100) / 100
  const mixedOverage = !cashOnly && remaining < -0.5
  const payments: SalePaymentDraft[] = METHODS
    .map(method => ({ paymentMethod: method, amount: methodAmount(amounts, method) }))
    .filter(p => p.amount > 0.005)

  if (mixedOverage) {
    return { payments, change: 0, remaining, canConfirm: false, mixedOverage: true }
  }

  const covered = Math.abs(remaining) < 0.5 && paid > 0.005
  const canConfirm = allowPartial ? remaining >= -0.5 : covered

  return { payments, change: 0, remaining, canConfirm, mixedOverage: false }
}
