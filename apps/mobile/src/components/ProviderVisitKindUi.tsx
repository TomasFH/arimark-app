/**
 * Tipo de visita y grillas de kilos (Gastos del celu).
 * Copy de caja: Productos / Media res / Pollo. Nunca "Catálogo".
 */
import DecimalInput from './DecimalInput'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { formatMoney } from '../lib/adminFirestore'
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
import type { PurchasePriceMap } from '../lib/merchVisit'

const FIELD =
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500'

const CHIP =
  'min-h-[44px] rounded-lg px-2 py-3 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50'

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
        <p className="min-w-0 flex-1 truncate text-sm text-gray-400" title={`Trae ${label}`}>
          Trae {label}
        </p>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="shrink-0 rounded-lg px-2 py-2 text-xs text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
        >
          Cambiar qué trae
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">Qué trae</p>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/40 p-1" role="radiogroup" aria-label="Qué trae">
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
    <div className="grid grid-cols-2 gap-2">
      {values.map((raw, i) => (
        <label key={i} className="min-w-0 space-y-1">
          <span className="block text-xs tabular-nums text-gray-400">{i + 1}</span>
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
  const progress = kgProgressHint(count, line.weightRaws, { one: 'unidad', many: 'unidades' })

  function commit(patch: Partial<MerchVisitFormLine>) {
    onChange([{
      ...line,
      ...patch,
      name: 'Media res',
      weighPieces: true,
      unitCostRaw: '0',
      costUnit: null,
    }])
  }

  function setCount(raw: string) {
    const n = parseNumericInput(raw) ?? 0
    commit({
      countRaw: raw,
      weightRaws: resizeWeightInputs(Math.min(MERCH_INTAKE_MAX_WEIGHTS, n), line.weightRaws),
    })
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-700 bg-gray-800/60 p-3">
      <label className="block space-y-1">
        <span className="text-xs text-gray-400">Unidades</span>
        <NumericInput value={line.countRaw} onChange={setCount} placeholder="0" className={FIELD} />
      </label>
      {count > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-400">Kilos de cada una</p>
          <VisitWeightGrid
            values={line.weightRaws}
            onChange={weightRaws => commit({ weightRaws })}
            unitLabel="Kilos"
          />
        </div>
      )}
      {progress && <p className="text-xs text-gray-400">{progress}</p>}
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
    onChange([{
      ...line,
      ...patch,
      name: CHICKEN_VISIT_NAME,
      catalogUnit: 'unit',
      purchasePackLabel: DEFAULT_MAPLE_PACK_LABEL,
      purchasePackContents: null,
      weighPieces: true,
      costUnit: 'pack',
    }])
  }

  function setCount(raw: string) {
    const n = parseNumericInput(raw) ?? 0
    commit({
      packCountRaw: raw,
      weightRaws: resizeWeightInputs(Math.min(MERCH_INTAKE_MAX_WEIGHTS, n), line.weightRaws),
    })
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-700 bg-gray-800/60 p-3">
      {total != null && (
        <p className="text-right text-sm font-semibold tabular-nums text-white">{formatMoney(total)}</p>
      )}
      <label className="block space-y-1">
        <span className="text-xs text-gray-400">Cajones</span>
        <NumericInput value={line.packCountRaw} onChange={setCount} placeholder="0" className={FIELD} />
      </label>
      {count > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-400">Kilos brutos de cada cajón</p>
          <VisitWeightGrid
            values={line.weightRaws}
            onChange={weightRaws => commit({ weightRaws })}
            unitLabel="Kilos brutos"
          />
        </div>
      )}
      {progress && <p className="text-xs text-gray-400">{progress}</p>}
      <label className="block space-y-1">
        <span className="text-xs text-gray-400">Precio por cajón ($)</span>
        <NumericInput value={line.unitCostRaw} onChange={v => commit({ unitCostRaw: v })} placeholder="0" className={FIELD} />
      </label>
    </div>
  )
}
