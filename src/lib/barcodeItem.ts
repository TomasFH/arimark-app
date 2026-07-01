/**
 * Utilidades para construir SaleItemDraft a partir de códigos de barras KRETZ.
 *
 * Extraído como módulo compartido para ser usado tanto por el hook global
 * (useBarcodeScanner) como por el componente ScanInput en modo manual.
 */

import type { SaleItemDraft, ProductRow } from '../types/hw-api'

/**
 * Construye un SaleItemDraft a partir del precio total del código de barras y
 * el producto del catálogo local.
 *
 * - Por kg: peso = totalARS / precio_kg  (peso real del ticket de la balanza).
 * - Por unidad: cantidad = round(totalARS / precio_unidad).
 *   Si la división no es entera → priceDiscrepancy = true
 *   (el precio en la balanza difiere del registrado en la app).
 * - Sin precio en catálogo: unitPrice = totalARS, weightKg = 1 (fallback mínimo).
 */
export function buildItemFromBarcode(
  pluNumber: number,
  totalARS: number,
  product: ProductRow | undefined
): SaleItemDraft {
  const unit = product?.unit ?? 'kg'
  const refPrice = product?.price ?? null

  let weightKg = 1
  let unitPrice = totalARS
  let priceDiscrepancy: boolean | undefined

  if (refPrice && refPrice > 0) {
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
    subtotal: totalARS,
    manualEntry: false,
    priceDiscrepancy,
  }
}
