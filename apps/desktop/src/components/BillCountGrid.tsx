import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { BillMode, BillRowState } from '../lib/billCountUi'
import { formatBillDenomination } from '@carniceria/shared'

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
  /** 1 en el cierre. 2 solo al abrir turno, para bajar la altura del conteo. */
  columns?: 1 | 2
  className?: string
}

export default function BillCountGrid({
  rows,
  mode,
  onModeChange,
  onUpdate,
  countedTotal,
  expectedTotal,
  showExpectedDiff = false,
  title = 'Conteo de billetes',
  subtitle,
  columns = 1,
  className,
}: Props) {
  const diff = expectedTotal != null ? countedTotal - expectedTotal : 0
  const twoColumns = columns === 2

  return (
    <div className={`bg-raised rounded-xl border border-line ${twoColumns ? 'space-y-3 p-4' : 'space-y-4 p-5'}${className ? ` ${className}` : ''}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className={twoColumns ? 'min-w-0 flex-1' : 'min-w-0'}>
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">{title}</h2>
          {subtitle && (
            <p className={twoColumns ? 'mt-0.5 truncate text-xs text-muted' : 'text-xs text-muted mt-0.5'} title={subtitle}>{subtitle}</p>
          )}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-line-strong text-xs shrink-0">
          <button
            type="button"
            onClick={() => onModeChange('quantity')}
            className={`px-3 py-1.5 transition-colors ${
              mode === 'quantity'
                ? 'bg-input text-white'
                : 'bg-app text-muted hover:bg-hover'
            }`}
          >
            Por cantidad
          </button>
          <button
            type="button"
            onClick={() => onModeChange('total')}
            className={`px-3 py-1.5 transition-colors ${
              mode === 'total'
                ? 'bg-input text-white'
                : 'bg-app text-muted hover:bg-hover'
            }`}
          >
            Por monto
          </button>
        </div>
      </div>

      <p className="text-[11px] text-subtle">
        {mode === 'quantity'
          ? 'Ingresá cuántos billetes de cada tipo hay en la registradora.'
          : 'Ingresá el monto total por denominación. Debe ser múltiplo de la denominación.'}
      </p>

      <div
        data-bill-columns={columns}
        className={twoColumns ? 'grid grid-cols-2 gap-x-3 gap-y-1.5' : 'grid grid-cols-1 gap-1.5'}
      >
        {rows.map(row => {
          const lineValue = mode === 'quantity'
            ? (parseNumericInput(row.quantity) ?? 0) * row.denomination
            : (parseNumericInput(row.total) ?? 0)
          const lineLabel = lineValue > 0 ? fmt(lineValue) : ''

          return (
            <div key={row.denomination} className={twoColumns ? 'min-w-0 space-y-0.5' : 'space-y-0.5'}>
              <div className={twoColumns ? 'flex min-w-0 items-center gap-1' : 'flex items-center gap-2 min-w-0'}>
                <span className={twoColumns
                  ? 'w-20 shrink-0 whitespace-nowrap text-right text-sm font-medium tabular-nums text-ink'
                  : 'w-24 text-sm text-ink font-medium text-right shrink-0'}
                >
                  {formatBillDenomination(row.denomination)}
                </span>
                {mode === 'quantity' ? (
                  <>
                    <span className={twoColumns ? 'shrink-0 text-xs text-muted' : 'text-xs text-muted'}>×</span>
                    <NumericInput
                      value={row.quantity}
                      onChange={v => onUpdate(row.denomination, 'quantity', v)}
                      placeholder="0"
                      className={twoColumns
                        ? 'w-16 shrink-0 rounded-lg border border-line-strong bg-app px-2 py-1.5 text-center text-sm text-white placeholder:text-muted focus:border-line-accent focus:outline-none'
                        : 'w-20 rounded-lg border border-line-strong bg-app px-2 py-1.5 text-sm text-white placeholder:text-muted focus:outline-none focus:border-line-accent text-center'}
                    />
                    <span className="text-xs text-muted min-w-0 flex-1 text-right truncate" title={lineLabel || undefined}>
                      {lineLabel}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={twoColumns ? 'shrink-0 text-xs text-muted' : 'text-xs text-muted'}>=</span>
                    <NumericInput
                      value={row.total}
                      onChange={v => onUpdate(row.denomination, 'total', v)}
                      placeholder="0"
                      className={`${twoColumns ? 'min-w-0 flex-1' : 'flex-1'} rounded-lg border bg-app px-2 py-1.5 text-sm text-white placeholder:text-muted focus:outline-none ${
                        row.totalError ? 'border-red-500 focus:border-red-400' : 'border-line-strong focus:border-line-accent'
                      }`}
                    />
                  </>
                )}
              </div>
              {row.totalError && (
                <p className={`text-xs text-red-400 ${twoColumns ? 'pl-20' : 'pl-[6.5rem]'}`}>{row.totalError}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="pt-2 border-t border-line space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Total contado en caja</span>
          <span className="font-semibold text-white">{fmt(countedTotal)}</span>
        </div>
        {showExpectedDiff && expectedTotal != null && (
          <div className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
            diff === 0
              ? 'bg-success/15 text-success'
              : diff > 0
                ? 'bg-blue-900/40 text-blue-300'
                : 'bg-red-900/40 text-red-300'
          }`}
          >
            {diff === 0
              ? '✓ Caja cuadrada'
              : diff > 0
                ? `▲ Sobrante: ${fmt(diff)} (hay más efectivo del esperado en caja)`
                : `▼ Faltante: ${fmt(Math.abs(diff))} (hay menos efectivo del esperado en caja)`}
          </div>
        )}
      </div>
    </div>
  )
}
