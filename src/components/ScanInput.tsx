/**
 * Input de escaneo de productos — flujo principal de ventas en la PC.
 *
 * Pestaña "Escanear" (default): código EAN-13 del ticket KRETZ.
 *   Solo acepta dígitos. Auto-submit al detectar 13 dígitos (compatible con lector USB).
 *   Calcula el peso en kg a partir del precio total / precio por kg del catálogo.
 *
 * Pestaña "PLU + precio" (emergencia): ingreso manual con campo de peso vinculado.
 *   Peso y precio total se calculan uno del otro usando el precio/kg del catálogo.
 */

import { useEffect, useRef, useState } from 'react'
import { parseKretzBarcode, centsToARS } from '../lib/kretzBarcode'
import NumericInput from './NumericInput'
import DecimalInput from './DecimalInput'
import {
  parseNumericInput,
  parseDecimalInput,
  formatDecimalInputValue,
  stripNonDigits,
  formatIntegerWithDots,
} from '../lib/numericInput'
import type { SaleItemDraft, ProductRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'

type Tab = 'scan' | 'manual'

interface Props {
  onAddItem: (item: SaleItemDraft) => void
  products: ProductRow[]
}

// ---------------------------------------------------------------------------
// Lógica de negocio
// ---------------------------------------------------------------------------

/**
 * Construye un SaleItemDraft a partir del total del código de barras y el producto del catálogo.
 * - Para productos por kg: peso = total / precio_kg (peso real extraído del ticket).
 * - Para productos por unidad: cantidad = round(total / precio_unidad).
 *   Si la cantidad no es entera → discrepancia de precio (la balanza tiene otro precio).
 * - Sin precio en catálogo: unitPrice = total, weightKg = 1 (fallback mínimo).
 */
function buildItemFromBarcode(
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

/** Construye un SaleItemDraft a partir del ingreso manual de PLU + peso + precio. */
function buildItemFromManual(
  pluNumber: number,
  weightKg: number,
  subtotal: number,
  product: ProductRow | undefined
): SaleItemDraft {
  const unit = product?.unit ?? 'kg'
  const unitPrice = product?.price ?? (weightKg > 0 ? subtotal / weightKg : subtotal)
  return {
    pluNumber,
    productId: product?.id ?? null,
    productName: product?.name ?? `PLU ${pluNumber}`,
    unit,
    weightKg,
    unitPrice,
    subtotal,
    manualEntry: true,
  }
}

// ---------------------------------------------------------------------------
// Constantes de UI
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  beef_cut: 'Vacuno',
  poultry: 'Pollo',
  pork: 'Cerdo',
  other: 'Otros',
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function ScanInput({ onAddItem, products }: Props) {
  const [tab, setTab] = useState<Tab>('scan')
  const [addedMsg, setAddedMsg] = useState('')

  // --- Scan state ---
  const [barcode, setBarcode] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // --- Manual state ---
  const [pluRaw, setPluRaw] = useState('')
  const [weightRaw, setWeightRaw] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [manualError, setManualError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const pluInputRef = useRef<HTMLInputElement>(null)
  const priceInputRef = useRef<HTMLInputElement>(null)

  // Foco automático al cambiar de tab
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tab === 'scan') barcodeInputRef.current?.focus()
      else pluInputRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [tab])

  // ── PLU lookup ──────────────────────────────────────────────────────────

  const pluNum = parseNumericInput(pluRaw)

  const suggestions: ProductRow[] = (() => {
    if (!pluRaw.trim() || pluNum === null) return []
    const query = pluRaw.replace(/\./g, '')
    return products.filter(p => String(p.pluNumber).startsWith(query)).slice(0, 6)
  })()

  const matchedProduct = pluNum !== null
    ? products.find(p => p.pluNumber === pluNum)
    : undefined

  const refPrice = matchedProduct?.price ?? null

  // ── Tab switch ──────────────────────────────────────────────────────────

  function handleTabChange(next: Tab) {
    setTab(next)
    setBarcode('')
    setBarcodeError('')
    setPluRaw('')
    setWeightRaw('')
    setPriceRaw('')
    setManualError('')
    setShowSuggestions(false)
  }

  // ── Flash feedback ──────────────────────────────────────────────────────

  function flashAdded(name: string) {
    setAddedMsg(name)
    setTimeout(() => setAddedMsg(''), 2000)
  }

  // ── PLU suggestion pick ────────────────────────────────────────────────

  function pickSuggestion(p: ProductRow) {
    setPluRaw(String(p.pluNumber))
    setShowSuggestions(false)
    setManualError('')
    // Limpiar peso y precio al cambiar de producto
    setWeightRaw('')
    setPriceRaw('')
    setTimeout(() => priceInputRef.current?.focus(), 50)
  }

  // ── Manual: vinculación peso ↔ precio ──────────────────────────────────

  function handleWeightChange(v: string) {
    setWeightRaw(v)
    setManualError('')
    if (refPrice && refPrice > 0) {
      const w = parseDecimalInput(v)
      if (w !== null && w > 0) {
        setPriceRaw(formatDecimalInputValue(String(Math.round(w * refPrice))))
      }
    }
  }

  function handlePriceChange(v: string) {
    setPriceRaw(v)
    setManualError('')
    if (refPrice && refPrice > 0) {
      const p = parseDecimalInput(v)
      if (p !== null && p > 0) {
        setWeightRaw(formatDecimalInputValue(String(p / refPrice), 3))
      }
    }
  }

  // Limpiar campos dependientes al cambiar de PLU
  function handlePluChange(v: string) {
    setPluRaw(formatIntegerWithDots(stripNonDigits(v).slice(0, 3)))
    setManualError('')
    setShowSuggestions(true)
    setWeightRaw('')
    setPriceRaw('')
  }

  // ── Manual: submit ─────────────────────────────────────────────────────

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setManualError('')
    setShowSuggestions(false)

    const plu = pluNum
    if (plu === null || plu <= 0 || plu > 999) {
      setManualError('Número PLU inválido (debe ser entre 1 y 999).')
      return
    }

    const price = parseDecimalInput(priceRaw)
    if (price === null || price <= 0) {
      setManualError('Precio total inválido.')
      return
    }

    const isUnit = matchedProduct?.unit === 'unit'

    let weightKg: number
    if (isUnit) {
      // Cantidad debe ser entera positiva
      const qty = parseDecimalInput(weightRaw)
      weightKg = qty !== null && qty > 0 ? Math.round(qty) : 1
    } else {
      const w = parseDecimalInput(weightRaw)
      if (w === null || w <= 0) {
        setManualError('Peso inválido. Ingresá el peso en kg.')
        return
      }
      weightKg = w
    }

    const item = buildItemFromManual(plu, weightKg, price, matchedProduct)
    onAddItem(item)
    flashAdded(item.productName)
    setPluRaw('')
    setWeightRaw('')
    setPriceRaw('')
    setTimeout(() => pluInputRef.current?.focus(), 50)
  }

  // ── Scan: lógica ───────────────────────────────────────────────────────

  function tryAddFromBarcode(digits: string): boolean {
    const parsed = parseKretzBarcode(digits)
    if (!parsed) return false
    const plu = parseInt(parsed.pluNumber, 10)
    const product = products.find(p => p.pluNumber === plu)
    const item = buildItemFromBarcode(plu, centsToARS(parsed.totalCents), product)
    onAddItem(item)
    flashAdded(item.productName)
    return true
  }

  function handleBarcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Solo dígitos
    const digits = e.target.value.replace(/\D/g, '')
    setBarcode(digits)
    setBarcodeError('')

    if (digits.length === 13) {
      if (tryAddFromBarcode(digits)) {
        setBarcode('')
        setTimeout(() => barcodeInputRef.current?.focus(), 0)
      }
    }
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBarcodeError('')
    if (tryAddFromBarcode(barcode.trim())) {
      setBarcode('')
      setTimeout(() => barcodeInputRef.current?.focus(), 0)
    } else {
      setBarcodeError('Código inválido. Verificar que sea el código del ticket KRETZ (13 dígitos, prefijo 20).')
    }
  }

  const barcodePreview = (() => {
    const parsed = parseKretzBarcode(barcode.trim())
    if (!parsed) return null
    const plu = parseInt(parsed.pluNumber, 10)
    return {
      plu,
      name: products.find(p => p.pluNumber === plu)?.name,
      total: centsToARS(parsed.totalCents),
    }
  })()

  // ── Render ─────────────────────────────────────────────────────────────

  const price = parseDecimalInput(priceRaw)
  const isUnit = matchedProduct?.unit === 'unit'
  const weightLabel = isUnit ? 'Cantidad' : 'Peso (kg)'
  const weightPlaceholder = isUnit ? 'ej. 2' : 'ej. 0,490'

  return (
    <div className="border-t border-gray-800 px-3 py-2 space-y-2">
      {/* Tabs */}
      <div className="flex rounded-md overflow-hidden border border-gray-700 text-[10px] font-semibold">
        <button
          type="button"
          onClick={() => handleTabChange('scan')}
          className={`flex-1 py-1 transition-colors ${
            tab === 'scan'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-900 text-gray-400 hover:text-gray-200'
          }`}
        >
          📷 Escanear
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('manual')}
          className={`flex-1 py-1 transition-colors ${
            tab === 'manual'
              ? 'bg-orange-600 text-white'
              : 'bg-gray-900 text-gray-400 hover:text-gray-200'
          }`}
        >
          ⚡ PLU + precio
        </button>
      </div>

      {addedMsg && (
        <p className="rounded bg-green-900/40 px-2 py-1 text-[10px] text-green-300 truncate">
          ✓ {addedMsg}
        </p>
      )}

      {/* ── Pestaña Escanear ─────────────────────────────────────────── */}
      {tab === 'scan' && (
        <form onSubmit={handleBarcodeSubmit} className="space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug">
            Escaneá el código del ticket (13 dígitos). Se agrega solo al leerlo.
          </p>
          <input
            ref={barcodeInputRef}
            type="text"
            inputMode="numeric"
            value={barcode}
            onChange={handleBarcodeChange}
            placeholder="2001060000012"
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          />
          {barcodePreview && (
            <p className="text-[10px] text-green-400 truncate">
              PLU {barcodePreview.plu}{barcodePreview.name ? ` — ${barcodePreview.name}` : ''} · {formatARS(barcodePreview.total)}
            </p>
          )}
          {barcodeError && (
            <p className="text-[10px] text-red-400">{barcodeError}</p>
          )}
          <button
            type="submit"
            disabled={!barcode.trim()}
            className="w-full rounded-md bg-amber-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            Agregar a la venta
          </button>
        </form>
      )}

      {/* ── Pestaña PLU + precio (emergencia) ────────────────────────── */}
      {tab === 'manual' && (
        <form onSubmit={handleManualSubmit} className="space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug">
            Emergencia: ingresá el PLU, el peso o cantidad y el precio total.
          </p>

          {/* PLU con autocomplete */}
          <div className="relative">
            <label className="block text-[9px] text-gray-500 mb-0.5">PLU</label>
            <NumericInput
              ref={pluInputRef}
              value={pluRaw}
              onChange={handlePluChange}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => pluRaw.trim() && setShowSuggestions(true)}
              placeholder="ej. 5"
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute bottom-full mb-1 left-0 right-0 z-20 rounded-md border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
                {suggestions.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={() => pickSuggestion(p)}
                      className="w-full px-2 py-1.5 text-left hover:bg-gray-800 transition-colors"
                    >
                      <span className="text-[10px] font-bold text-orange-400 mr-1">{p.pluNumber}</span>
                      <span className="text-[10px] text-gray-200 truncate">{p.name}</span>
                      {p.price != null && (
                        <span className="text-[10px] text-amber-400 ml-1">
                          {formatARS(p.price)}/{p.unit === 'unit' ? 'u.' : 'kg'}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Peso / Cantidad + Precio total (campos vinculados) */}
          <div className="flex gap-2">
            <div className="w-24 shrink-0">
              <label className="block text-[9px] text-gray-500 mb-0.5">{weightLabel}</label>
              <DecimalInput
                value={weightRaw}
                onChange={handleWeightChange}
                maxDecimals={isUnit ? 0 : 3}
                placeholder={weightPlaceholder}
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[9px] text-gray-500 mb-0.5">
                Precio total ($)
                {refPrice && (
                  <span className="ml-1 text-amber-600">
                    · {formatARS(refPrice)}/{isUnit ? 'u.' : 'kg'}
                  </span>
                )}
              </label>
              <DecimalInput
                ref={priceInputRef}
                value={priceRaw}
                onChange={handlePriceChange}
                placeholder="ej. 17.535,50"
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Preview del producto */}
          {pluNum !== null && matchedProduct && (
            <p className="text-[10px] text-blue-400 truncate">
              {matchedProduct.name} · {CATEGORY_LABELS[matchedProduct.category] ?? matchedProduct.category}
            </p>
          )}
          {pluNum !== null && !matchedProduct && pluRaw.trim() && (
            <p className="text-[10px] text-yellow-500">PLU {pluNum} — no encontrado en el catálogo</p>
          )}

          {/* Preview del cálculo */}
          {price !== null && price > 0 && pluNum !== null && (() => {
            const w = parseDecimalInput(weightRaw)
            if (w === null || w <= 0) return null
            const implied = w * (refPrice ?? price)
            const diff = Math.abs(implied - price)
            if (diff < 1) return (
              <p className="text-[10px] text-green-400">
                {isUnit ? `${Math.round(w)} u.` : formatKg(w)} · Total: {formatARS(price)} ✓
              </p>
            )
            return (
              <p className="text-[10px] text-amber-400">
                {isUnit ? `${Math.round(w)} u.` : formatKg(w)} · Total: {formatARS(price)}
              </p>
            )
          })()}

          {manualError && (
            <p className="text-[10px] text-red-400">{manualError}</p>
          )}

          <button
            type="submit"
            disabled={!pluRaw.trim() || !priceRaw.trim() || !weightRaw.trim()}
            className="w-full rounded-md bg-orange-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          >
            Agregar a la venta
          </button>
        </form>
      )}
    </div>
  )
}
