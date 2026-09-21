/**
 * Renglones de mercadería en una visita a proveedor (Gastos del celu).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import DecimalInput from './DecimalInput'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatMoney } from '../lib/adminFirestore'
import {
  emptyMerchVisitFormLine,
  merchFormLineToDraft,
  merchProductKey,
  resolveMerchVisitLine,
  visitLinesFromForm,
  type MerchVisitFormLine,
} from '@carniceria/shared'
import type { CatalogProduct } from '../types/pos'
import type { PurchasePriceMap } from '../lib/merchVisit'

interface Props {
  products: CatalogProduct[]
  lastPrices: PurchasePriceMap
  lines: MerchVisitFormLine[]
  onChange: (lines: MerchVisitFormLine[]) => void
  invalid?: boolean
}

export function formLineFromProduct(product: CatalogProduct, lastCost: number | undefined): MerchVisitFormLine {
  const pack = product.unit === 'unit' && product.purchasePackContents != null && product.purchasePackContents > 0
  return emptyMerchVisitFormLine({
    productId: product.productId,
    name: product.name,
    catalogUnit: product.unit,
    purchasePackLabel: product.purchasePackLabel ?? null,
    purchasePackContents: product.purchasePackContents ?? null,
    unitCostRaw: lastCost != null ? String(lastCost) : '',
    packCountRaw: pack ? '' : '',
  })
}

export { visitLinesFromForm }

const fieldClass =
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500'

export function ProviderVisitMerchBlock({ products, lastPrices, lines, onChange, invalid = false }: Props) {
  const [query, setQuery] = useState('')
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products.slice(0, 8)
    return products.filter(p =>
      p.name.toLowerCase().includes(q) || String(p.pluNumber).includes(q),
    ).slice(0, 8)
  }, [products, query])

  const runningTotal = useMemo(() => {
    const r = visitLinesFromForm(lines)
    return r.ok ? r.total : null
  }, [lines])

  function addProduct(product: CatalogProduct) {
    const key = merchProductKey(product.productId, product.name)
    const line = formLineFromProduct(product, lastPrices[key])
    onChange([...lines, line])
    setQuery('')
    setFocusKey(line.key)
  }

  return (
    <div className={`space-y-3 rounded-xl border p-3 ${invalid ? 'border-red-500 bg-red-950/30' : 'border-gray-700 bg-gray-800/60'}`}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="text-sm font-medium text-white">Mercadería de esta visita</p>
        {runningTotal != null && runningTotal > 0 && (
          <p className="shrink-0 text-sm font-semibold tabular-nums text-white">{formatMoney(runningTotal)}</p>
        )}
      </div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar producto…"
          maxLength={100}
          className={fieldClass}
        />
        {query.trim() && matches.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
            {matches.map(p => (
              <li key={p.productId}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
                  onMouseDown={e => { e.preventDefault(); addProduct(p) }}
                >
                  <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                  <span className="shrink-0 text-xs text-gray-400">PLU {p.pluNumber}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && matches.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">No hay productos con ese nombre.</p>
        )}
        {!query.trim() && lines.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">Buscá el producto.</p>
        )}
      </div>
      <div className="space-y-3">
        {lines.map(line => (
          <VisitLineEditor
            key={line.key}
            line={line}
            focusQty={focusKey === line.key}
            invalid={invalid}
            onChange={patch => onChange(lines.map(l => l.key === line.key ? { ...l, ...patch } : l))}
            onRemove={() => onChange(lines.filter(l => l.key !== line.key))}
          />
        ))}
      </div>
    </div>
  )
}

function VisitLineEditor({
  line,
  focusQty,
  invalid,
  onChange,
  onRemove,
}: {
  line: MerchVisitFormLine
  focusQty: boolean
  invalid: boolean
  onChange: (patch: Partial<MerchVisitFormLine>) => void
  onRemove: () => void
}) {
  const qtyRef = useRef<HTMLInputElement>(null)
  const pack = line.catalogUnit === 'unit' && line.purchasePackContents != null && line.purchasePackContents > 0
  const isKg = line.catalogUnit === 'kg'
  const isUnit = line.catalogUnit === 'unit' && !pack
  const packCount = parseNumericInput(line.packCountRaw)
  const derivedUnits = pack && packCount != null ? packCount * (line.purchasePackContents ?? 0) : null
  const resolved = (() => {
    const draft = merchFormLineToDraft(line)
    if ('error' in draft) return null
    const r = resolveMerchVisitLine(draft, { id: line.key, sortOrder: 0 })
    return r.ok ? r.line : null
  })()
  const lineInvalid = invalid && resolved == null
  const qtyClass = lineInvalid
    ? `${fieldClass} border-red-500 ring-1 ring-red-500`
    : fieldClass

  useEffect(() => {
    if (!focusQty) return
    const el = qtyRef.current
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }, [focusQty])

  return (
    <div className={`space-y-2 rounded-lg border bg-gray-900 p-3 ${lineInvalid ? 'border-red-500' : 'border-gray-700'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white" title={line.name || 'Sin nombre'}>
          {line.name || 'Sin nombre'}
        </p>
        <button type="button" className="shrink-0 text-xs text-gray-400" onClick={onRemove}>Quitar</button>
      </div>
      {isKg && (
        <label className="block space-y-1">
          <span className="text-xs text-gray-400">Kilos</span>
          <DecimalInput ref={qtyRef} value={line.kgRaw} onChange={v => onChange({ kgRaw: v })} weightMode className={qtyClass} />
        </label>
      )}
      {pack && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs text-gray-400">{line.purchasePackLabel || 'Cajones'}</span>
            <NumericInput ref={qtyRef} value={line.packCountRaw} onChange={v => onChange({ packCountRaw: v })} className={qtyClass} />
          </label>
          <p className="self-end text-xs text-gray-400">
            {derivedUnits != null ? `${derivedUnits} u` : `1 ${line.purchasePackLabel || 'cajón'} = ${line.purchasePackContents} u`}
          </p>
        </div>
      )}
      {isUnit && (
        <label className="block space-y-1">
          <span className="text-xs text-gray-400">Unidades</span>
          <NumericInput ref={qtyRef} value={line.countRaw} onChange={v => onChange({ countRaw: v })} className={qtyClass} />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-xs text-gray-400">
          Precio de compra {pack ? `($/${(line.purchasePackLabel || 'cajón').toLowerCase()})` : isUnit ? '($/u)' : '($/kg)'}
        </span>
        <NumericInput value={line.unitCostRaw} onChange={v => onChange({ unitCostRaw: v })} className={fieldClass} />
      </label>
      {resolved && (
        <p className="text-xs text-gray-400">
          Subtotal {formatMoney(resolved.costTotal)}
          {pack && derivedUnits != null ? ` · ${derivedUnits} u` : ''}
        </p>
      )}
    </div>
  )
}
