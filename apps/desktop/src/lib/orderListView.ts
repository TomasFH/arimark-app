import type { OrderRow, BudgetCartLine } from '../types/hw-api'
import { compareOrdersByPickup, type OrderSortContext } from './orderListSort'

export type OrderSearchClause =
  | { kind: 'text'; value: string }
  | { kind: 'pair'; product: string; qty: number; unit?: 'kg' | 'u' }

const QTY_TOKEN = /^(\d+(?:[.,]\d+)?)(kg|u)?$/i
const COMMA_PAIR = /^(.+?),\s*(\d+(?:[.,]\d+)?)(?:\s*(kg|u))?\s*$/i
const COLON_PAIR = /^(.+):(\d+(?:[.,]\d+)?)(kg|u)?$/i

function parseQtyNumber(raw: string): number | null {
  const n = Number(raw.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function parseQtyToken(raw: string): { qty: number; unit?: 'kg' | 'u' } | null {
  const t = raw.trim().toLowerCase()
  const m = QTY_TOKEN.exec(t)
  if (!m) return null
  const qty = parseQtyNumber(m[1] ?? '')
  if (qty === null) return null
  const suffix = m[2]?.toLowerCase()
  const unit = suffix === 'kg' ? 'kg' : suffix === 'u' ? 'u' : undefined
  return { qty, unit }
}

function parsePart(part: string): OrderSearchClause[] {
  const p = part.trim()
  if (!p) return []

  const comma = COMMA_PAIR.exec(p)
  if (comma && parseQtyToken(comma[1]!.trim()) === null) {
    const product = comma[1]!.trim().toLowerCase()
    const qty = parseQtyNumber(comma[2] ?? '')
    if (product && qty !== null) {
      const suffix = comma[3]?.toLowerCase()
      const unit = suffix === 'kg' ? 'kg' : suffix === 'u' ? 'u' : undefined
      return [{ kind: 'pair', product, qty, unit }]
    }
  }

  const tokens = p.split(/\s+/u).map(t => t.replace(/,$/u, '')).filter(Boolean)
  const out: OrderSearchClause[] = []
  let i = 0
  while (i < tokens.length) {
    const raw = tokens[i]!
    const lower = raw.toLowerCase()
    const glued = COLON_PAIR.exec(lower)
    if (glued) {
      const qty = parseQtyNumber(glued[2] ?? '')
      const product = glued[1]!.trim()
      if (product && qty !== null) {
        const suffix = glued[3]?.toLowerCase()
        const unit = suffix === 'kg' ? 'kg' : suffix === 'u' ? 'u' : undefined
        out.push({ kind: 'pair', product, qty, unit })
      }
      i += 1
      continue
    }

    const qtyTok = parseQtyToken(lower)
    if (qtyTok) {
      const prev = out[out.length - 1]
      if (prev?.kind === 'text') {
        out.pop()
        let { qty, unit } = qtyTok
        const next = tokens[i + 1]
        if (!unit && next && /^(kg|u)$/i.test(next)) {
          unit = next.toLowerCase() as 'kg' | 'u'
          i += 1
        }
        out.push({ kind: 'pair', product: prev.value, qty, unit })
      } else if (lower.replace(/\D/g, '').length >= 6) {
        // Teléfono u otro número largo: no es un peso.
        out.push({ kind: 'text', value: lower })
      }
      i += 1
      continue
    }

    out.push({ kind: 'text', value: lower })
    i += 1
  }
  return out
}

/** Espacio = otro producto. Coma o "2kg" = producto y cantidad en la misma línea. */
export function parseOrderSearch(query: string): OrderSearchClause[] {
  const q = query.trim()
  if (!q) return []
  return q.split(/\s*;\s*/u).flatMap(parsePart)
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0005
}

function lineMatchesQty(line: BudgetCartLine, qty: number, unit?: 'kg' | 'u'): boolean {
  const kg = line.unit === 'kg' ? line.estimatedQty : null
  const pieces = line.requestedUnits != null && line.requestedUnits > 0
    ? line.requestedUnits
    : line.unit === 'unit'
      ? Math.round(line.estimatedQty)
      : null

  if (unit === 'kg') return kg !== null && kg > 0 && almostEqual(kg, qty)
  if (unit === 'u') return pieces !== null && pieces === qty
  if (pieces !== null && pieces === qty) return true
  if (kg !== null && kg > 0 && almostEqual(kg, qty)) return true
  return false
}

function searchLines(order: OrderRow): BudgetCartLine[] {
  if (order.budgetItems && order.budgetItems.length > 0) return order.budgetItems
  return []
}

function textHaystack(order: OrderRow): string {
  const names = searchLines(order).map(l => l.name)
  const itemsWithoutQty = (order.items ?? '').replace(/\d+(?:[.,]\d+)?\s*(?:kg|u)?/giu, ' ')
  return [order.customerName, order.phone ?? '', itemsWithoutQty, ...names].join('\n').toLowerCase()
}

export function matchesOrderSearch(order: OrderRow, query: string): boolean {
  const clauses = parseOrderSearch(query)
  if (clauses.length === 0) return true
  const textHay = textHaystack(order)
  const lines = searchLines(order)
  return clauses.every(clause => {
    if (clause.kind === 'text') return textHay.includes(clause.value)
    const product = clause.product
    if (lines.length > 0) {
      return lines.some(line =>
        line.name.toLowerCase().includes(product) && lineMatchesQty(line, clause.qty, clause.unit),
      )
    }
    // Pedido viejo sin JSON: el resumen "Asado · 2 kg" tiene que coincidir junto.
    const items = (order.items ?? '').toLowerCase()
    const qtyText = Number.isInteger(clause.qty)
      ? String(clause.qty)
      : String(clause.qty).replace('.', ',')
    return items.split(', ').some(seg => {
      if (!seg.includes(product)) return false
      if (clause.unit === 'u') return new RegExp(`(?:^|\\s)${qtyText}\\s*u(?:\\s|$)`).test(seg)
      if (clause.unit === 'kg') return new RegExp(`(?:^|\\s)${qtyText}\\s*kg(?:\\s|$)`).test(seg)
      return new RegExp(`(?:^|\\s)${qtyText}(?:\\s|$)`).test(seg)
    })
  })
}

export type OrdersView =
  | { mode: 'grouped'; ready: OrderRow[]; pending: OrderRow[] }
  | { mode: 'search'; results: OrderRow[] }
  | { mode: 'closed'; results: OrderRow[] }

export function closedOrders(orders: OrderRow[], ctx?: OrderSortContext): OrderRow[] {
  return orders
    .filter(o => o.status === 'delivered' || o.status === 'cancelled')
    .sort((a, b) => compareOrdersByPickup(a, b, ctx))
}

/**
 * Vista de Pedidos: Listos/Pendientes, historial discreto, o resultados de búsqueda.
 * La búsqueda pisa el resto y cubre todos los estados.
 */
export function buildOrdersView(
  orders: OrderRow[],
  search: string,
  showClosed: boolean,
  ctx?: OrderSortContext,
): OrdersView {
  const q = search.trim()
  if (q) {
    return {
      mode: 'search',
      results: orders.filter(o => matchesOrderSearch(o, q)).sort((a, b) => compareOrdersByPickup(a, b, ctx)),
    }
  }
  if (showClosed) {
    return { mode: 'closed', results: closedOrders(orders, ctx) }
  }
  return {
    mode: 'grouped',
    ready: orders.filter(o => o.status === 'ready').sort((a, b) => compareOrdersByPickup(a, b, ctx)),
    pending: orders.filter(o => o.status === 'pending').sort((a, b) => compareOrdersByPickup(a, b, ctx)),
  }
}
