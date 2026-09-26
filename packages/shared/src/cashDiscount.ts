import type { Weekday } from './storeHours'

export interface CashDiscountRule {
  /** Mínimo del total de ítems (pesos enteros). */
  minAmount: number
  /** 0 = apagado; 1–100 = porcentaje entero. */
  percent: number
}

/** Turno de caja. En SQLite/POS el de la tarde es `evening`. */
export type CashDiscountShiftKind = 'morning' | 'afternoon' | 'evening'

/**
 * Días que comparten min + % por turno.
 * Un día sin bloque usa la regla general del local.
 * Un día en un bloque con 0 % apaga el descuento en ese turno.
 */
export interface CashDiscountBlock {
  days: Weekday[]
  morning: CashDiscountRule
  afternoon: CashDiscountRule
}

export interface CashDiscountQuote {
  eligible: boolean
  discountAmount: number
  discountPercent: number
  /** itemTotal − discount si aplica; si no, itemTotal. */
  discountedTotal: number
  /**
   * Lo que hay que cobrar ahora.
   * Con descuento: discountedTotal − seña.
   * Sin descuento: itemTotal − seña (comportamiento legado).
   */
  amountDue: number
}

export function normalizeCashDiscountRule(
  minAmount: unknown,
  percent: unknown,
): CashDiscountRule {
  const min = typeof minAmount === 'number' && Number.isFinite(minAmount)
    ? Math.max(0, Math.round(minAmount))
    : 0
  const pct = typeof percent === 'number' && Number.isFinite(percent)
    ? Math.min(100, Math.max(0, Math.round(percent)))
    : 0
  return { minAmount: min, percent: pct }
}

export function roundCashDiscount(itemTotal: number, percent: number): number {
  if (percent <= 0 || itemTotal <= 0) return 0
  return Math.round((itemTotal * percent) / 100)
}

export function remainderIncludesCash(
  payments: Array<{ paymentMethod: string; amount: number }>,
): boolean {
  return payments.some(p => p.paymentMethod === 'cash' && p.amount > 0)
}

/**
 * Condiciones de la regla + seña. No mira el mix del saldo
 * (eso va en `remainderIncludesCash`).
 */
export function cashDiscountPreconditions(input: {
  rule: CashDiscountRule
  itemTotal: number
  isDebt: boolean
  depositAmount: number
  depositDigitalAmount: number
}): boolean {
  if (input.isDebt) return false
  if (input.rule.percent <= 0) return false
  if (Math.round(input.itemTotal) < input.rule.minAmount) return false
  if (input.depositAmount > 0 && input.depositDigitalAmount > 0) return false
  return true
}

export function quoteCashDiscount(input: {
  rule: CashDiscountRule
  itemTotal: number
  isDebt?: boolean
  depositAmount?: number
  depositDigitalAmount?: number
  remainderIncludesCash: boolean
}): CashDiscountQuote {
  const itemTotal = Math.round(input.itemTotal)
  const deposit = Math.max(0, Math.round(input.depositAmount ?? 0))
  const pre = cashDiscountPreconditions({
    rule: input.rule,
    itemTotal,
    isDebt: input.isDebt === true,
    depositAmount: deposit,
    depositDigitalAmount: Math.max(0, Math.round(input.depositDigitalAmount ?? 0)),
  })
  const eligible = pre && input.remainderIncludesCash
  const discountAmount = eligible ? roundCashDiscount(itemTotal, input.rule.percent) : 0
  const discountedTotal = eligible ? Math.max(0, itemTotal - discountAmount) : itemTotal
  const amountDue = Math.max(0, (eligible ? discountedTotal : itemTotal) - deposit)
  return {
    eligible,
    discountAmount,
    discountPercent: eligible ? input.rule.percent : 0,
    discountedTotal,
    amountDue,
  }
}

/** `sale.total` persistido: con descuento es el total de ítems ya descontado; si no, ítems − seña. */
export function saleTotalFromQuote(
  quote: CashDiscountQuote,
  itemTotal: number,
  depositAmount: number,
): number {
  if (quote.eligible) return quote.discountedTotal
  return Math.max(0, Math.round(itemTotal) - Math.max(0, Math.round(depositAmount)))
}

