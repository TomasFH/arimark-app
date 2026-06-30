/**
 * Input de escaneo de productos — flujo principal de ventas en la PC.
 *
 * Cada código de barras del ticket físico KRETZ = un producto. La cajera (o un
 * lector USB keyboard-wedge) escanea uno por uno y cada lectura agrega un ítem
 * a la venta en curso. La balanza NO envía pedidos a la PC
 * (ver PLAN.md → Modelo de flujo de datos).
 *
 * Pestaña "Escanear" (default): código EAN-13 del ticket KRETZ.
 *   Formato: 13 dígitos, prefijo "20" → 20[PLU 3 díg][precio_cts 7 díg][check].
 *   Auto-submit al detectar 13 dígitos (compatible con lector USB).
 *
 * Pestaña "PLU + precio" (emergencia): ingreso manual cuando no se puede escanear.
 *   Al tipear el PLU aparece autocomplete con los productos del catálogo.
 */

import { useEffect, useRef, useState } from 'react'
import { parseKretzBarcode, centsToARS } from '../lib/kretzBarcode'
import NumericInput from './NumericInput'
import DecimalInput from './DecimalInput'
import { parseNumericInput, parseDecimalInput, stripNonDigits, formatIntegerWithDots } from '../lib/numericInput'
import type { SaleItemDraft, ProductRow } from '../types/hw-api'
import { formatARS } from '../lib/datetime'

type Tab = 'scan' | 'manual'

interface Props {
  /** Se llama cada vez que se escanea o ingresa un producto a la venta en curso. */
  onAddItem: (item: SaleItemDraft) => void
  products: ProductRow[]
}

