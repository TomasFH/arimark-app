/**
 * Entrada manual de producto en el POS móvil.
 * Igual que PC: PLU o nombre → peso y/o precio (regla de tres). El peso va primero.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { searchCatalog } from '../lib/catalog'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import NumericInput from './NumericInput'
import DecimalInput from './DecimalInput'
import {
  formatDecimalInputValue,
  parseDecimalInput,
  parseNumericInput,
} from '../lib/numericInput'
import type { CatalogProduct, SaleItemDraft } from '../types/pos'

interface Props {
  catalog: CatalogProduct[]
  onAdd: (item: SaleItemDraft) => void
  onClose: () => void
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

function toEsAR(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',')
}

export function ManualEntry({ catalog, onAdd, onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CatalogProduct | null>(null)
  const [weightRaw, setWeightRaw] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [qtyRaw, setQtyRaw] = useState('1')

  const weightRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const priceRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(
    () => (query.length >= 1 && !selected ? searchCatalog(catalog, query).slice(0, 8) : []),
    [query, selected, catalog],
  )

  const isUnit = selected?.unit === 'unit'
  const refPrice = selected && selected.price > 0 ? selected.price : null

  const autoUnitTotal = (() => {
    if (!isUnit || !refPrice) return null
    const qty = parseNumericInput(qtyRaw)
    return qty !== null && qty > 0 ? qty * refPrice : null
  })()

  useEffect(() => {
    if (!selected) return
    const t = window.setTimeout(() => {
      if (selected.unit === 'unit') qtyRef.current?.focus()
      else weightRef.current?.focus()
    }, 50)
    return () => window.clearTimeout(t)
  }, [selected])

  function handleSelect(p: CatalogProduct) {
    setSelected(p)
    setQuery(p.name)
    setWeightRaw('')
    setPriceRaw('')
    setQtyRaw('1')
  }

  function handleKgWeightChange(v: string) {
    setWeightRaw(v)
    if (refPrice) {
      const w = parseDecimalInput(v)
      if (w !== null && w > 0) {
        setPriceRaw(formatDecimalInputValue(String(Math.round(w * refPrice))))
      }
    }
  }

  function handleKgPriceChange(v: string) {
    setPriceRaw(v)
    if (refPrice) {
      const p = parseDecimalInput(v)
      if (p !== null && p > 0) {
        setWeightRaw(toEsAR(p / refPrice, 3))
      }
    }
  }

  function handleAdd() {
    if (!selected) return

    if (isUnit) {
      const qty = parseNumericInput(qtyRaw)
      const subtotal = autoUnitTotal
      if (qty === null || qty <= 0 || subtotal === null || subtotal <= 0) return
      onAdd({
        productId: selected.productId,
        productName: selected.name,
        pluNumber: selected.pluNumber,
        quantity: qty,
        unitPrice: selected.price,
        subtotal,
        weightKg: null,
        manualEntry: true,
      })
    } else {
      const w = parseDecimalInput(weightRaw)
      const price = parseDecimalInput(priceRaw)
      if (w === null || w <= 0 || price === null || price <= 0) return
      onAdd({
        productId: selected.productId,
        productName: selected.name,
        pluNumber: selected.pluNumber,
        quantity: w,
        unitPrice: selected.price,
        subtotal: price,
        weightKg: w,
        manualEntry: true,
      })
    }

    setQuery('')
    setSelected(null)
    setWeightRaw('')
    setPriceRaw('')
    setQtyRaw('1')
  }

  const canSubmit = (() => {
    if (!selected) return false
    if (isUnit) return autoUnitTotal !== null && autoUnitTotal > 0
    return Boolean(parseDecimalInput(weightRaw) && parseDecimalInput(priceRaw))
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-gray-900">
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-5 pb-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold text-white">
            Agregar producto manualmente
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-2xl leading-none text-gray-400 hover:text-white"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
          {suggestions.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800">
              {suggestions.map(p => (
                <button
                  key={p.productId}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className="flex w-full min-w-0 items-center gap-2 border-b border-gray-700 px-4 py-3 text-left last:border-0 hover:bg-gray-700"
                >
                  <span className="shrink-0 font-mono text-xs text-orange-400">PLU {p.pluNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white" title={p.name}>
                    {p.name}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {formatARS(p.price)}/{p.unit === 'kg' ? 'kg' : 'ud'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-400">PLU o nombre del producto</label>
            <input
              type="text"
              value={query}
              onChange={e => {
                setQuery(e.target.value.slice(0, 40))
                setSelected(null)
              }}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Ej: Vacío  o  003"
              autoFocus
              autoComplete="off"
              maxLength={40}
            />
          </div>

          {selected && (
            <>
              <p className="truncate text-sm text-gray-300" title={selected.name}>
                {selected.name}
                {refPrice !== null && (
                  <span className="text-gray-500">
                    {' '}
                    · {formatARS(refPrice)}/{isUnit ? 'ud' : 'kg'}
                  </span>
                )}
              </p>

              {isUnit ? (
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Cantidad</label>
                  <NumericInput
                    ref={qtyRef}
                    value={qtyRaw}
                    onChange={setQtyRaw}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-center text-xl text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="1"
                  />
                  {autoUnitTotal !== null && (
                    <div className="mt-2 flex justify-between rounded-lg bg-gray-800 px-4 py-2 text-sm">
                      <span className="text-gray-400">Precio total</span>
                      <span className="font-semibold text-white">{formatARS(autoUnitTotal)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Peso (kg)</label>
                    <DecimalInput
                      ref={weightRef}
                      value={weightRaw}
                      onChange={handleKgWeightChange}
                      maxDecimals={3}
                      weightMode
                      placeholder="ej. 0,490"
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-center text-xl text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">
                      Precio total ($)
                      {refPrice !== null && (
                        <span className="ml-1 text-gray-500">· {formatARS(refPrice)}/kg</span>
                      )}
                    </label>
                    <DecimalInput
                      ref={priceRef}
                      value={priceRaw}
                      onChange={handleKgPriceChange}
                      placeholder="ej. 7.350"
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-center text-xl text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleAdd}
                disabled={!canSubmit}
                className="w-full rounded-xl bg-red-600 px-4 py-4 text-lg font-bold text-white transition-colors hover:bg-red-700 disabled:bg-gray-700"
              >
                Agregar al pedido
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
