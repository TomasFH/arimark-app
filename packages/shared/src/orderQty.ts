/** Línea de pedido con cantidad en kg y, opcionalmente, piezas. */
export interface OrderQtyLine {
  name: string
  unit: 'kg' | 'unit'
  estimatedQty: number
  requestedUnits?: number | null
}

export function formatKgQty(n: number): string {
  const text = Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
  return `${text} kg`
}

/** Cantidad principal: piezas si las hay; si no, kg o unidades de catálogo. */
export function formatOrderQty(line: OrderQtyLine): string {
  if (line.requestedUnits != null && line.requestedUnits > 0) return `${line.requestedUnits} u`
  if (line.unit === 'unit') return `${Math.round(line.estimatedQty)} u`
  return formatKgQty(line.estimatedQty)
}

/** Pista de kilos cuando el cliente pidió piezas. */
export function formatOrderQtyHint(line: OrderQtyLine): string | null {
  if (line.requestedUnits != null && line.requestedUnits > 0 && line.estimatedQty > 0) {
    return `~${formatKgQty(line.estimatedQty)}`
  }
  return null
}

/** Resumen de productos para `orders.items` (búsqueda, celu). */
export function summarizeBudgetItems(lines: OrderQtyLine[]): string {
  return lines
    .map(line => {
      const hint = formatOrderQtyHint(line)
      return hint ? `${line.name} · ${formatOrderQty(line)} (${hint})` : `${line.name} · ${formatOrderQty(line)}`
    })
    .join(', ')
    .slice(0, 500)
}