function buildItem(
  pluNumber: number,
  totalARS: number,
  manualEntry: boolean,
  product: ProductRow | undefined
): SaleItemDraft {
  return {
    pluNumber,
    productId: product?.id ?? null,
    productName: product?.name ?? `PLU ${pluNumber}`,
    weightKg: 1,
    unitPrice: totalARS,
    subtotal: totalARS,
    manualEntry,
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  beef_cut: 'Vacuno',
  poultry:  'Pollo',
  pork:     'Cerdo',
  other:    'Otros',
}

export default function ScanInput({ onAddItem, products }: Props) {
  const [tab, setTab] = useState<Tab>('scan')
  const [added, setAdded] = useState<string>('')

  // --- Manual state ---
  const [pluRaw, setPluRaw] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [manualError, setManualError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const pluInputRef = useRef<HTMLInputElement>(null)
  const priceInputRef = useRef<HTMLInputElement>(null)

  // --- Scan state ---
  const [barcode, setBarcode] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // Mantener el foco en el campo de escaneo (flujo principal con lector USB)
  useEffect(() => {
    if (tab === 'scan') barcodeInputRef.current?.focus()
    else pluInputRef.current?.focus()
  }, [tab])

  const pluNum = parseNumericInput(pluRaw)

  const suggestions: ProductRow[] = (() => {
    if (!pluRaw.trim() || pluNum === null) return []
    const query = pluRaw.replace(/\./g, '')
    return products.filter(p => String(p.pluNumber).startsWith(query)).slice(0, 6)
  })()

  const matchedProduct = pluNum !== null
    ? products.find(p => p.pluNumber === pluNum)
    : undefined

  function flashAdded(name: string) {
    setAdded(name)
    setTimeout(() => setAdded(''), 1800)
  }

  function handleTabChange(next: Tab) {
    setTab(next)
    setPluRaw('')
    setPriceRaw('')
    setManualError('')
    setShowSuggestions(false)
    setBarcode('')
    setBarcodeError('')
  }

  function pickSuggestion(p: ProductRow) {
    setPluRaw(String(p.pluNumber))
    setShowSuggestions(false)
    setManualError('')
    setTimeout(() => priceInputRef.current?.focus(), 50)
  }

  // ── Manual (emergencia) ────────────────────────────────────────────────────

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setManualError('')
    setShowSuggestions(false)

    const plu = pluNum
    const price = parseDecimalInput(priceRaw)

    if (plu === null || plu <= 0 || plu > 999) {
      setManualError('Número PLU inválido (debe ser entre 1 y 999).')
      return
    }
    if (price === null || price <= 0) {
      setManualError('Precio inválido. Ingresá el monto total en pesos.')
      return
    }

    const item = buildItem(plu, price, true, matchedProduct)
    onAddItem(item)
    flashAdded(item.productName)
    setPluRaw('')
    setPriceRaw('')
    setTimeout(() => pluInputRef.current?.focus(), 50)
  }

  // ── Scan ───────────────────────────────────────────────────────────────────

  function addFromBarcode(digits: string): boolean {
    const parsed = parseKretzBarcode(digits)
    if (!parsed) return false
    const plu = parseInt(parsed.pluNumber, 10)
    const product = products.find(p => p.pluNumber === plu)
    const item = buildItem(plu, centsToARS(parsed.totalCents), false, product)
    onAddItem(item)
    flashAdded(item.productName)
    return true
  }

  function handleBarcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setBarcode(raw)
    setBarcodeError('')

    const digits = raw.replace(/\D/g, '')
    if (digits.length === 13) {
      if (addFromBarcode(digits)) {
        setBarcode('')
        setTimeout(() => barcodeInputRef.current?.focus(), 0)
      }
    }
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBarcodeError('')
    if (addFromBarcode(barcode.trim())) {
      setBarcode('')
      setTimeout(() => barcodeInputRef.current?.focus(), 0)
    } else {
      setBarcodeError('Código inválido. Verificar que sea el código del ticket KRETZ (13 dígitos).')
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

  // ── Render ───────────────────────────────────────────────────────────────

  const price = parseDecimalInput(priceRaw)

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

      {added && (
        <p className="rounded bg-green-900/40 px-2 py-1 text-[10px] text-green-300">
          ✓ Agregado: {added}
        </p>
      )}

      {tab === 'scan' && (
        <form onSubmit={handleBarcodeSubmit} className="space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug">
            Escaneá el código del ticket KRETZ (13 dígitos). Se agrega solo al leerlo.
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
            <p className="text-[10px] text-green-400">
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

      {tab === 'manual' && (
        <form onSubmit={handleManualSubmit} className="space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug">
            Emergencia: ingresá el número PLU y el precio total en pesos.
          </p>

          <div className="flex gap-2">
            {/* PLU con autocomplete */}
            <div className="w-20 shrink-0 relative">
              <label className="block text-[9px] text-gray-500 mb-0.5">PLU</label>
              <NumericInput
                ref={pluInputRef}
                value={pluRaw}
                onChange={v => {
                  setPluRaw(formatIntegerWithDots(stripNonDigits(v).slice(0, 3)))
                  setManualError('')
                  setShowSuggestions(true)
                }}
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
                          <span className="text-[10px] text-amber-400 ml-1">{formatARS(p.price)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Precio */}
            <div className="flex-1">
              <label className="block text-[9px] text-gray-500 mb-0.5">Precio total ($)</label>
              <DecimalInput
                ref={priceInputRef}
                value={priceRaw}
                onChange={v => { setPriceRaw(v); setManualError('') }}
                placeholder="ej. 17.535,50"
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Preview del producto confirmado */}
          {pluNum !== null && matchedProduct && (
            <p className="text-[10px] text-blue-400 truncate">
              {matchedProduct.name} · {CATEGORY_LABELS[matchedProduct.category] ?? matchedProduct.category}
              {matchedProduct.price != null && (
                <span className="text-amber-400"> · {formatARS(matchedProduct.price)}/{matchedProduct.unit === 'unit' ? 'u.' : 'kg'}</span>
              )}
            </p>
          )}
          {pluNum !== null && !matchedProduct && pluRaw.trim() && (
            <p className="text-[10px] text-yellow-500">PLU {pluNum} — no encontrado en el catálogo</p>
          )}
          {price !== null && price > 0 && pluNum !== null && (
            <p className="text-[10px] text-green-400">
              Total: {formatARS(price)}
            </p>
          )}

          {manualError && (
            <p className="text-[10px] text-red-400">{manualError}</p>
          )}

          <button
            type="submit"
            disabled={!pluRaw.trim() || !priceRaw.trim()}
            className="w-full rounded-md bg-orange-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          >
            Agregar a la venta
          </button>
        </form>
      )}
    </div>
  )
}
