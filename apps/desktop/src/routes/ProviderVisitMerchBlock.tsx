/**
 * Lista única de la visita: arranca vacía. Pollo, maple y media res conviven.
 * No crea productos al escribir. La cantidad no se precarga.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import {
  MERCH_INTAKE_MAX_LINES,
  MERCH_INTAKE_NAME_MAX,
  emptyMediaResFormLine,
  emptyMerchVisitFormLine,
  formatPurchaseUnitCostInput,
  matchVisitMerchProducts,
  merchFormLineToDraft,
  merchProductKey,
  normalizeCatalogSearch,
  resizeWeightInputs,
  resolveMerchVisitLine,
  visitLinesFromForm,
  type MerchCostUnit,
  type MerchMoneyRole,
  type MerchVisitFormLine,
  type MerchWeighMode,
  type PurchaseMemory,
} from '@carniceria/shared'
import { SuggestPopover } from '../components/ui'

export interface VisitCatalogProduct {
  id: string
  name: string
  unit: 'kg' | 'unit'
  pluNumber: number | null
  purchasePackLabel?: string | null
  purchasePackContents?: number | null
}

export type PurchaseMemoryMap = Record<string, PurchaseMemory>

/** Precio solo, para los formularios viejos de pollo y media res que el celu sigue usando. */
export type PurchasePriceMap = Record<string, number>

interface Props {
  products: VisitCatalogProduct[]
  memory: PurchaseMemoryMap
  lines: MerchVisitFormLine[]
  onChange: (lines: MerchVisitFormLine[]) => void
  invalid?: boolean
}

type BillMode = 'kg' | 'unit' | 'pack' | 'pieces'

export function emptyFormLine(partial?: Partial<MerchVisitFormLine>): MerchVisitFormLine {
  return emptyMerchVisitFormLine(partial)
}

export function formLineFromProduct(product: VisitCatalogProduct, memory?: PurchaseMemory): MerchVisitFormLine {
  const costUnit: MerchCostUnit = memory?.costUnit
    ?? (product.unit === 'kg' ? 'kg' : (product.purchasePackContents ? 'pack' : 'unit'))
  const packContents = costUnit === 'pack'
    ? (memory?.packContents ?? product.purchasePackContents ?? null)
    : null
  return emptyFormLine({
    productId: product.id,
    name: product.name,
    catalogUnit: costUnit === 'kg' ? 'kg' : 'unit',
    purchasePackLabel: costUnit === 'pack' ? (product.purchasePackLabel || 'Cajón') : null,
    purchasePackContents: packContents,
    weighPieces: false,
    costUnit,
    weighMode: memory?.weighMode ?? null,
    moneyRole: 'payable',
    notForSale: false,
    unitCostRaw: memory && memory.unitCost > 0 ? formatPurchaseUnitCostInput(memory.unitCost) : '',
  })
}

function formLineFromName(name: string, notForSale: boolean): MerchVisitFormLine {
  return emptyFormLine({
    name: name.slice(0, MERCH_INTAKE_NAME_MAX),
    catalogUnit: 'kg',
    costUnit: 'kg',
    moneyRole: 'payable',
    notForSale,
  })
}

export { visitLinesFromForm }

const fieldClass =
  'w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

const chipClass = 'rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-hover hover:text-ink'

function billMode(line: MerchVisitFormLine): BillMode {
  if (line.weighPieces && line.costUnit !== 'pack') return 'pieces'
  if (line.costUnit === 'pack') return 'pack'
  if (line.costUnit === 'unit' || line.catalogUnit === 'unit') return 'unit'
  return 'kg'
}

function patchForMode(mode: BillMode, line: MerchVisitFormLine): Partial<MerchVisitFormLine> {
  if (mode === 'pieces') {
    return {
      catalogUnit: null,
      costUnit: null,
      weighPieces: true,
      weighMode: null,
      moneyRole: line.unitCostRaw.trim() ? (line.moneyRole === 'payable' ? 'payable' : 'informed') : 'none',
      purchasePackContents: null,
      packCountRaw: '',
      kgRaw: '',
    }
  }
  if (mode === 'pack') {
    return {
      catalogUnit: 'unit',
      costUnit: 'pack',
      weighPieces: false,
      weighMode: line.weighMode,
      moneyRole: 'payable',
      purchasePackLabel: line.purchasePackLabel || 'Cajón',
      kgRaw: '',
      countRaw: '',
    }
  }
  if (mode === 'unit') {
    return {
      catalogUnit: 'unit',
      costUnit: 'unit',
      weighPieces: false,
      weighMode: null,
      moneyRole: 'payable',
      purchasePackContents: null,
      packCountRaw: '',
      kgRaw: '',
      weightRaws: [],
    }
  }
  return {
    catalogUnit: 'kg',
    costUnit: 'kg',
    weighPieces: false,
    weighMode: null,
    moneyRole: 'payable',
    purchasePackContents: null,
    packCountRaw: '',
    countRaw: '',
    weightRaws: [],
  }
}

