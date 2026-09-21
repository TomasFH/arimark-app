/**
 * Tipo de visita (Productos / Media res / Pollo) y formularios compactos de kilos.
 * Identidad Operate: mostrador, tokens de DESIGN.md. Copy de caja, nunca "Catálogo".
 */
import DecimalInput from '../components/DecimalInput'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatARS } from '../lib/datetime'
import {
  CHICKEN_VISIT_NAME,
  DEFAULT_MAPLE_PACK_LABEL,
  MERCH_INTAKE_MAX_WEIGHTS,
  PROVIDER_INTAKE_KIND_LABELS,
  emptyChickenFormLine,
  emptyMediaResFormLine,
  merchProductKey,
  resizeWeightInputs,
  type MerchVisitFormLine,
  type ProviderIntakeKind,
} from '@carniceria/shared'
import type { PurchasePriceMap } from './ProviderVisitMerchBlock'

const FIELD =
  'w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent focus-visible:ring-2 focus-visible:ring-accent'

const CHIP =
  'rounded-lg px-2 py-2.5 min-h-[44px] text-sm font-semibold text-ink transition-colors hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50'

const KINDS: ProviderIntakeKind[] = ['catalog', 'media_res', 'chicken', 'insumos']

function kgProgressHint(
  count: number,
  weights: string[],
  noun: { one: string; many: string },
): string | null {
  if (count <= 0) return null
  const filled = weights.filter(w => w.trim()).length
  if (filled === 0) {
    return count === 1
      ? `Completá el kilo de ${noun.one}.`
      : `Completá el kilo de cada ${noun.one}.`
  }
  if (filled < count) {
    const missing = count - filled
    return missing === 1 ? 'Falta 1 kilo.' : `Faltan ${missing} kilos.`
  }
  return count === 1 ? `1 ${noun.one}` : `${count} ${noun.many}`
}

export function ProviderIntakeKindPicker({
  value,
  onChoose,
  onClear,
  busy = false,
}: {
  value: ProviderIntakeKind | null
  onChoose: (kind: ProviderIntakeKind) => void
  onClear: () => void
  busy?: boolean
}) {
  if (value) {
    const label = PROVIDER_INTAKE_KIND_LABELS[value]
    return (
      <div className="flex items-center gap-2 min-w-0">
        <p className="min-w-0 flex-1 truncate text-sm text-muted" title={`Trae ${label}`}>
          Trae {label}
        </p>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          Cambiar qué trae
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Qué trae</p>
      <div className="relative grid grid-cols-2 gap-1 rounded-xl bg-app p-1" role="radiogroup" aria-label="Qué trae">
        <span aria-hidden className="pointer-events-none absolute inset-x-5 top-1/2 z-[1] h-px -translate-y-px bg-line opacity-40" />
        <span aria-hidden className="pointer-events-none absolute inset-y-3 left-1/2 z-[1] w-px -translate-x-px bg-line opacity-40" />
        {KINDS.map(id => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={false}
            disabled={busy}
            onClick={() => onChoose(id)}
            className={CHIP}
          >
            {PROVIDER_INTAKE_KIND_LABELS[id]}
          </button>
        ))}
      </div>
    </div>
  )
}

export function VisitWeightGrid({
  values,
  onChange,
  unitLabel,
}: {
  values: string[]
  onChange: (next: string[]) => void
  unitLabel: string
}) {
  if (values.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {values.map((raw, i) => (
        <label key={i} className="min-w-0 space-y-1">
          <span className="block text-xs tabular-nums text-muted">{i + 1}</span>
          <DecimalInput
            value={raw}
            onChange={v => {
              const next = [...values]
              next[i] = v
              onChange(next)
            }}
            weightMode
            aria-label={`${unitLabel} ${i + 1}`}
            className={FIELD}
          />
        </label>
      ))}
    </div>
  )
}

