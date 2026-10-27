/**
 * Utilidades para construir SaleItemDraft a partir de códigos de barras KRETZ.
 *
 * Extraído como módulo compartido para ser usado tanto por el hook global
 * (useBarcodeScanner) como por el componente ScanInput en modo manual.
 */

import { centsToARS, parseKretzBarcode } from '@carniceria/shared'
import type { SaleItemDraft, ProductRow } from '../types/hw-api'
import { formatIntegerWithDots, formatKgQuantity } from './numericInput'

/** Precio de lista 0: la línea no entra hasta que se tipea el precio de esa venta. */
export interface OpenPriceRequest {
  product: ProductRow
  /** Importe del ticket, en pesos. El código no trae el peso. */
  totalARS: number
}

export type ScannedSale =
  | { status: 'ready'; item: SaleItemDraft }
  | { status: 'needsPrice'; request: OpenPriceRequest }

/**
 * Decide si el ticket entra solo o hay que pedir el precio de esa venta.
 *
 * Con precio de lista > 0, los kilos salen de importe ÷ lista (el precio de
 * cliente especial, si hay, lo aplica después quien arma la venta). Con lista
 * en 0 y precio de cliente > 0, el divisor es ese precio y no se pregunta.
 * Con lista en 0 y sin precio de cliente, la línea no se arma.
 */
export function resolveScannedItem(
  pluNumber: number,
  totalARS: number,
  product: ProductRow | undefined,
  specialUnitPrice?: number,
): ScannedSale {
  const special = specialUnitPrice != null && specialUnitPrice > 0 ? specialUnitPrice : undefined
  if (product && product.price === 0 && special == null && totalARS > 0) {
    return { status: 'needsPrice', request: { product, totalARS } }
  }
  const saleUnitPrice = product?.price === 0 ? special : undefined
  return {
    status: 'ready',
    item: buildItemFromBarcode(pluNumber, totalARS, product, saleUnitPrice),
  }
}

/**
 * Construye un SaleItemDraft a partir del precio total del código de barras y
 * el producto del catálogo local.
 *
 * - Por kg: peso = totalARS / precio_kg  (el ticket no trae el peso).
 * - Por unidad: cantidad = round(totalARS / precio_unidad).
 *   Si la división no es entera → priceDiscrepancy = true
 *   (el precio en la balanza difiere del registrado en la app).
 * - `saleUnitPrice` es el precio de esta venta (cliente especial o el tipeado).
 *   No se escribe en el catálogo. El subtotal sigue siendo el importe del ticket.
 * - Sin precio usable: unitPrice = totalARS, weightKg = 1. Un PLU con lista 0
 *   no debe llegar acá: `resolveScannedItem` pide el precio antes.
 */
export function buildItemFromBarcode(
  pluNumber: number,
  totalARS: number,
  product: ProductRow | undefined,
  saleUnitPrice?: number,
): SaleItemDraft {
  const unit = product?.unit ?? 'kg'
  const typed = saleUnitPrice != null && saleUnitPrice > 0 ? saleUnitPrice : null
  const catalog = product?.price != null && product.price > 0 ? product.price : null
  const refPrice = typed ?? catalog

  let weightKg = 1
  let unitPrice = totalARS
  let priceDiscrepancy: boolean | undefined

  if (refPrice != null && refPrice > 0) {
    unitPrice = refPrice
    const raw = totalARS / refPrice

    if (unit === 'unit') {
      const rounded = Math.round(raw)
      priceDiscrepancy = Math.abs(raw - rounded) > 0.05
      weightKg = rounded > 0 ? rounded : 1
    } else {
      weightKg = raw
    }
  }

  return {
    pluNumber,
    productId: product?.id ?? null,
    productName: product?.name ?? `PLU ${pluNumber}`,
    unit,
    weightKg,
    unitPrice,
    // Redondeamos a pesos enteros: los centavos del encoding KRETZ generan decimales
    // que el modal de cobro (NumericInput) no puede representar, causando mismatch.
    subtotal: Math.round(totalARS),
    manualEntry: false,
    priceDiscrepancy,
  }
}

const PRICE_MATCH_PESOS = 1

/**
 * Asigna un producto del catálogo a un ítem que entró con el precio del ticket.
 * Si no hay precio de lista, o el total no cierra con ese precio, queda como
 * precio especial y se conserva el total del ticket.
 */