export default function ProviderVisitMerchBlock({ products, memory, lines, onChange, invalid = false }: Props) {
  const [query, setQuery] = useState('')
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const queryRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(
    () => matchVisitMerchProducts(products, query),
    [products, query],
  )
  const queryKey = normalizeCatalogSearch(query)
  const exact = queryKey
    ? products.find(p => normalizeCatalogSearch(p.name) === queryKey) ?? null
    : null

  const runningTotal = useMemo(() => {
    const r = visitLinesFromForm(lines)
    return r.ok ? r.total : null
  }, [lines])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const line of lines) {
      const key = merchProductKey(line.productId, line.name)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [lines])

  function pushLine(line: MerchVisitFormLine) {
    if (lines.length >= MERCH_INTAKE_MAX_LINES) return
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

  const showAdd = Boolean(query.trim()) && !exact && lines.length < MERCH_INTAKE_MAX_LINES

  return (
    <div className={`space-y-3 rounded-xl border p-3 ${invalid ? 'border-danger bg-danger/5' : 'border-line bg-app'}`}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="text-sm font-medium text-ink">Lo que llegó</p>
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
          maxLength={MERCH_INTAKE_NAME_MAX}
          className={fieldClass}
        />
        <SuggestPopover
          anchorRef={queryRef}
          open={Boolean(query.trim()) && (matches.length > 0 || showAdd)}
        >
          <ul>
            {matches.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover"
                  onMouseDown={e => {
                    e.preventDefault()
                    pushLine(formLineFromProduct(p, memory[merchProductKey(p.id, p.name)]))
                  }}
                >
                  <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                  {p.pluNumber != null && (
                    <span className="shrink-0 text-xs text-muted">PLU {p.pluNumber}</span>
                  )}
                </button>
              </li>
            ))}
            {showAdd && (
              <>
                <li>
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover"
                    onMouseDown={e => { e.preventDefault(); pushLine(formLineFromName(query.trim(), false)) }}
                  >
                    <span className="min-w-0 flex-1 truncate" title={query.trim()}>Agregar «{query.trim()}»</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm text-muted hover:bg-hover"
                    onMouseDown={e => { e.preventDefault(); pushLine(formLineFromName(query.trim(), true)) }}
                  >
                    <span className="min-w-0 flex-1 truncate" title={query.trim()}>No se vende: «{query.trim()}»</span>
                  </button>
                </li>
              </>
            )}
          </ul>
        </SuggestPopover>
        {!query.trim() && lines.length === 0 && (
          <p className="mt-1 text-xs text-muted">Buscá lo que llegó. La lista arranca vacía.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={chipClass} onClick={() => pushLine(emptyMediaResFormLine())}>
          Media res
        </button>
      </div>

      <div className="space-y-3">
        {lines.map(line => (
          <VisitLineEditor
            key={line.key}
            line={line}
            duplicate={(counts.get(merchProductKey(line.productId, line.name)) ?? 0) > 1}
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
  duplicate,
  focusQty,
  invalid,
  onChange,
  onRemove,
}: {
  line: MerchVisitFormLine
  duplicate: boolean
  focusQty: boolean
  invalid: boolean
  onChange: (patch: Partial<MerchVisitFormLine>) => void
  onRemove: () => void
}) {
  const qtyRef = useRef<HTMLInputElement>(null)
  const mode = billMode(line)
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

  function setMode(next: BillMode) {
    if (next === mode) return
    onChange(patchForMode(next, line))
  }

  function setWeigh(next: MerchWeighMode | null) {
    const packs = parseNumericInput(line.packCountRaw) ?? 0
    onChange({
      weighMode: next,
      weightRaws: next === 'each' ? resizeWeightInputs(packs, line.weightRaws) : (next === 'total' ? (line.weightRaws[0] ? [line.weightRaws[0]] : ['']) : []),
    })
  }

  const priceLabel = mode === 'pack' ? 'Precio por cajón' : mode === 'unit' ? 'Precio por unidad' : 'Precio por kilo'

  return (
    <div className={`space-y-2 rounded-lg border bg-panel p-3 ${lineInvalid ? 'border-danger' : 'border-line'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={line.name || 'Sin nombre'}>
          {line.name || 'Sin nombre'}
        </p>
        {line.notForSale && (
          <span className="shrink-0 text-[10px] text-subtle" title="No se vende: suma al total y no crea producto">No se vende</span>
        )}
        <button type="button" className="shrink-0 text-xs text-muted hover:text-danger" onClick={onRemove}>
          Quitar
        </button>
      </div>

      {duplicate && (
        <p className="text-[11px] text-muted">Este producto está dos veces. Se recuerda una sola forma.</p>
      )}

      <div className="flex flex-wrap gap-1">
        {([
          ['kg', 'Kilo'],
          ['unit', 'Unidad'],
          ['pack', 'Cajón'],
          ['pieces', 'Por pieza'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`rounded-md px-2 py-1 text-xs ${mode === id ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-hover'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'kg' && (
        <label className="block space-y-1">
          <span className="text-xs text-muted">Kilos</span>
          <DecimalInput ref={qtyRef} value={line.kgRaw} onChange={v => onChange({ kgRaw: v })} weightMode className={qtyClass} />
        </label>
      )}

      {mode === 'unit' && (
        <label className="block space-y-1">
          <span className="text-xs text-muted">Unidades</span>
          <NumericInput ref={qtyRef} value={line.countRaw} onChange={v => onChange({ countRaw: v })} className={qtyClass} />
        </label>
      )}

      {mode === 'pack' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-muted">Cajones</span>
              <NumericInput
                ref={qtyRef}
                value={line.packCountRaw}
                onChange={v => {
                  const n = parseNumericInput(v) ?? 0
                  onChange({
                    packCountRaw: v,
                    weightRaws: line.weighMode === 'each' ? resizeWeightInputs(n, line.weightRaws) : line.weightRaws,
                  })
                }}
                className={qtyClass}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">1 cajón =</span>
              <NumericInput
                value={line.purchasePackContents != null ? String(line.purchasePackContents) : ''}
                onChange={v => onChange({ purchasePackContents: parseNumericInput(v) })}
                placeholder="unidades"
                className={fieldClass}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              [null, 'Sin pesar'],
              ['each', 'Cada cajón'],
              ['total', 'Peso total'],
            ] as const).map(([id, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setWeigh(id)}
                className={`rounded-md px-2 py-1 text-xs ${line.weighMode === id ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-hover'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {line.weighMode === 'total' && (
            <label className="block space-y-1">
              <span className="text-xs text-muted">Peso total (kg)</span>
              <DecimalInput
                value={line.weightRaws[0] ?? ''}
                onChange={v => onChange({ weightRaws: [v] })}
                weightMode
                className={fieldClass}
              />
            </label>
          )}
          {line.weighMode === 'each' && line.weightRaws.map((raw, i) => (
            <label key={i} className="block space-y-1">
              <span className="text-xs text-muted">Cajón {i + 1} (kg)</span>
              <DecimalInput
                value={raw}
                onChange={v => onChange({ weightRaws: line.weightRaws.map((w, idx) => idx === i ? v : w) })}
                weightMode
                className={fieldClass}
              />
            </label>
          ))}
        </div>
      )}

      {mode === 'pieces' && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs text-muted">Piezas</span>
            <NumericInput
              ref={qtyRef}
              value={line.countRaw}
              onChange={v => {
                const n = parseNumericInput(v) ?? 0
                onChange({ countRaw: v, weightRaws: resizeWeightInputs(n, line.weightRaws) })
              }}
              className={qtyClass}
            />
          </label>
          {line.weightRaws.map((raw, i) => (
            <label key={i} className="block space-y-1">
              <span className="text-xs text-muted">Pieza {i + 1} (kg)</span>
              <DecimalInput
                value={raw}
                onChange={v => onChange({ weightRaws: line.weightRaws.map((w, idx) => idx === i ? v : w) })}
                weightMode
                className={fieldClass}
              />
            </label>
          ))}
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-xs text-muted">{mode === 'pieces' ? 'Precio (opcional, $/kg)' : priceLabel}</span>
        <DecimalInput
          value={line.unitCostRaw}
          onChange={v => {
            const patch: Partial<MerchVisitFormLine> = { unitCostRaw: v }
            if (mode === 'pieces') {
              const role: MerchMoneyRole | null = v.trim()
                ? (line.moneyRole === 'payable' ? 'payable' : 'informed')
                : 'none'
              patch.moneyRole = role
            }
            onChange(patch)
          }}
          maxDecimals={2}
          className={fieldClass}
        />
      </label>

      {mode === 'pieces' && line.unitCostRaw.trim() && (
        <button
          type="button"
          className={chipClass}
          onClick={() => onChange({ moneyRole: line.moneyRole === 'payable' ? 'informed' : 'payable' })}
        >
          {line.moneyRole === 'payable' ? 'Se paga' : 'Costo informado'}
        </button>
      )}

      {resolved && resolved.moneyRole !== 'none' && (
        <p className="text-xs text-muted">
          {resolved.moneyRole === 'informed' ? 'Costo informado ' : 'Subtotal '}
          <span className="tabular-nums">{formatARS(resolved.costTotal)}</span>
          {resolved.moneyRole === 'informed' ? ' · no suma a la visita' : ''}
        </p>
      )}
    </div>
  )
}
