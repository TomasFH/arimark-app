import {
  ARS_BILL_DENOMINATIONS,
  compactBillLines,
  formatBillDenomination,
  type BillLine,
} from '@carniceria/shared'
import NumericInput from './NumericInput'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'

export type BillMode = 'quantity' | 'total'

export interface BillRowState {
  denomination: number
  quantity: string
  total: string
  totalError: string | null
}

export function emptyBillRows(): BillRowState[] {
  return ARS_BILL_DENOMINATIONS.map(d => ({
    denomination: d,
    quantity: '',
    total: '',
    totalError: null,
  }))
}

export function billRowsFromLines(lines: BillLine[]): BillRowState[] {
  const qty = new Map(compactBillLines(lines).map(l => [l.denomination, l.quantity]))
  return ARS_BILL_DENOMINATIONS.map(d => {
    const q = qty.get(d) ?? 0
    return {
      denomination: d,
      quantity: q > 0 ? formatNumericInputValue(String(q)) : '',
      total: q > 0 ? formatNumericInputValue(String(d * q)) : '',
      totalError: null,
    }
  })
}

export function billRowsToLines(rows: BillRowState[], mode: BillMode): BillLine[] {
  return compactBillLines(rows.map(r => {
    const qty = mode === 'quantity'
      ? (parseNumericInput(r.quantity) ?? 0)
      : Math.round((parseNumericInput(r.total) ?? 0) / r.denomination)
    return { denomination: r.denomination, quantity: Number.isFinite(qty) ? qty : 0 }
  }))
}

export function billRowsCountedTotal(rows: BillRowState[], mode: BillMode): number {
  return rows.reduce((acc, r) => {
    if (mode === 'quantity') return acc + r.denomination * (parseNumericInput(r.quantity) ?? 0)
    return acc + (parseNumericInput(r.total) ?? 0)
  }, 0)
}

export function cashAmountToInput(amount: number): string {
  if (amount <= 0) return '0'
  return formatNumericInputValue(String(amount))
}

function fmt(n: number) {
  return `$${n.toLocaleString('es-AR')}`
}

interface Props {
  rows: BillRowState[]
  mode: BillMode
  onModeChange: (mode: BillMode) => void
  onUpdate: (denomination: number, field: 'quantity' | 'total', value: string) => void
  countedTotal: number
  expectedTotal?: number
  showExpectedDiff?: boolean
  title?: string
  subtitle?: string
}

export function BillCountGrid({
  rows,
  mode,
  onModeChange,
  onUpdate,
  countedTotal,
  expectedTotal,
  showExpectedDiff = false,
  title = 'Conteo de billetes',
  subtitle,
}: Props) {
  const diff = expectedTotal != null ? countedTotal - expectedTotal : 0

  return (
    <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-gray-500" title={subtitle}>{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-gray-700 text-[11px]">
          <button
            type="button"
            onClick={() => onModeChange('quantity')}
            className={`px-2 py-1 ${mode === 'quantity' ? 'bg-gray-700 text-white' : 'bg-gray-950 text-gray-400'}`}
          >
            Cantidad
          </button>
          <button
            type="button"
            onClick={() => onModeChange('total')}
            className={`px-2 py-1 ${mode === 'total' ? 'bg-gray-700 text-white' : 'bg-gray-950 text-gray-400'}`}
          >
            Monto
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map(row => (
          <div key={row.denomination} className="space-y-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-20 shrink-0 text-right text-sm text-gray-300">
                {formatBillDenomination(row.denomination)}
              </span>
              {mode === 'quantity' ? (
                <>
                  <span className="text-xs text-gray-500">×</span>
                  <NumericInput
                    value={row.quantity}
                    onChange={v => onUpdate(row.denomination, 'quantity', v)}
                    placeholder="0"
                    className="w-16 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-center text-sm text-white"
                  />
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-gray-500">
                    {(parseNumericInput(row.quantity) ?? 0) > 0
                      ? fmt(row.denomination * (parseNumericInput(row.quantity) ?? 0))
                      : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-xs text-gray-500">=</span>
                  <NumericInput
                    value={row.total}
                    onChange={v => onUpdate(row.denomination, 'total', v)}
                    placeholder="0"
                    className={`min-w-0 flex-1 rounded-lg border bg-gray-950 px-2 py-1.5 text-sm text-white ${
                      row.totalError ? 'border-red-500' : 'border-gray-700'
                    }`}
                  />
                </>
              )}
            </div>
            {row.totalError && (
              <p className="pl-[5.5rem] text-xs text-red-400">{row.totalError}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between border-t border-gray-800 pt-2 text-sm">
        <span className="text-gray-400">Total en registradora</span>
        <span className="font-semibold text-white">{fmt(countedTotal)}</span>
      </div>
      {showExpectedDiff && expectedTotal != null && (
        <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${
          diff === 0 ? 'bg-emerald-950 text-emerald-300' : diff > 0 ? 'bg-sky-950 text-sky-300' : 'bg-red-950 text-red-300'
        }`}
        >
          {diff === 0
            ? 'Coincide con lo dejado'
            : diff > 0
              ? `Encontró de más: ${fmt(diff)}`
              : `Encontró de menos: ${fmt(Math.abs(diff))}`}
        </p>
      )}
    </div>
  )
}
