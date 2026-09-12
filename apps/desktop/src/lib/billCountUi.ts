import {
  ARS_BILL_DENOMINATIONS,
  compactBillLines,
  type BillLine,
} from '@carniceria/shared'
import { formatNumericInputValue, parseNumericInput } from './numericInput'

export type BillMode = 'quantity' | 'total'

export interface BillRowState {
  denomination: number
  quantity: string
  total: string
  totalError: string | null
}

export function emptyBillRows(): BillRowState[] {
  return ARS_BILL_DENOMINATIONS.map(d => ({
    denomination: d,
    quantity: '',
    total: '',
    totalError: null,
  }))
}

export function billRowsFromLines(lines: BillLine[]): BillRowState[] {
  const qty = new Map(compactBillLines(lines).map(l => [l.denomination, l.quantity]))
  return ARS_BILL_DENOMINATIONS.map(d => {
    const q = qty.get(d) ?? 0
    return {
      denomination: d,
      quantity: q > 0 ? formatNumericInputValue(String(q)) : '',
      total: q > 0 ? formatNumericInputValue(String(d * q)) : '',
      totalError: null,
    }
  })
}

export function billRowsToLines(rows: BillRowState[], mode: BillMode): BillLine[] {
  return compactBillLines(rows.map(r => {
    const qty = mode === 'quantity'
      ? (parseNumericInput(r.quantity) ?? 0)
      : Math.round((parseNumericInput(r.total) ?? 0) / r.denomination)
    return { denomination: r.denomination, quantity: Number.isFinite(qty) ? qty : 0 }
  }))
}

export function billRowsCountedTotal(rows: BillRowState[], mode: BillMode): number {
  return rows.reduce((acc, r) => {
    if (mode === 'quantity') return acc + r.denomination * (parseNumericInput(r.quantity) ?? 0)
    return acc + (parseNumericInput(r.total) ?? 0)
  }, 0)
}

export function cashAmountToInput(amount: number): string {
  if (amount <= 0) return '0'
  return formatNumericInputValue(String(amount))
}
