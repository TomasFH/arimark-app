/**
 * Empareja una etiqueta de balanza con las líneas del cobro de un pedido.
 *
 * Hoy solo compara `pluNumber`. Más adelante un corte va a agrupar varios PLU
 * (el común y el de oferta) y esta función va a reemplazar el producto de la
 * línea por el PLU escaneado.
 */
import type { BudgetCartLine, SaleItemDraft } from '../types/hw-api'
import { formatIntegerWithDots, formatKgQuantity, parseDecimalInput, parseNumericInput } from './numericInput'

/** Producto del catálogo de hoy, el que devuelve getProducts. */
export interface OrderTicketProduct {
  id: string
  name: string
  unit: 'kg' | 'unit'
  pluNumber: number
  price: number | null
}

/** Línea del modal de cobro. `ticketTotal` null = todavía sin etiqueta. */
export interface OrderChargeLine {
  productId: string
  name: string
  unit: 'kg' | 'unit'
  pluNumber: number | null
  estimatedQty: number
  requestedUnits: number | null
  unitPrice: number
  qtyRaw: string
  checked: boolean
  /** Pesos enteros impresos en la etiqueta. */
  ticketTotal: number | null
  extra: boolean
}

/** PLU numérico (sin ceros) y total del ticket en pesos enteros. */
export interface OrderTicketScan {
  pluNumber: number
  totalPesos: number
}

export interface OrderTicketMatch {
  lines: OrderChargeLine[]
  /** Aviso para la cajera. null si no hay nada que decir. */
  notice: string | null
}

export function chargeLinesFromBudget(items: readonly BudgetCartLine[] | null | undefined): OrderChargeLine[] {
  return (items ?? []).map(line => ({
    productId: line.productId,
    name: line.name,
    unit: line.unit,
    pluNumber: line.pluNumber,
    estimatedQty: line.estimatedQty,
    requestedUnits: line.requestedUnits ?? null,
    unitPrice: line.unitPrice,
    qtyRaw: '',
    checked: true,
    ticketTotal: null,
    extra: false,
  }))
}

/**
 * Precio de lista de hoy si difiere del de la línea.
 * Compara por id de producto. No por nombre, y no mira clientes especiales.
 * null = mismo precio, o el producto no está en el catálogo.
 */
export function listPriceIfDifferent(
  line: Pick<OrderChargeLine, 'productId' | 'unitPrice'>,
  catalog: readonly OrderTicketProduct[],
): number | null {
  const product = catalog.find(item => item.id === line.productId)
  if (!product || product.price == null) return null
  if (product.price === line.unitPrice) return null
  return product.price
}

/**
 * Hoy solo compara `pluNumber`. Más adelante un corte va a agrupar varios PLU
 * (el común y el de oferta) y esta función va a reemplazar el producto de la
 * línea por el PLU escaneado.
 */
function lineMatchesPlu(line: OrderChargeLine, pluNumber: number): boolean {
  return line.pluNumber === pluNumber
}

function blankExtra(product: {
  productId: string
  name: string
  unit: 'kg' | 'unit'
  pluNumber: number | null
  unitPrice: number
}): OrderChargeLine {
  return {
    productId: product.productId,
    name: product.name,
    unit: product.unit,
    pluNumber: product.pluNumber,
    estimatedQty: 0,
    requestedUnits: null,
    unitPrice: product.unitPrice,
    qtyRaw: '',
    checked: true,
    ticketTotal: null,
    extra: true,
  }
}

/** true si el texto del peso sigue siendo el que salió de la etiqueta. */
export function chargeQtyMatchesTicket(line: OrderChargeLine): boolean {
  if (line.ticketTotal == null || !(line.ticketTotal > 0) || !(line.unitPrice > 0)) return false
  if (line.unit === 'unit') {
    const rounded = Math.round(line.ticketTotal / line.unitPrice)
    const qty = rounded > 0 ? rounded : 1
    return line.qtyRaw === formatIntegerWithDots(String(qty))
  }
  return line.qtyRaw === formatKgQuantity(line.ticketTotal / line.unitPrice)
}

/**
 * Aplica el total del ticket. No divide si el precio no es positivo:
 * devuelve la misma línea, sin kilos y sin etiqueta.
 */
function fillLine(line: OrderChargeLine, totalPesos: number): { line: OrderChargeLine; notice: string | null } {
  if (!(line.unitPrice > 0) || !(totalPesos > 0)) {
    return {
      line,
      notice: `${line.name} no tiene un precio válido. No se calculó el peso.`,
    }
  }

  if (line.unit === 'unit') {
    const rounded = Math.round(totalPesos / line.unitPrice)
    const qty = rounded > 0 ? rounded : 1
    const closes = qty * line.unitPrice === totalPesos
    return {
      line: {
        ...line,
        qtyRaw: formatIntegerWithDots(String(qty)),
        ticketTotal: totalPesos,
        checked: true,
      },
      notice: closes ? null : `El total del ticket no cierra con el precio de ${line.name}.`,
    }
  }

  return {
    line: {
      ...line,
      qtyRaw: formatKgQuantity(totalPesos / line.unitPrice),
      ticketTotal: totalPesos,
      checked: true,
    },
    notice: null,
  }
}

