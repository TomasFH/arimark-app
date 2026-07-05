/**
 * Input de escaneo de productos — flujo principal de ventas en la PC.
 *
 * Pestaña "Escanear" (default): código EAN-13 del ticket KRETZ.
 *   Solo acepta dígitos. Auto-submit al detectar 13 dígitos (compatible con lector USB).
 *   Calcula el peso en kg a partir del precio total / precio por kg del catálogo.
 *
 * Pestaña "PLU + precio" (emergencia): ingreso manual.
 *   - Productos por kg: campos Peso y Precio vinculados (regla de tres).
 *   - Productos por unidad: solo campo Cantidad (entero). Precio = qty × catálogo.
 *     Checkbox "Precio especial" desbloquea precio editable + muestra aviso.
 */

import { useEffect, useRef, useState } from 'react'
import { parseKretzBarcode, centsToARS } from '@carniceria/shared'
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
import { buildItemFromBarcode } from '../lib/barcodeItem'

type Tab = 'scan' | 'manual'

interface Props {
  onAddItem: (item: SaleItemDraft) => void
  products: ProductRow[]
}

// ---------------------------------------------------------------------------
// Helpers de formato (seguros con JS floats)
// ---------------------------------------------------------------------------

/** Número → string es-AR con N decimales. No usa formatDecimalInputValue para evitar
 *  que el punto decimal de JS se confunda con separador de miles. */
function toEsAR(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',')
}

function buildItemFromManual(
  pluNumber: number,
  weightKg: number,
  subtotal: number,
  product: ProductRow | undefined,
  specialPrice: boolean
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
    priceDiscrepancy: specialPrice || undefined,
  }
}

// ---------------------------------------------------------------------------
// Helpers de búsqueda
// ---------------------------------------------------------------------------

/**
 * Normaliza un string para comparación insensible a mayúsculas y acentos.
 * Ejemplo: "Vacío" → "vacio", "Über" → "uber".
 */
