/**
 * Modo de emergencia: ingreso de ítems cuando la balanza no está disponible.
 *
 * Pestaña "PLU + precio" (default): la cajera ingresa número PLU + precio total.
 *   Al tipear el PLU aparece autocomplete con los productos del catálogo.
 *
 * Pestaña "Barcode": la cajera escanea o tipea el código EAN-13 del ticket físico.
 *   Formato: 13 dígitos, prefijo "20" → 20[PLU 3 dig][precio_cts 7 dig][check]
 *   Auto-submit al detectar 13 dígitos (lector USB).
 *
 * En ambos casos el ScaleOrder sintético se agrega directamente a la cola
 * sin pasar por hardware ni IPC.
 */

import { useEffect, useRef, useState } from 'react'
import { parseKretzBarcode, centsToARS } from '../lib/kretzBarcode'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ScaleOrder, ProductRow } from '../types/hw-api'
import { formatARS } from '../lib/datetime'

type Tab = 'manual' | 'barcode'

interface Props {
  onOrder: (order: ScaleOrder) => void
}

function buildSyntheticOrder(pluNumber: number, totalARS: number, productName?: string): ScaleOrder {
  return {
    channel: 'A',
    items: [
      {
        productCode: String(pluNumber),
        productName: productName ?? `PLU ${pluNumber}`,
        weightKg: 1,
        unitPrice: totalARS,
        subtotal: totalARS,
      },
    ],
    total: totalARS,
    timestamp: new Date().toISOString(),
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  beef_cut: 'Vacuno',
  poultry:  'Pollo',
  pork:     'Cerdo',
  other:    'Otros',
}

export default function EmergencyBarcodeInput({ onOrder }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('manual')
  const [products, setProducts] = useState<ProductRow[]>([])

  // --- Manual state ---
  const [pluRaw, setPluRaw] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [manualError, setManualError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const pluInputRef = useRef<HTMLInputElement>(null)
  const priceInputRef = useRef<HTMLInputElement>(null)

  // --- Barcode state ---
  const [barcode, setBarcode] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // Cargar catálogo al abrir
  useEffect(() => {
    if (!open || products.length > 0) return
    window.hw.getProducts().then(res => {
      if (res.ok) setProducts(res.data)
    })
  }, [open, products.length])

  const pluNum = parseNumericInput(pluRaw)

  const suggestions: ProductRow[] = (() => {
    if (!pluRaw.trim() || pluNum === null) return []
    const query = pluRaw.replace(/\./g, '')
    return products.filter(p => String(p.pluNumber).startsWith(query)).slice(0, 6)
  })()

  const matchedProduct = pluNum !== null
    ? products.find(p => p.pluNumber === pluNum)
    : undefined

  function handleToggle() {
    setOpen(prev => {
      const next = !prev
      if (next) {
        resetAll()
        setTimeout(() => pluInputRef.current?.focus(), 50)
      }
      return next
    })
  }

  function resetAll() {
    setPluRaw('')
    setPriceRaw('')
    setManualError('')
    setShowSuggestions(false)
    setBarcode('')
    setBarcodeError('')
  }

  function handleTabChange(next: Tab) {
    setTab(next)
    resetAll()
    setTimeout(() => {
      if (next === 'manual') pluInputRef.current?.focus()
      else barcodeInputRef.current?.focus()
    }, 50)
  }

  function pickSuggestion(p: ProductRow) {
    setPluRaw(String(p.pluNumber))
    setShowSuggestions(false)
    setManualError('')
    setTimeout(() => priceInputRef.current?.focus(), 50)
  }

  // ── Manual ───────────────────────────────────────────────────────────────

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setManualError('')
    setShowSuggestions(false)

    const plu = pluNum
    const price = parseNumericInput(priceRaw)

    if (plu === null || plu <= 0 || plu > 999) {
      setManualError('Número PLU inválido (debe ser entre 1 y 999).')
      return
    }
    if (price === null || price <= 0) {
      setManualError('Precio inválido. Ingresá el monto en pesos enteros.')
      return
    }

    onOrder(buildSyntheticOrder(plu, price, matchedProduct?.name))
    setPluRaw('')
    setPriceRaw('')
    setOpen(false)
  }

  // ── Barcode ──────────────────────────────────────────────────────────────

  function handleBarcodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setBarcode(raw)
    setBarcodeError('')

    const digits = raw.replace(/\D/g, '')
    if (digits.length === 13) {
      const parsed = parseKretzBarcode(digits)
      if (parsed) {
        const plu = parseInt(parsed.pluNumber, 10)
        const name = products.find(p => p.pluNumber === plu)?.name
        onOrder(buildSyntheticOrder(plu, centsToARS(parsed.totalCents), name))
        setBarcode('')
        setOpen(false)
      }
    }
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBarcodeError('')
    const parsed = parseKretzBarcode(barcode.trim())
    if (!parsed) {
      setBarcodeError('Código inválido. Verificar que sea el código del ticket KRETZ (13 dígitos).')
      return
    }
    const plu = parseInt(parsed.pluNumber, 10)
    const name = products.find(p => p.pluNumber === plu)?.name
    onOrder(buildSyntheticOrder(plu, centsToARS(parsed.totalCents), name))
    setBarcode('')
    setOpen(false)
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

  const price = parseNumericInput(priceRaw)

  return (
    <div className="border-t border-gray-800 px-3 py-2">
      <button
        type="button"
        onClick={handleToggle}
        className={`w-full rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
          open
            ? 'border-orange-500 bg-orange-500/10 text-orange-300'
            : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-orange-500/50 hover:text-orange-300'
        }`}
      >
        {open ? '▲ Cerrar ingreso de emergencia' : '⚡ Ingreso sin balanza'}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {/* Tabs */}
          <div className="flex rounded-md overflow-hidden border border-gray-700 text-[10px] font-semibold">
            <button
              type="button"
              onClick={() => handleTabChange('manual')}
              className={`flex-1 py-1 transition-colors ${
                tab === 'manual'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              PLU + precio
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('barcode')}
              className={`flex-1 py-1 transition-colors ${
                tab === 'barcode'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              Código de barras
            </button>
          </div>

          {tab === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-2">
              <p className="text-[10px] text-gray-500 leading-snug">
                Ingresá el número PLU del producto y el precio total en pesos.
              </p>

              <div className="flex gap-2">
                {/* PLU con autocomplete */}
                <div className="w-20 shrink-0 relative">
                  <label className="block text-[9px] text-gray-500 mb-0.5">PLU</label>
                  <NumericInput
                    ref={pluInputRef}
                    value={pluRaw}
                    onChange={v => {
                      setPluRaw(v)
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
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Precio */}
                <div className="flex-1">
                  <label className="block text-[9px] text-gray-500 mb-0.5">Precio total ($)</label>
                  <NumericInput
                    ref={priceInputRef}
                    value={priceRaw}
                    onChange={v => { setPriceRaw(v); setManualError('') }}
                    placeholder="ej. 17.535"
                    className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Preview del producto confirmado */}
              {pluNum !== null && matchedProduct && (
                <p className="text-[10px] text-blue-400 truncate">
                  {matchedProduct.name} · {CATEGORY_LABELS[matchedProduct.category] ?? matchedProduct.category}
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
                Agregar a la cola
              </button>
            </form>
          )}

          {tab === 'barcode' && (
            <form onSubmit={handleBarcodeSubmit} className="space-y-2">
              <p className="text-[10px] text-gray-500 leading-snug">
                Escaneá o ingresá el código del ticket KRETZ (13 dígitos).
              </p>
              <input
                ref={barcodeInputRef}
                type="text"
                inputMode="numeric"
                value={barcode}
                onChange={handleBarcodeChange}
                placeholder="2001060000012"
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
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
                className="w-full rounded-md bg-orange-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
              >
                Agregar a la cola
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
