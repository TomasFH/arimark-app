/** Línea de carrito de presupuesto (orders.budgetItems / Firestore). */
export interface BudgetCartLine {
  productId: string
  name: string
  unit: 'kg' | 'unit'
  pluNumber: number | null
  estimatedQty: number
  unitPrice: number
  requestedUnits?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isBudgetCartLine(value: unknown): value is BudgetCartLine {
  if (!isRecord(value)) return false
  if (typeof value.productId !== 'string' || value.productId.trim().length === 0) return false
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false
  if (value.unit !== 'kg' && value.unit !== 'unit') return false
  if (typeof value.estimatedQty !== 'number' || !Number.isFinite(value.estimatedQty) || value.estimatedQty < 0) {
    return false
  }
  if (typeof value.unitPrice !== 'number' || !Number.isFinite(value.unitPrice) || value.unitPrice < 0) {
    return false
  }
  if (
    value.pluNumber != null
    && (typeof value.pluNumber !== 'number' || !Number.isInteger(value.pluNumber))
  ) {
    return false
  }
  if (
    value.requestedUnits != null
    && (
      typeof value.requestedUnits !== 'number'
      || !Number.isInteger(value.requestedUnits)
      || value.requestedUnits <= 0
    )
  ) {
    return false
  }
  return true
}

export function normalizeBudgetCartLine(line: BudgetCartLine): BudgetCartLine {
  const requested = line.requestedUnits != null && line.requestedUnits > 0
    ? line.requestedUnits
    : null
  return {
    productId: line.productId,
    name: line.name,
    unit: line.unit,
    pluNumber: line.pluNumber ?? null,
    estimatedQty: line.estimatedQty,
    unitPrice: line.unitPrice,
    ...(requested != null ? { requestedUnits: requested } : {}),
  }
}

/**
 * Acepta array (Firestore) o JSON string (SQLite). Null si no hay líneas válidas.
 */
export function parseBudgetItems(raw: unknown): BudgetCartLine[] | null {
  if (raw == null || raw === '' || raw === 0) return null
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed)) return null
  const lines = parsed.filter(isBudgetCartLine).map(normalizeBudgetCartLine)
  return lines.length > 0 ? lines : null
}

/** Array para setDoc de Firestore. */
export function budgetItemsForFirestore(raw: unknown): BudgetCartLine[] | null {
  return parseBudgetItems(raw)
}

/** JSON para la columna SQLite `budget_items`. */
export function budgetItemsForSqlite(raw: unknown): string | null {
  const lines = parseBudgetItems(raw)
  return lines ? JSON.stringify(lines) : null
}