export function assignCatalogProduct(item: SaleItemDraft, product: ProductRow): SaleItemDraft {
  const subtotal = Math.round(item.subtotal)
  const listPrice = product.price != null && product.price > 0 ? product.price : null
  const base = {
    ...item,
    pluNumber: product.pluNumber,
    productId: product.id,
    productName: product.name,
    unit: product.unit,
    subtotal,
  }

  if (listPrice == null) {
    const qty = item.weightKg > 0 ? item.weightKg : 1
    return {
      ...base,
      weightKg: qty,
      unitPrice: qty > 0 ? subtotal / qty : subtotal,
      priceDiscrepancy: true,
    }
  }

  if (product.unit === 'unit') {
    const raw = subtotal / listPrice
    const rounded = Math.round(raw)
    const qty = rounded > 0 ? rounded : 1
    const expected = qty * listPrice
    const matches = Math.abs(raw - rounded) <= 0.05 && Math.abs(expected - subtotal) < PRICE_MATCH_PESOS
    return {
      ...base,
      weightKg: qty,
      unitPrice: matches ? listPrice : subtotal / qty,
      priceDiscrepancy: !matches,
    }
  }

  const weight = subtotal / listPrice
  const expected = Math.round(weight * listPrice)
  const matches = weight > 0 && Math.abs(expected - subtotal) < PRICE_MATCH_PESOS
  return {
    ...base,
    weightKg: weight > 0 ? weight : 1,
    unitPrice: matches ? listPrice : subtotal / (weight > 0 ? weight : 1),
    priceDiscrepancy: matches ? undefined : true,
  }
}

export type ValeLineFromBarcode =
  | { ok: true; product: ProductRow; quantityText: string; priceText: string; subtotal: number }
  | { ok: false; needsPrice: OpenPriceRequest }
  | { ok: false; error: string }

function valeLineFromItem(product: ProductRow, item: SaleItemDraft): ValeLineFromBarcode {
  const quantityText = product.unit === 'kg'
    ? formatKgQuantity(item.weightKg)
    : formatIntegerWithDots(String(Math.max(1, Math.round(item.weightKg))))
  const priceText = formatIntegerWithDots(String(Math.max(1, Math.round(item.unitPrice))))
  if (!quantityText || !priceText) return { ok: false, error: 'No se pudo leer el ticket.' }
  return { ok: true, product, quantityText, priceText, subtotal: item.subtotal }
}

/** Arma una línea del vale de productos a partir del mismo ticket que la venta. */
export function valeLineFromBarcode(
  digits: string,
  catalog: readonly ProductRow[],
): ValeLineFromBarcode {
  const parsed = parseKretzBarcode(digits)
  if (!parsed) return { ok: false, error: 'Código inválido.' }
  const plu = Number.parseInt(parsed.pluNumber, 10)
  if (!Number.isFinite(plu)) return { ok: false, error: 'Código inválido.' }
  const product = catalog.find(p => p.pluNumber === plu)
  if (!product) return { ok: false, error: `PLU ${plu} no está en el catálogo.` }
  const total = centsToARS(parsed.totalCents)
  if (Math.round(total) <= 0) return { ok: false, error: 'El ticket no tiene precio.' }
  const resolved = resolveScannedItem(plu, total, product)
  if (resolved.status === 'needsPrice') return { ok: false, needsPrice: resolved.request }
  return valeLineFromItem(product, resolved.item)
}

/**
 * Línea de vale cuando la lista está en 0 y se tipeó el precio de esta venta.
 * El subtotal queda en el importe del ticket. El precio no se guarda en el catálogo.
 */
export function valeLineFromTypedPrice(
  product: ProductRow,
  totalARS: number,
  saleUnitPrice: number,
): ValeLineFromBarcode {
  if (!(saleUnitPrice > 0)) return { ok: false, error: 'Ingresá un precio entero mayor a cero.' }
  if (Math.round(totalARS) <= 0) return { ok: false, error: 'El ticket no tiene precio.' }
  const item = buildItemFromBarcode(product.pluNumber, totalARS, product, saleUnitPrice)
  return valeLineFromItem(product, item)
}

/** Recalcula subtotal con precio especial, conservando el peso/cantidad del ítem. */
export function applySpecialUnitPrice(
  item: SaleItemDraft,
  specialUnitPrice: number | undefined,
): SaleItemDraft {
  if (specialUnitPrice == null || specialUnitPrice <= 0) return item
  const subtotal = Math.round(item.weightKg * specialUnitPrice)
  return {
    ...item,
    unitPrice: specialUnitPrice,
    subtotal,
    priceDiscrepancy: true,
  }
}
