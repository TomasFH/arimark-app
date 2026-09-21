/**
 * Renglones de mercadería de catálogo en una visita (tipo Productos).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import {
  emptyMerchVisitFormLine,
  merchFormLineToDraft,
  merchProductKey,
  resolveMerchVisitLine,
  visitLinesFromForm,
  type MerchVisitFormLine,
} from '@carniceria/shared'
import { SuggestPopover } from '../components/ui'
import type { ProductRow } from '../types/hw-api'

export interface PurchasePriceMap {
  [productKey: string]: number
}

interface Props {
  products: ProductRow[]
  lastPrices: PurchasePriceMap
  lines: MerchVisitFormLine[]
  onChange: (lines: MerchVisitFormLine[]) => void
  invalid?: boolean
}

export function emptyFormLine(partial?: Partial<MerchVisitFormLine>): MerchVisitFormLine {
  return emptyMerchVisitFormLine(partial)
}

export function formLineFromProduct(product: ProductRow, lastCost: number | undefined): MerchVisitFormLine {
  const pack = product.unit === 'unit' && product.purchasePackContents != null && product.purchasePackContents > 0
  return emptyFormLine({
    productId: product.id,
    name: product.name,
    catalogUnit: product.unit,
    purchasePackLabel: product.purchasePackLabel,
    purchasePackContents: product.purchasePackContents,
    weighPieces: false,
    unitCostRaw: lastCost != null ? String(lastCost) : '',
    weightRaws: [],
    packCountRaw: pack ? '' : '',
  })
}

export { visitLinesFromForm }

const fieldClass =
  'w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

export default function ProviderVisitMerchBlock({ products, lastPrices, lines, onChange, invalid = false }: Props) {
  const [query, setQuery] = useState('')
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const queryRef = useRef<HTMLInputElement>(null)

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

  function addProduct(product: ProductRow) {
    const key = merchProductKey(product.id, product.name)
    const line = formLineFromProduct(product, lastPrices[key])
    onChange([...lines, line])
    setQuery('')
    setFocusKey(line.key)
  }

  function updateLine(key: string, patch: Partial<MerchVisitFormLine>) {
    onChange(lines.map(l => l.key === key ? { ...l, ...patch } : l))
  }

  function removeLine(key: string) {
    onChange(lines.filter(l => l.key !== key))
  }

  return (
    <div className={`space-y-3 rounded-xl border p-3 ${invalid ? 'border-danger bg-danger/5' : 'border-line bg-raised/40'}`}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="text-sm font-medium text-ink">Mercadería de esta visita</p>
        {runningTotal != null && runningTotal > 0 && (
          <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatARS(runningTotal)}</p>
        )}
      </div>

      <div>
        <input
          ref={queryRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar producto…"
          maxLength={100}
          className={fieldClass}
        />
        <SuggestPopover
          anchorRef={queryRef}
          open={Boolean(query.trim() && matches.length > 0)}
        >
          <ul>
            {matches.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover"
                  onMouseDown={e => { e.preventDefault(); addProduct(p) }}
                >
                  <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                  <span className="shrink-0 text-xs text-muted">PLU {p.pluNumber}</span>
                </button>
              </li>
            ))}
          </ul>
        </SuggestPopover>
        {query.trim() && matches.length === 0 && (
          <p className="mt-1 text-xs text-muted">No hay productos con ese nombre.</p>
        )}
        {!query.trim() && lines.length === 0 && (
          <p className="mt-1 text-xs text-muted">Buscá el producto.</p>
        )}
      </div>

      <div className="space-y-3">
        {lines.map(line => (
          <VisitLineEditor
            key={line.key}
            line={line}
            focusQty={focusKey === line.key}
            invalid={invalid}
            onChange={patch => updateLine(line.key, patch)}
            onRemove={() => removeLine(line.key)}
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
    ? `${fieldClass} border-danger focus:border-danger focus-visible:ring-2 focus-visible:ring-danger`
    : fieldClass

  useEffect(() => {
    if (!focusQty) return
    const el = qtyRef.current
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }, [focusQty])

  return (
    <div className={`space-y-2 rounded-lg border bg-panel p-3 ${lineInvalid ? 'border-danger' : 'border-line'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={line.name || 'Sin nombre'}>
          {line.name || 'Sin nombre'}
        </p>
        <button type="button" className="shrink-0 text-xs text-muted hover:text-danger" onClick={onRemove}>
          Quitar
        </button>
      </div>

      {isKg && (
        <label className="block space-y-1">
          <span className="text-xs text-muted">Kilos</span>
          <DecimalInput
            ref={qtyRef}
            value={line.kgRaw}
            onChange={v => onChange({ kgRaw: v })}
            weightMode
            className={qtyClass}
          />
        </label>
      )}

      {pack && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs text-muted">{line.purchasePackLabel || 'Cajones'}</span>
            <NumericInput ref={qtyRef} value={line.packCountRaw} onChange={v => onChange({ packCountRaw: v })} className={qtyClass} />
          </label>
          <p className="self-end text-xs text-muted">
            {derivedUnits != null ? `${derivedUnits} u` : `1 ${line.purchasePackLabel || 'cajón'} = ${line.purchasePackContents} u`}
          </p>
        </div>
      )}

      {isUnit && (
        <label className="block space-y-1">
          <span className="text-xs text-muted">Unidades</span>
          <NumericInput ref={qtyRef} value={line.countRaw} onChange={v => onChange({ countRaw: v })} className={qtyClass} />
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-xs text-muted">
          Precio de compra {pack ? `($/${(line.purchasePackLabel || 'cajón').toLowerCase()})` : isUnit ? '($/u)' : '($/kg)'}
        </span>
        <NumericInput value={line.unitCostRaw} onChange={v => onChange({ unitCostRaw: v })} className={fieldClass} />
      </label>
      {resolved && (
        <p className="text-xs text-muted">
          Subtotal {formatARS(resolved.costTotal)}
          {pack && derivedUnits != null ? ` · ${derivedUnits} u` : ''}
        </p>
      )}
    </div>
  )
}
