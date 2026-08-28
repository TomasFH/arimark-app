/**
 * Parseo de señas (depósitos de pedidos).
 *
 * El cierre de caja y el historial deben usar la misma fórmula:
 * si existe `depositPayments` (JSON mixto efectivo + digital), se desglosa
 * por medio; si no, se usa el campo legado `depositMethod`.
 */

export interface DepositRowLike {
  depositAmount: number
  depositMethod?: string | null
  depositPayments?: string | null
}

export interface DepositPaymentLike {
  method: string
  amount: number
}

export interface DepositMethodTotals {
  cash: number
  debit: number
  wallet: number
  credit: number
}

export function parseDepositPayments(raw: string | null | undefined): DepositPaymentLike[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const payments: DepositPaymentLike[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const rec = item as { method?: unknown; amount?: unknown }
      const method = typeof rec.method === 'string' ? rec.method : ''
      const amount = typeof rec.amount === 'number' ? rec.amount : Number(rec.amount) || 0
      if (!method) continue
      payments.push({ method, amount })
    }
    return payments.length > 0 ? payments : null
  } catch {
    return null
  }
}

export function emptyDepositTotals(): DepositMethodTotals {
  return { cash: 0, debit: 0, wallet: 0, credit: 0 }
}

/** Suma el efectivo de una seña (JSON mixto o campo legado). */
export function cashAmountFromDeposit(row: DepositRowLike): number {
  const payments = parseDepositPayments(row.depositPayments)
  if (payments) {
    return payments.reduce((sum, p) => sum + (p.method === 'cash' ? p.amount : 0), 0)
  }
  return row.depositMethod === 'cash' ? row.depositAmount : 0
}

/** Suma lo digital (débito / billetera / crédito) de una seña. */
export function digitalAmountFromDeposit(row: DepositRowLike): number {
  const payments = parseDepositPayments(row.depositPayments)
  if (payments) {
    return payments.reduce((sum, p) => sum + (p.method !== 'cash' ? p.amount : 0), 0)
  }
  return row.depositMethod && row.depositMethod !== 'cash' ? row.depositAmount : 0
}

export function addDepositToTotals(row: DepositRowLike, totals: DepositMethodTotals): void {
  const payments = parseDepositPayments(row.depositPayments)
  if (payments) {
    for (const p of payments) {
      if (p.method === 'cash') totals.cash += p.amount
      else if (p.method === 'debit') totals.debit += p.amount
      else if (p.method === 'wallet') totals.wallet += p.amount
      else if (p.method === 'credit') totals.credit += p.amount
    }
    return
  }
  if (!row.depositMethod) return
  if (row.depositMethod === 'cash') totals.cash += row.depositAmount
  else if (row.depositMethod === 'debit') totals.debit += row.depositAmount
  else if (row.depositMethod === 'wallet') totals.wallet += row.depositAmount
  else if (row.depositMethod === 'credit') totals.credit += row.depositAmount
}

/** Normaliza depositPayments de Firestore (string JSON o array ya parseado). */
export function depositPaymentsToJson(raw: unknown): string | null {
  if (raw == null || raw === '' || raw === 0) return null
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return JSON.stringify(raw)
  return null
}
