/**
 * Detalle de gastos del resumen. Solo filas que ya están en SQLite.
 * kind inject (aporte y efectivo por digital) no entra.
 * El total se compara con expenseTotal de las fichas. No se inventan filas.
 */
import { isMerchIntakeExpenseConcept } from './merchIntake'
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'
import type { SummaryShiftCard } from './summaryMoney'

export const EXPENSE_ORIGINS = ['Mercadería', 'Salario', 'Vale', 'Gasto'] as const

export type ExpenseOrigin = (typeof EXPENSE_ORIGINS)[number]

export const EXPENSE_GAP_NO_ROWS = 'La ficha llegó sin las filas de gastos.'

export const EXPENSE_GAP_SHORT = 'Las filas no alcanzan el total de la ficha.'

export const EXPENSE_GAP_OVER = 'Las filas superan el total de la ficha.'

const VALE_RE = /^vale\s*:/i
const SALARIO_RE = /^salario\s*:/i

export interface SummaryExpenseInput {
  id: string
  shiftId: string
  createdAt: string
  concept: string | null
  providerName: string | null
  amount: number
  notes: string | null
  kind: string
  storeName?: string | null
}

export interface ExpenseRow {
  id: string
  shiftId: string
  createdAt: string
  ymd: string
  storeName: string
  concept: string
  providerName: string
  amount: number
  notes: string | null
  origin: ExpenseOrigin
}

export interface ExpenseGroup {
  key: string
  label: string
  amount: number
}

export interface ExpenseOriginTotal {
  origin: ExpenseOrigin
  amount: number
}

export interface ExpenseGap {
  difference: number
  cause: string
  shiftIds: string[]
}

export interface ExpenseSummaryView {
  rows: ExpenseRow[]
  byProvider: ExpenseGroup[]
  byConcept: ExpenseGroup[]
  byOrigin: ExpenseOriginTotal[]
  /** Null si no hay filas. No es un cero. */
  rowTotal: number | null
  gap: ExpenseGap | null
}

export function expenseOrigin(concept: string | null | undefined): ExpenseOrigin {
  const text = concept?.trim() ?? ''
  if (VALE_RE.test(text)) return 'Vale'
  if (SALARIO_RE.test(text)) return 'Salario'
  if (isMerchIntakeExpenseConcept(text)) return 'Mercadería'
  return 'Gasto'
}

/** Minúsculas y un solo espacio. El texto vacío no es una clave de grupo. */
export function expenseGroupKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function fichaExpense(card: SummaryShiftCard): number | null {
  if (
    card.soldTotal == null
    || card.cashTotal == null
    || card.cardWalletTotal == null
    || card.debtTotal == null
    || card.expenseTotal == null
    || card.contributionTotal == null
    || card.walletCashTotal == null
  ) return null
  if (!card.live && card.moneySnapshottedAt == null) return null
  return card.expenseTotal
}

function groupRows(
  rows: ExpenseRow[],
  pick: (row: ExpenseRow) => { key: string; label: string },
  emptyLabel: string,
): ExpenseGroup[] {
  const groups = new Map<string, ExpenseGroup>()
  for (const row of rows) {
    const picked = pick(row)
    const key = picked.key || emptyLabel
    const current = groups.get(key) ?? {
      key,
      label: picked.key ? picked.label : emptyLabel,
      amount: 0,
    }
    current.amount += row.amount
    groups.set(key, current)
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'es') || a.key.localeCompare(b.key))
}

export function summarizeExpenses(
  lines: SummaryExpenseInput[],
  cards: SummaryShiftCard[],
  timeZone = DISPLAY_TIMEZONE,
): ExpenseSummaryView {
  const counted = new Map<string, { expenseTotal: number; cashierName: string }>()
  for (const card of cards) {
    const expenseTotal = fichaExpense(card)
    if (expenseTotal == null) continue
    counted.set(card.id, { expenseTotal, cashierName: card.cashierName })
  }

  const rows: ExpenseRow[] = []
  for (const line of lines) {
    if (line.kind === 'inject') continue
    if (!counted.has(line.shiftId)) continue
    if (!Number.isFinite(line.amount)) continue
    const concept = line.concept?.trim() ?? ''
    const provider = line.providerName?.trim() ?? ''
    const notes = line.notes?.trim() || null
    rows.push({
      id: line.id,
      shiftId: line.shiftId,
      createdAt: line.createdAt,
      ymd: civilYmd(new Date(line.createdAt), timeZone),
      storeName: line.storeName?.trim() ?? '',
      concept: concept || 'Sin concepto',
      providerName: provider || 'Sin proveedor',
      amount: line.amount,
      notes,
      origin: expenseOrigin(line.concept),
    })
  }
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

  const byConcept = groupRows(
    rows,
    row => ({
      key: row.concept === 'Sin concepto' ? '' : expenseGroupKey(row.concept),
      label: row.concept,
    }),
    'Sin concepto',
  )
  const byProvider = groupRows(
    rows,
    row => ({
      key: row.providerName === 'Sin proveedor' ? '' : expenseGroupKey(row.providerName),
      label: row.providerName,
    }),
    'Sin proveedor',
  )

  const originAmounts = new Map<ExpenseOrigin, number>()
  for (const row of rows) {
    originAmounts.set(row.origin, (originAmounts.get(row.origin) ?? 0) + row.amount)
  }
  const byOrigin = EXPENSE_ORIGINS
    .filter(origin => originAmounts.has(origin))
    .map(origin => ({ origin, amount: originAmounts.get(origin) ?? 0 }))

  let cardTotal = 0
  const missing: string[] = []
  for (const [shiftId, ficha] of counted) {
    cardTotal += ficha.expenseTotal
    const hasRow = rows.some(row => row.shiftId === shiftId)
    if (!hasRow && ficha.expenseTotal !== 0) missing.push(shiftId)
  }
  const rowSum = rows.reduce((sum, row) => sum + row.amount, 0)
  const difference = counted.size === 0 ? 0 : cardTotal - rowSum
  let gap: ExpenseGap | null = null
  if (counted.size > 0 && Math.round(difference) !== 0) {
    gap = {
      difference,
      cause: missing.length > 0
        ? EXPENSE_GAP_NO_ROWS
        : difference > 0
          ? EXPENSE_GAP_SHORT
          : EXPENSE_GAP_OVER,
      shiftIds: missing,
    }
  }

  return {
    rows,
    byProvider,
    byConcept,
    byOrigin,
    rowTotal: rows.length > 0 ? rowSum : null,
    gap,
  }
}
