/**
 * Desglose de billetes para el relevo de caja (cierre → apertura).
 * Denominaciones vigentes (sin $5.000). PC y celu usan la misma lista.
 */

export const ARS_BILL_DENOMINATIONS = [
  20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10,
] as const

export type ArsBillDenomination = (typeof ARS_BILL_DENOMINATIONS)[number]

export const BILL_COUNT_KINDS = ['closing', 'opening', 'expected'] as const
export type BillCountKind = (typeof BILL_COUNT_KINDS)[number]

export interface BillLine {
  denomination: number
  quantity: number
}

export interface BillLineDiff {
  denomination: number
  expectedQty: number
  foundQty: number
  qtyDiff: number
  amountDiff: number
}

export interface CashHandoverParty {
  cashierName: string
  at: string | null
  bills: BillLine[]
  total: number
  counted: boolean
  fromShiftId?: string | null
}

export interface CashHandoverAudit {
  /** Lo que este turno declaró al cerrar (queda en la registradora). */
  left: CashHandoverParty | null
  /** Lo que este turno declaró al abrir (lo que encontró). */
  found: CashHandoverParty | null
  /** Snapshot de lo que dejó el turno anterior (no se reescribe). */
  expected: CashHandoverParty | null
  /** found.total − expected.total. Null si falta alguno contado. */
  amountDiff: number | null
}

const DENOM_SET = new Set<number>(ARS_BILL_DENOMINATIONS)

export function isArsBillDenomination(value: number): value is ArsBillDenomination {
  return DENOM_SET.has(value)
}

export function formatBillDenomination(d: number): string {
  return `$${d.toLocaleString('es-AR')}`
}

function qtyMap(lines: BillLine[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const line of lines) {
    if (!Number.isInteger(line.denomination) || line.denomination <= 0) continue
    if (!Number.isInteger(line.quantity) || line.quantity < 0) continue
    map.set(line.denomination, (map.get(line.denomination) ?? 0) + line.quantity)
  }
  return map
}

export function mergeBillLines(lines: BillLine[]): BillLine[] {
  const map = qtyMap(lines)
  return [...map.entries()]
    .map(([denomination, quantity]) => ({ denomination, quantity }))
    .sort((a, b) => b.denomination - a.denomination)
}

/** Filas con cantidad > 0, denominaciones válidas, orden de mayor a menor. */
export function compactBillLines(lines: BillLine[]): BillLine[] {
  return mergeBillLines(lines).filter(line => line.quantity > 0 && isArsBillDenomination(line.denomination))
}

export function parseBillLines(input: unknown): BillLine[] {
  if (!Array.isArray(input)) return []
  const raw: BillLine[] = []
  for (const row of input) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { denomination?: unknown; quantity?: unknown }
    const denomination = typeof rec.denomination === 'number'
      ? rec.denomination
      : Number(rec.denomination)
    const quantity = typeof rec.quantity === 'number' ? rec.quantity : Number(rec.quantity)
    if (!Number.isInteger(denomination) || denomination <= 0) continue
    if (!Number.isInteger(quantity) || quantity < 0) continue
    raw.push({ denomination, quantity })
  }
  return compactBillLines(raw)
}

export function billLinesTotal(lines: BillLine[]): number {
  return compactBillLines(lines).reduce((sum, line) => sum + line.denomination * line.quantity, 0)
}

export function isEmptyBillCount(lines: BillLine[]): boolean {
  return billLinesTotal(lines) === 0
}

export function billLinesDiff(expected: BillLine[], found: BillLine[]): BillLineDiff[] {
  const expectedMap = qtyMap(compactBillLines(expected))
  const foundMap = qtyMap(compactBillLines(found))
  const denoms = new Set<number>([...expectedMap.keys(), ...foundMap.keys()])
  const diffs: BillLineDiff[] = []
  for (const denomination of [...denoms].sort((a, b) => b - a)) {
    const expectedQty = expectedMap.get(denomination) ?? 0
    const foundQty = foundMap.get(denomination) ?? 0
    const qtyDiff = foundQty - expectedQty
    if (qtyDiff === 0) continue
    diffs.push({
      denomination,
      expectedQty,
      foundQty,
      qtyDiff,
      amountDiff: qtyDiff * denomination,
    })
  }
  return diffs
}

export function billCountWasRecorded(counted: boolean, lines: BillLine[]): boolean {
  return counted || compactBillLines(lines).length > 0
}

export function buildCashHandoverAudit(input: {
  cashierName: string
  startedAt: string
  closedAt: string | null
  openingBills: BillLine[]
  closingBills: BillLine[]
  openingCounted: boolean
  closingCounted: boolean
  handover?: {
    fromShiftId?: string | null
    fromCashierName?: string | null
    fromClosedAt?: string | null
    expectedBills?: BillLine[]
  } | null
}): CashHandoverAudit {
  const opening = compactBillLines(input.openingBills)
  const closing = compactBillLines(input.closingBills)
  const expected = compactBillLines(input.handover?.expectedBills ?? [])
  const foundCounted = billCountWasRecorded(input.openingCounted, opening)
  const leftCounted = billCountWasRecorded(input.closingCounted, closing)
  const expectedPresent = expected.length > 0
    || (
      input.openingCounted
      && Boolean(input.handover?.fromShiftId || input.handover?.fromClosedAt)
    )

  const found: CashHandoverParty | null = foundCounted
    ? {
        cashierName: input.cashierName,
        at: input.startedAt,
        bills: opening,
        total: billLinesTotal(opening),
        counted: true,
      }
    : null

  const left: CashHandoverParty | null = leftCounted
    ? {
        cashierName: input.cashierName,
        at: input.closedAt,
        bills: closing,
        total: billLinesTotal(closing),
        counted: true,
      }
    : null

  const expectedParty: CashHandoverParty | null = expectedPresent
    ? {
        cashierName: input.handover?.fromCashierName?.trim() || 'Cajera anterior',
        at: input.handover?.fromClosedAt ?? null,
        bills: expected,
        total: billLinesTotal(expected),
        counted: true,
        fromShiftId: input.handover?.fromShiftId ?? null,
      }
    : null

  const amountDiff = found && expectedParty
    ? found.total - expectedParty.total
    : null

  return { left, found, expected: expectedParty, amountDiff }
}