export function MediaResVisitForm({
  lines,
  onChange,
}: {
  lines: MerchVisitFormLine[]
  onChange: (lines: MerchVisitFormLine[]) => void
}) {
  const line = lines[0] ?? emptyMediaResFormLine()
  const count = parseNumericInput(line.countRaw) ?? 0
  const weights = line.weightRaws
  const progress = kgProgressHint(count, weights, { one: 'unidad', many: 'unidades' })

  function commit(patch: Partial<MerchVisitFormLine>) {
    const next = { ...line, ...patch, name: 'Media res', weighPieces: true, unitCostRaw: '0', costUnit: null }
    onChange([next])
  }

  function setCount(raw: string) {
    const n = parseNumericInput(raw) ?? 0
    const capped = Math.min(MERCH_INTAKE_MAX_WEIGHTS, n)
    commit({
      countRaw: raw,
      weightRaws: resizeWeightInputs(capped, line.weightRaws),
    })
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-raised/40 p-3">
      <label className="block space-y-1">
        <span className="text-xs text-muted">Unidades</span>
        <NumericInput
          value={line.countRaw}
          onChange={setCount}
          placeholder="0"
          className={FIELD}
        />
      </label>
      {count > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted">Kilos de cada una</p>
          <VisitWeightGrid
            values={weights}
            onChange={weightRaws => commit({ weightRaws })}
            unitLabel="Kilos"
          />
        </div>
      )}
      {progress && <p className="text-xs text-muted">{progress}</p>}
    </div>
  )
}

export function ChickenVisitForm({
  lines,
  lastPrices,
  onChange,
}: {
  lines: MerchVisitFormLine[]
  lastPrices: PurchasePriceMap
  onChange: (lines: MerchVisitFormLine[]) => void
}) {
  const lastCost = lastPrices[merchProductKey(null, CHICKEN_VISIT_NAME)]
  const line = lines[0] ?? emptyChickenFormLine(lastCost)
  const count = parseNumericInput(line.packCountRaw) ?? 0
  const crateCost = parseNumericInput(line.unitCostRaw)
  const total = count > 0 && crateCost != null && crateCost > 0 ? count * crateCost : null
  const progress = kgProgressHint(count, line.weightRaws, { one: 'cajón', many: 'cajones' })

  function commit(patch: Partial<MerchVisitFormLine>) {
    const next = {
      ...line,
      ...patch,
      name: CHICKEN_VISIT_NAME,
      catalogUnit: 'unit' as const,
      purchasePackLabel: DEFAULT_MAPLE_PACK_LABEL,
      purchasePackContents: null,
      weighPieces: true,
      costUnit: 'pack' as const,
    }
    onChange([next])
  }

  function setCount(raw: string) {
    const n = parseNumericInput(raw) ?? 0
    const capped = Math.min(MERCH_INTAKE_MAX_WEIGHTS, n)
    commit({
      packCountRaw: raw,
      weightRaws: resizeWeightInputs(capped, line.weightRaws),
    })
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-raised/40 p-3">
      {total != null && (
        <p className="text-right text-sm font-semibold tabular-nums text-ink">{formatARS(total)}</p>
      )}
      <label className="block space-y-1">
        <span className="text-xs text-muted">Cajones</span>
        <NumericInput
          value={line.packCountRaw}
          onChange={setCount}
          placeholder="0"
          className={FIELD}
        />
      </label>
      {count > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted">Kilos brutos de cada cajón</p>
          <VisitWeightGrid
            values={line.weightRaws}
            onChange={weightRaws => commit({ weightRaws })}
            unitLabel="Kilos brutos"
          />
        </div>
      )}
      {progress && <p className="text-xs text-muted">{progress}</p>}
      <label className="block space-y-1">
        <span className="text-xs text-muted">Precio por cajón ($)</span>
        <NumericInput
          value={line.unitCostRaw}
          onChange={v => commit({ unitCostRaw: v })}
          placeholder="0"
          className={FIELD}
        />
      </label>
    </div>
  )
}
