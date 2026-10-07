/**
 * Panel de carga manual (botón Manual del POS).
 *
 * Ingreso por PLU o nombre.
 *   - Productos por kg, sin precio especial: el kilo es el de lista y no se
 *     edita. El total sale de peso × ese precio (editar el total recalcula el peso).
 *   - Productos por kg, con precio especial: Precio por kilo ($) editable,
 *     arranca en el de lista, sin tope. El total de la línea es peso × ese precio.
 *   - Productos por unidad: cantidad entera. Precio = qty × catálogo, salvo
 *     precio especial (precio por unidad editable, arranca en el de lista).
 */

import { useEffect, useRef, useState } from 'react'
import { searchProductsByQuery } from '@carniceria/shared'
import NumericInput from './NumericInput'
import DecimalInput from './DecimalInput'
import {
  parseNumericInput,
  parseDecimalInput,
  formatDecimalInputValue,
  formatNumericInputValue,
  stripNonDigits,
  formatIntegerWithDots,
} from '../lib/numericInput'
import type { SaleItemDraft, ProductRow } from '../types/hw-api'
import { formatARS, formatKg } from '../lib/datetime'

interface Props {
  onAddItem: (item: SaleItemDraft) => void
  products: ProductRow[]
  /** Precio especial por productId cuando hay un cliente especial elegido en el POS. */
  specialPriceByProductId?: Record<string, number>
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
  specialPrice: boolean,
  unitPriceOverride?: number,
): SaleItemDraft {
  const unit = product?.unit ?? 'kg'
  const unitPrice = unitPriceOverride != null && unitPriceOverride > 0
    ? unitPriceOverride
    : (product?.price ?? (weightKg > 0 ? subtotal / weightKg : subtotal))
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
// Constantes de UI
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  beef_cut: 'Vacuno',
  poultry: 'Pollo',
  pork: 'Cerdo',
  other: 'Otros',
  bags: 'Bolsas',
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

function kgTotalRaw(weight: string, unitPrice: number): string {
  const w = parseDecimalInput(weight)
  if (w == null || w <= 0 || unitPrice <= 0) return ''
  return formatDecimalInputValue(String(Math.round(w * unitPrice)))
}

/** Línea por kg con precio especial: total = peso × precio por kilo. */
function kgSpecialLine(
  weight: string,
  kiloRaw: string,
): { weightKg: number; unitPrice: number; subtotal: number } | null {
  const weightKg = parseDecimalInput(weight)
  const unitPrice = parseNumericInput(kiloRaw)
  if (weightKg == null || weightKg <= 0 || unitPrice == null || unitPrice <= 0) return null
  const subtotal = Math.round(weightKg * unitPrice)
  if (subtotal <= 0) return null
  return { weightKg, unitPrice, subtotal }
}

export default function ScanInput({ onAddItem, products, specialPriceByProductId = {} }: Props) {
  const [pluRaw, setPluRaw] = useState('')
  const [weightRaw, setWeightRaw] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [specialPrice, setSpecialPrice] = useState(false)
  const [manualError, setManualError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const pluInputRef = useRef<HTMLInputElement>(null)
  const weightInputRef = useRef<HTMLInputElement>(null)
  const priceInputRef = useRef<HTMLInputElement>(null)
  const hideSuggestionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => pluInputRef.current?.focus(), 50)
    return () => {
      clearTimeout(timer)
      if (hideSuggestionsTimer.current) clearTimeout(hideSuggestionsTimer.current)
    }
  }, [])

  function scheduleHideSuggestions() {
    if (hideSuggestionsTimer.current) clearTimeout(hideSuggestionsTimer.current)
    hideSuggestionsTimer.current = setTimeout(() => setShowSuggestions(false), 150)
  }

  // ── PLU lookup ──────────────────────────────────────────────────────────

  const pluNum = parseNumericInput(pluRaw)

  const suggestions: ProductRow[] = (() => {
    const query = pluRaw.trim()
    if (!query) return []
    return searchProductsByQuery(products, query, {
      nameOf: p => p.name,
      pluOf: p => p.pluNumber,
    })
  })()

  const matchedProduct = pluNum !== null
    ? products.find(p => p.pluNumber === pluNum)
    : undefined

  const catalogPrice = matchedProduct?.price ?? null
  const customerSpecial = matchedProduct?.id ? specialPriceByProductId[matchedProduct.id] : undefined
  const refPrice = customerSpecial ?? catalogPrice
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

  // ── PLU suggestion pick ────────────────────────────────────────────────

  function pickSuggestion(p: ProductRow) {
    setPluRaw(String(p.pluNumber))
    setShowSuggestions(false)
    setManualError('')
    setWeightRaw('')
    setPriceRaw('')
    setSpecialPrice(false)
    setTimeout(() => weightInputRef.current?.focus(), 50)
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
    // El foco se queda en Peso, también con precio especial y coma decimal.
    // Con precio especial el kilo no se recalcula: el total sale de peso × ese kilo.
    if (specialPrice) return
    if (refPrice && refPrice > 0) {
      setPriceRaw(kgTotalRaw(v, refPrice))
    }
  }

  function handleKgPriceChange(v: string) {
    setPriceRaw(v)
    setManualError('')
    if (refPrice && refPrice > 0) {
      const p = parseDecimalInput(v)
      if (p !== null && p > 0) {
        setWeightRaw(toEsAR(p / refPrice, 3))
      }
    }
  }

  function handleKgKiloChange(v: string) {
    setPriceRaw(v)
    setManualError('')
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
      if (!isUnit) {
        setPriceRaw(refPrice && refPrice > 0 ? kgTotalRaw(weightRaw, refPrice) : '')
      }
      return
    }
    if (refPrice && refPrice > 0) {
      const rounded = String(Math.round(refPrice))
      setPriceRaw(isUnit ? formatDecimalInputValue(rounded) : formatNumericInputValue(rounded))
      return
    }
    if (!isUnit) setPriceRaw('')
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
      resetManual()
      setTimeout(() => pluInputRef.current?.focus(), 50)
    } else {
      // Producto por kg
      const w = parseDecimalInput(weightRaw)
      if (w === null || w <= 0) {
        setManualError('Peso inválido. Ingresá el peso en kg.')
        return
      }
      if (specialPrice) {
        const line = kgSpecialLine(weightRaw, priceRaw)
        if (!line) {
          setManualError('Precio por kilo inválido.')
          return
        }
        const item = buildItemFromManual(
          plu,
          line.weightKg,
          line.subtotal,
          matchedProduct,
          true,
          line.unitPrice,
        )
        onAddItem(item)
        resetManual()
        setTimeout(() => pluInputRef.current?.focus(), 50)
        return
      }
      const price = parseDecimalInput(priceRaw)
      if (price === null || price <= 0) {
        setManualError('Precio total inválido.')
        return
      }
      const item = buildItemFromManual(plu, w, price, matchedProduct, false)
      onAddItem(item)
      resetManual()
      setTimeout(() => pluInputRef.current?.focus(), 50)
    }
  }

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
    if (specialPrice) return kgSpecialLine(weightRaw, priceRaw) !== null
    return !!weightRaw.trim() && !!priceRaw.trim()
  })()

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-line px-3 py-2 space-y-2">
        <form onSubmit={handleManualSubmit} className="space-y-2">
          {/* PLU con autocomplete — acepta número PLU o nombre del producto */}
          <div className="relative">
            <label htmlFor="manual-plu" className="block text-[9px] text-muted mb-0.5">PLU o nombre</label>
            <input
              id="manual-plu"
              ref={pluInputRef}
              type="text"
              value={pluRaw}
              onChange={e => handlePluChange(e.target.value)}
              onBlur={scheduleHideSuggestions}
              onFocus={() => pluRaw.trim() && setShowSuggestions(true)}
              placeholder=""
              autoComplete="off"
              className="w-full rounded-md border border-line bg-app px-2 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute top-full mt-1 left-0 right-0 z-50 max-h-52 overflow-y-auto rounded-md border border-line bg-panel shadow-xl">
                {suggestions.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={() => pickSuggestion(p)}
                      className="w-full px-2 py-1.5 text-left hover:bg-hover transition-colors"
                    >
                      <span className="text-[10px] font-bold text-muted mr-1">{p.pluNumber}</span>
                      <span className="text-[10px] text-ink truncate">{p.name}</span>
                      {p.price != null && (
                        <span className="text-[10px] text-muted ml-1">
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
              <p className="text-[10px] text-ink truncate">
                {matchedProduct.name} · {CATEGORY_LABELS[matchedProduct.category] ?? matchedProduct.category}
                {refPrice && (
                  <span className="text-muted"> · {formatARS(refPrice)}/{isUnit ? 'u.' : 'kg'}</span>
                )}
              </p>
              <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                isUnit ? 'bg-raised text-muted' : 'bg-raised text-muted'
              }`}>
                {isUnit ? 'Por unidad' : 'Por kg'}
              </span>
            </div>
          )}
          {pluNum !== null && !matchedProduct && pluRaw.trim() && (
            <p className="text-[10px] text-muted">PLU {pluNum} — no encontrado en el catálogo</p>
          )}

          {/* ── Campos: productos por unidad ── */}
          {isUnit ? (
            <div className="space-y-2">
              <div>
                <label className="block text-[9px] text-muted mb-0.5">Cantidad</label>
                <NumericInput
                  value={weightRaw}
                  onChange={handleUnitQuantityChange}
                  placeholder=""
                  ref={weightInputRef}
                  className="w-full rounded-md border border-line bg-app px-2 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
                />
              </div>

              {/* Precio calculado (solo lectura, sin precio especial) */}
              {!specialPrice && autoPrice !== null && (
                <div className="rounded-md bg-raised px-2 py-1.5 flex justify-between items-center">
                  <span className="text-[10px] text-muted">Precio total</span>
                  <span className="text-xs font-semibold text-ink">{formatARS(autoPrice)}</span>
                </div>
              )}

              {/* Campo de precio por unidad con precio especial */}
              {specialPrice && (
                <div>
                  <label className="block text-[9px] text-muted mb-0.5">
                    Precio por unidad ($)
                    {refPrice && (
                      <span className="ml-1 text-muted">· Lista: {formatARS(refPrice)}/u.</span>
                    )}
                  </label>
                  <DecimalInput
                    ref={priceInputRef}
                    value={priceRaw}
                    onChange={v => {
                      setPriceRaw(v)
                      setManualError('')
                    }}
                    placeholder=""
                    className="w-full rounded-md border border-orange-700 bg-app px-2 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
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
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <div className="w-24 shrink-0">
                  <label htmlFor="manual-kg-weight" className="block text-[9px] text-muted mb-0.5">Peso (kg)</label>
                  <DecimalInput
                    id="manual-kg-weight"
                    value={weightRaw}
                    onChange={handleKgWeightChange}
                    maxDecimals={3}
                    weightMode
                    ref={weightInputRef}
                    placeholder=""
                    className="w-full rounded-md border border-line bg-app px-2 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
                  />
                </div>
                {specialPrice ? (
                  <div className="min-w-0 flex-1">
                    <label htmlFor="manual-kg-kilo" className="block min-w-0 truncate text-[9px] text-muted mb-0.5" title={refPrice ? `Precio por kilo ($). Lista: ${formatARS(refPrice)}/kg` : 'Precio por kilo ($)'}>
                      Precio por kilo ($)
                      {refPrice ? (
                        <span className="ml-1">· Lista: {formatARS(refPrice)}/kg</span>
                      ) : null}
                    </label>
                    <NumericInput
                      id="manual-kg-kilo"
                      ref={priceInputRef}
                      value={priceRaw}
                      onChange={handleKgKiloChange}
                      placeholder=""
                      className="w-full rounded-md border border-line-strong bg-app px-2 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <label htmlFor="manual-kg-price" className="block min-w-0 truncate text-[9px] text-muted mb-0.5" title={refPrice ? `Precio total ($). ${formatARS(refPrice)}/kg` : 'Precio total ($)'}>
                      Precio total ($)
                      {refPrice ? (
                        <span className="ml-1">· {formatARS(refPrice)}/kg</span>
                      ) : null}
                    </label>
                    <DecimalInput
                      id="manual-kg-price"
                      ref={priceInputRef}
                      value={priceRaw}
                      onChange={handleKgPriceChange}
                      placeholder=""
                      className="w-full rounded-md border border-line bg-app px-2 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none"
                    />
                  </div>
                )}
              </div>
              {specialPrice && (() => {
                const line = kgSpecialLine(weightRaw, priceRaw)
                if (!line) return null
                const detail = `${formatKg(line.weightKg)} × ${formatARS(line.unitPrice)}/kg`
                return (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-raised px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-muted">Total</p>
                      <p className="truncate text-xs text-muted" title={detail}>{detail}</p>
                    </div>
                    <p className="shrink-0 font-mono text-2xl font-bold tabular-nums text-ink">
                      {formatARS(line.subtotal)}
                    </p>
                  </div>
                )
              })()}
              {matchedProduct && !refPrice && (
                <p className="text-[10px] text-muted leading-snug">
                  {specialPrice
                    ? 'Sin precio de lista — ingresá el precio por kilo.'
                    : 'Sin precio de lista — ingresá el precio total manualmente.'}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={specialPrice}
                onChange={e => handleSpecialPriceToggle(e.target.checked)}
                className="accent-accent h-3.5 w-3.5 shrink-0"
              />
              <span className="text-xs text-ink">Precio especial</span>
              <span className="text-[10px] text-muted">
                {isUnit ? 'precio por unidad distinto de lista' : 'precio por kilo distinto de lista'}
              </span>
            </label>
            {specialPrice && (
              <p className="rounded bg-raised px-2 py-1.5 text-[10px] text-muted leading-snug">
                Precio fuera de lista. Confirmá que no es un error antes de agregar.
              </p>
            )}
          </div>

          {/* Preview del cálculo (productos por kg, sin precio especial) */}
          {!isUnit && !specialPrice && (() => {
            const w = parseDecimalInput(weightRaw)
            const p = parseDecimalInput(priceRaw)
            if (!w || !p) return null
            const implied = refPrice ? w * refPrice : null
            const match = implied !== null && Math.abs(implied - p) < 1
            return (
              <p className={`text-[10px] ${match ? 'text-success' : 'text-ink'}`}>
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
            className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-semibold text-ink hover:bg-accent disabled:opacity-40"
          >
            Agregar a la venta
          </button>
        </form>
    </div>
  )
}