function uniqueSortedDays(days: Weekday[]): Weekday[] {
  return [...new Set(days)]
    .filter((d): d is Weekday => d === 0 || d === 1 || d === 2 || d === 3 || d === 4 || d === 5 || d === 6)
    .sort((a, b) => a - b)
}

function parseRuleFields(raw: unknown): CashDiscountRule {
  if (!raw || typeof raw !== 'object') return { minAmount: 0, percent: 0 }
  const rec = raw as Record<string, unknown>
  return normalizeCashDiscountRule(rec.minAmount, rec.percent)
}

export function emptyDiscountBlock(days: Weekday[] = []): CashDiscountBlock {
  return {
    days: uniqueSortedDays(days),
    morning: { minAmount: 0, percent: 0 },
    afternoon: { minAmount: 0, percent: 0 },
  }
}

export function parseCashDiscountSchedule(raw: unknown): CashDiscountBlock[] {
  let value: unknown = raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      value = JSON.parse(trimmed) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const out: CashDiscountBlock[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const daysRaw = Array.isArray(rec.days) ? rec.days : []
    const days = uniqueSortedDays(
      daysRaw.filter((d): d is Weekday =>
        d === 0 || d === 1 || d === 2 || d === 3 || d === 4 || d === 5 || d === 6,
      ),
    )
    out.push({
      days,
      morning: parseRuleFields(rec.morning),
      afternoon: parseRuleFields(rec.afternoon),
    })
  }
  return out
}

export function serializeCashDiscountSchedule(schedule: CashDiscountBlock[]): string | null {
  const cleaned = schedule
    .map(block => ({
      days: uniqueSortedDays(block.days),
      morning: normalizeCashDiscountRule(block.morning.minAmount, block.morning.percent),
      afternoon: normalizeCashDiscountRule(block.afternoon.minAmount, block.afternoon.percent),
    }))
    .filter(block => block.days.length > 0)
  if (cleaned.length === 0) return null
  return JSON.stringify(cleaned)
}

export function resolveCashDiscountRule(input: {
  fallback: CashDiscountRule
  schedule: CashDiscountBlock[]
  weekday: Weekday
  shiftType: CashDiscountShiftKind
}): CashDiscountRule {
  const fallback = normalizeCashDiscountRule(input.fallback.minAmount, input.fallback.percent)
  const block = input.schedule.find(b => b.days.includes(input.weekday))
  if (!block) return fallback
  const slot = input.shiftType === 'morning' ? block.morning : block.afternoon
  return normalizeCashDiscountRule(slot.minAmount, slot.percent)
}

export function toggleDayInDiscountSchedule(
  schedule: CashDiscountBlock[],
  blockIndex: number,
  day: Weekday,
): CashDiscountBlock[] {
  if (!schedule[blockIndex]) return schedule
  return schedule.map((block, i) => {
    const without = block.days.filter(d => d !== day)
    if (i !== blockIndex) return { ...block, days: without }
    const already = block.days.includes(day)
    return {
      ...block,
      days: already ? without : uniqueSortedDays([...without, day]),
    }
  })
}

export function addDiscountBlock(schedule: CashDiscountBlock[]): CashDiscountBlock[] {
  return [...schedule, emptyDiscountBlock()]
}

export function removeDiscountBlock(
  schedule: CashDiscountBlock[],
  blockIndex: number,
): CashDiscountBlock[] {
  return schedule.filter((_, i) => i !== blockIndex)
}

export function updateDiscountBlockSlot(
  schedule: CashDiscountBlock[],
  blockIndex: number,
  slot: 'morning' | 'afternoon',
  patch: Partial<CashDiscountRule>,
): CashDiscountBlock[] {
  return schedule.map((block, i) => {
    if (i !== blockIndex) return block
    const current = slot === 'morning' ? block.morning : block.afternoon
    const next = normalizeCashDiscountRule(
      patch.minAmount ?? current.minAmount,
      patch.percent ?? current.percent,
    )
    return slot === 'morning'
      ? { ...block, morning: next }
      : { ...block, afternoon: next }
  })
}