function normalizeSearch(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
  const [specialPrice, setSpecialPrice] = useState(false)
  const [manualError, setManualError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const pluInputRef = useRef<HTMLInputElement>(null)
  const priceInputRef = useRef<HTMLInputElement>(null)

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
    const query = pluRaw.trim()
    if (!query) return []
    const digits = query.replace(/\./g, '')
    if (/^\d+$/.test(digits)) {
      // Búsqueda por número PLU
      return products.filter(p => String(p.pluNumber).startsWith(digits)).slice(0, 6)
    }
    // Búsqueda por nombre (insensible a mayúsculas y acentos)
    const normalizedQuery = normalizeSearch(query)
    return products.filter(p => normalizeSearch(p.name).includes(normalizedQuery)).slice(0, 8)
  })()

  const matchedProduct = pluNum !== null
    ? products.find(p => p.pluNumber === pluNum)
    : undefined

  const refPrice = matchedProduct?.price ?? null
  const isUnit = matchedProduct?.unit === 'unit'

  // Precio calculado automáticamente para productos por unidad (sin precio especial)
  const autoPrice = (() => {
    if (!isUnit || specialPrice || refPrice === null) return null
    const qty = parseNumericInput(weightRaw)
    return qty !== null && qty > 0 ? qty * refPrice : null
  })()

  // ── Reset helpers ──────────────────────────────────────────────────────

  function resetManual() {
    setPluRaw('')
    setWeightRaw('')
    setPriceRaw('')
    setSpecialPrice(false)
    setManualError('')
    setShowSuggestions(false)
  }

  function handleTabChange(next: Tab) {
    setTab(next)
    setBarcode('')
    setBarcodeError('')
    resetManual()
  }

  // ── Flash feedback ─────────────────────────────────────────────────────

  function flashAdded(name: string) {
    setAddedMsg(name)
    setTimeout(() => setAddedMsg(''), 2000)
  }

  // ── PLU suggestion pick ────────────────────────────────────────────────

  function pickSuggestion(p: ProductRow) {
    setPluRaw(String(p.pluNumber))
    setShowSuggestions(false)
    setManualError('')
    setWeightRaw('')
    setPriceRaw('')
    setSpecialPrice(false)
    setTimeout(() => priceInputRef.current?.focus(), 50)
  }

  function handlePluChange(v: string) {
    const digits = stripNonDigits(v)
    if (digits || v === '') {
      // Si es puramente numérico: formatear y limitar a 3 dígitos PLU
      setPluRaw(formatIntegerWithDots(digits.slice(0, 3)))
    } else {
      // Texto libre (búsqueda por nombre): pasar tal cual, máx 40 chars
      setPluRaw(v.slice(0, 40))
    }
    setManualError('')
    setShowSuggestions(true)
    setWeightRaw('')
    setPriceRaw('')
    setSpecialPrice(false)
  }

  // ── Manual: productos por kg (campos bidireccionales) ──────────────────

  function handleKgWeightChange(v: string) {
    setWeightRaw(v)
    setManualError('')
    if (!specialPrice && refPrice && refPrice > 0) {
      const w = parseDecimalInput(v)
      if (w !== null && w > 0) {
        setPriceRaw(formatDecimalInputValue(String(Math.round(w * refPrice))))
      }
    }
  }

  function handleKgPriceChange(v: string) {
    setPriceRaw(v)
    setManualError('')
    if (!specialPrice && refPrice && refPrice > 0) {
      const p = parseDecimalInput(v)
      if (p !== null && p > 0) {
        setWeightRaw(toEsAR(p / refPrice, 3))
      }
    }
  }

  // ── Manual: productos por unidad ───────────────────────────────────────

  function handleUnitQuantityChange(v: string) {
    setWeightRaw(v)
    setManualError('')
    // Precio se recalcula en autoPrice (reactivo), no hace falta setState aquí
  }

  function handleSpecialPriceToggle(checked: boolean) {
    setSpecialPrice(checked)
    if (!checked) {
      // Al desactivar precio especial, limpiar precio manual
      setPriceRaw('')
    }
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

    if (isUnit) {
      const qty = parseNumericInput(weightRaw)
      if (qty === null || qty <= 0) {
        setManualError('Cantidad inválida. Ingresá un número entero mayor a 0.')
        return
      }
      let subtotal: number | null
      if (specialPrice) {
        const pricePerUnit = parseDecimalInput(priceRaw)
        subtotal = pricePerUnit !== null ? pricePerUnit * qty : null
      } else {
        subtotal = autoPrice
      }
      if (subtotal === null || subtotal <= 0) {
        setManualError('Precio por unidad inválido.')
        return
      }
      const item = buildItemFromManual(plu, qty, subtotal, matchedProduct, specialPrice)
      onAddItem(item)
      flashAdded(item.productName)
      resetManual()
      setTimeout(() => pluInputRef.current?.focus(), 50)
    } else {
      // Producto por kg
      const w = parseDecimalInput(weightRaw)
      if (w === null || w <= 0) {
        setManualError('Peso inválido. Ingresá el peso en kg.')
        return
      }
      const price = parseDecimalInput(priceRaw)
      if (price === null || price <= 0) {
        setManualError('Precio total inválido.')
        return
      }
      const item = buildItemFromManual(plu, w, price, matchedProduct, specialPrice)
      onAddItem(item)
      flashAdded(item.productName)
      resetManual()
      setTimeout(() => pluInputRef.current?.focus(), 50)
    }
  }

  // ── Scan ───────────────────────────────────────────────────────────────

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

  // ── Derivados para render ──────────────────────────────────────────────

  // Validación del botón submit
  const canSubmit = (() => {
    if (!pluRaw.trim()) return false
    if (isUnit) {
      const qty = parseNumericInput(weightRaw)
      if (!qty || qty <= 0) return false
      if (specialPrice) return !!priceRaw.trim()
      return autoPrice !== null
    }
    return !!weightRaw.trim() && !!priceRaw.trim()
  })()

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-gray-800 px-3 py-2 space-y-2">
      {/* Tabs — ambas opciones son alternativas/emergencia cuando no hay lector USB */}
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
          📱 Código manual
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

      {/* ── Pestaña Código manual (alternativa sin lector USB) ───────── */}
      {tab === 'scan' && (
        <form onSubmit={handleBarcodeSubmit} className="space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug">
            Ingresá el código del ticket (13 dígitos). Con el lector USB no hace falta.
          </p>
          <input
            ref={barcodeInputRef}
            type="text"
            inputMode="numeric"
            value={barcode}
            onChange={handleBarcodeChange}
            placeholder="2001060000012"
            data-barcode-input="true"
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
            Emergencia: ingresá el PLU y los datos del producto.
          </p>

          {/* PLU con autocomplete — acepta número PLU o nombre del producto */}
          <div className="relative">
            <label className="block text-[9px] text-gray-500 mb-0.5">PLU o nombre</label>
            <input
              ref={pluInputRef}
              type="text"
              value={pluRaw}
              onChange={e => handlePluChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => pluRaw.trim() && setShowSuggestions(true)}
              placeholder="ej. 5 o 'vacío'"
              autoComplete="off"
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

          {/* Info del producto */}
          {pluNum !== null && matchedProduct && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-[10px] text-blue-400 truncate">
                {matchedProduct.name} · {CATEGORY_LABELS[matchedProduct.category] ?? matchedProduct.category}
                {refPrice && (
                  <span className="text-amber-500"> · {formatARS(refPrice)}/{isUnit ? 'u.' : 'kg'}</span>
                )}
              </p>
              <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                isUnit ? 'bg-purple-900/50 text-purple-300' : 'bg-blue-900/50 text-blue-300'
              }`}>
                {isUnit ? 'Por unidad' : 'Por kg'}
              </span>
            </div>
          )}
          {pluNum !== null && !matchedProduct && pluRaw.trim() && (
            <p className="text-[10px] text-yellow-500">PLU {pluNum} — no encontrado en el catálogo</p>
          )}

          {/* ── Campos: productos por unidad ── */}
          {isUnit ? (
            <div className="space-y-2">
              <div>
                <label className="block text-[9px] text-gray-500 mb-0.5">Cantidad</label>
                <NumericInput
                  value={weightRaw}
                  onChange={handleUnitQuantityChange}
                  placeholder="ej. 2"
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                />
              </div>

              {/* Precio calculado (solo lectura, sin precio especial) */}
              {!specialPrice && autoPrice !== null && (
                <div className="rounded-md bg-gray-800/60 px-2 py-1.5 flex justify-between items-center">
                  <span className="text-[10px] text-gray-400">Precio total</span>
                  <span className="text-xs font-semibold text-amber-400">{formatARS(autoPrice)}</span>
                </div>
              )}

              {/* Campo de precio por unidad con precio especial */}
              {specialPrice && (
                <div>
                  <label className="block text-[9px] text-gray-500 mb-0.5">
                    Precio por unidad ($)
                    {refPrice && (
                      <span className="ml-1 text-amber-600">· Lista: {formatARS(refPrice)}/u.</span>
                    )}
                  </label>
                  <DecimalInput
                    ref={priceInputRef}
                    value={priceRaw}
                    onChange={v => { setPriceRaw(v); setManualError('') }}
                    placeholder={refPrice ? String(refPrice) : 'ej. 5.500'}
                    className="w-full rounded-md border border-orange-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                  />
                  {priceRaw && parseNumericInput(weightRaw) && parseDecimalInput(priceRaw) && (
                    <p className="mt-0.5 text-[9px] text-orange-300">
                      Total: {formatARS((parseDecimalInput(priceRaw) ?? 0) * (parseNumericInput(weightRaw) ?? 0))}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ── Campos: productos por kg ── */
            <div className="flex gap-2">
              <div className="w-24 shrink-0">
                <label className="block text-[9px] text-gray-500 mb-0.5">Peso (kg)</label>
                <DecimalInput
                  value={weightRaw}
                  onChange={handleKgWeightChange}
                  maxDecimals={3}
                  weightMode
                  placeholder="ej. 0,490"
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[9px] text-gray-500 mb-0.5">
                  Precio total ($)
                  {refPrice && !specialPrice && (
                    <span className="ml-1 text-amber-600">· {formatARS(refPrice)}/kg</span>
                  )}
                </label>
                <DecimalInput
                  ref={priceInputRef}
                  value={priceRaw}
                  onChange={handleKgPriceChange}
                  placeholder="ej. 7.350"
                  className={`w-full rounded-md border bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none ${
                    specialPrice ? 'border-orange-700 focus:border-orange-500' : 'border-gray-700 focus:border-orange-500'
                  }`}
                />
              </div>
            </div>
          )}

          {/* Checkbox precio especial — visible cuando hay producto en catálogo */}
          {matchedProduct && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={specialPrice}
                  onChange={e => handleSpecialPriceToggle(e.target.checked)}
                  className="accent-orange-500 h-3.5 w-3.5 shrink-0"
                />
                <span className="text-[10px] text-gray-300">Precio especial</span>
                <span className="text-[9px] text-gray-600">
                  {isUnit ? '(fuera de lista por unidad)' : '(desvincula peso y precio)'}
                </span>
              </label>
              {specialPrice && (
                <p className="rounded bg-orange-900/40 px-2 py-1.5 text-[10px] text-orange-300 leading-snug">
                  ⚠ Precio fuera de lista. Confirmá que no es un error antes de agregar.
                </p>
              )}
            </div>
          )}

          {/* Preview del cálculo (productos por kg, sin precio especial) */}
          {!isUnit && !specialPrice && (() => {
            const w = parseDecimalInput(weightRaw)
            const p = parseDecimalInput(priceRaw)
            if (!w || !p) return null
            const implied = refPrice ? w * refPrice : null
            const match = implied !== null && Math.abs(implied - p) < 1
            return (
              <p className={`text-[10px] ${match ? 'text-green-400' : 'text-amber-400'}`}>
                {formatKg(w)} · {formatARS(p)} {match ? '✓' : ''}
              </p>
            )
          })()}

          {manualError && (
            <p className="text-[10px] text-red-400">{manualError}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-md bg-orange-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          >
            Agregar a la venta
          </button>
        </form>
      )}
    </div>
  )
}