/**
 * Una etiqueta, una línea. El match es contra el pedido: un PLU que ya está
 * en una línea se completa aunque no esté en el catálogo.
 */
export function matchOrderTicket(
  lines: readonly OrderChargeLine[],
  ticket: OrderTicketScan,
  catalog: readonly OrderTicketProduct[],
): OrderTicketMatch {
  if (!(ticket.totalPesos > 0) || !Number.isInteger(ticket.totalPesos)) {
    return { lines: [...lines], notice: 'El ticket no tiene un precio para cobrar.' }
  }

  const freeIndex = lines.findIndex(line => (
    lineMatchesPlu(line, ticket.pluNumber) && line.ticketTotal == null
  ))
  if (freeIndex >= 0) {
    const filled = fillLine(lines[freeIndex]!, ticket.totalPesos)
    if (filled.line.ticketTotal == null) {
      return { lines: [...lines], notice: filled.notice }
    }
    return {
      lines: lines.map((line, index) => index === freeIndex ? filled.line : line),
      notice: filled.notice,
    }
  }

  const fromCatalog = catalog.find(product => product.pluNumber === ticket.pluNumber)
  if (fromCatalog && fromCatalog.price != null && fromCatalog.price > 0) {
    const filled = fillLine(blankExtra({
      productId: fromCatalog.id,
      name: fromCatalog.name,
      unit: fromCatalog.unit,
      pluNumber: fromCatalog.pluNumber,
      unitPrice: fromCatalog.price,
    }), ticket.totalPesos)
    return { lines: [...lines, filled.line], notice: filled.notice }
  }

  const source = [...lines].reverse().find(line => lineMatchesPlu(line, ticket.pluNumber))
  if (source && source.unitPrice > 0) {
    const filled = fillLine(blankExtra({
      productId: source.productId,
      name: source.name,
      unit: source.unit,
      pluNumber: source.pluNumber,
      unitPrice: source.unitPrice,
    }), ticket.totalPesos)
    return { lines: [...lines, filled.line], notice: filled.notice }
  }

  if (fromCatalog) {
    return {
      lines: [...lines],
      notice: `${fromCatalog.name} no tiene un precio de lista válido.`,
    }
  }

  return {
    lines: [...lines],
    notice: `PLU ${ticket.pluNumber} no está en el pedido ni en el catálogo.`,
  }
}

/** Cambia el precio de una línea. Si ya tiene etiqueta, los kilos salen del mismo ticket. */
export function repriceChargeLine(
  line: OrderChargeLine,
  nextUnitPrice: number,
): { line: OrderChargeLine; notice: string | null } {
  if (!(nextUnitPrice > 0) || !Number.isInteger(nextUnitPrice)) {
    return { line, notice: 'Ingresá un precio entero mayor a cero.' }
  }
  if (line.ticketTotal == null) {
    return { line: { ...line, unitPrice: nextUnitPrice }, notice: null }
  }
  return fillLine({ ...line, unitPrice: nextUnitPrice }, line.ticketTotal)
}

/**
 * Ítem para el POS. Con etiqueta, el subtotal es el total del ticket
 * (el peso visible está redondeado y no debe correr ese monto).
 */
export function saleItemFromChargeLine(line: OrderChargeLine): SaleItemDraft | null {
  if (!line.checked) return null

  const ticketTotal = line.ticketTotal
  let weightKg: number
  let subtotal: number
  let priceDiscrepancy: boolean | undefined
  const ticketStillBound = chargeQtyMatchesTicket(line)

  if (ticketStillBound && ticketTotal != null) {
    subtotal = ticketTotal
    if (line.unit === 'unit') {
      const rounded = Math.round(subtotal / line.unitPrice)
      weightKg = rounded > 0 ? rounded : 1
      priceDiscrepancy = weightKg * line.unitPrice !== subtotal ? true : undefined
    } else {
      weightKg = subtotal / line.unitPrice
    }
  } else {
    const typed = line.unit === 'kg'
      ? parseDecimalInput(line.qtyRaw)
      : parseNumericInput(line.qtyRaw)
    weightKg = typed != null && typed > 0 ? typed : line.estimatedQty
    if (!(weightKg > 0) || !(line.unitPrice > 0)) return null
    subtotal = Math.round(line.unitPrice * weightKg)
    if (!(subtotal > 0)) return null
  }

  return {
    pluNumber: line.pluNumber ?? 0,
    productId: line.productId,
    productName: line.name,
    unit: line.unit,
    weightKg,
    unitPrice: line.unitPrice,
    subtotal,
    manualEntry: !ticketStillBound,
    priceDiscrepancy,
  }
}
