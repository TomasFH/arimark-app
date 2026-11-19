/**
 * Torta y barras del resumen. Mismos números que el texto, tokens ya existentes.
 */
import { donutSlices, saleSplitSlices, type SoldDayBar } from '@carniceria/shared'
import { formatARS } from '../lib/datetime'

const SLICE_COLOR = {
  cash: 'var(--pay-cash)',
  card: 'var(--pay-debit)',
} as const

export function SaleSplitChart({
  cash,
  card,
  pending,
}: {
  cash: number
  card: number
  pending: boolean
}) {
  const slices = saleSplitSlices(pending ? 0 : cash, pending ? 0 : card)
  const paths = donutSlices(slices.map(slice => slice.fraction))
  const any = !pending && slices.some(slice => slice.amount > 0)
  return (
    <figure className="flex min-w-0 items-center gap-4">
      <svg viewBox="-48 -48 96 96" className="summary-pie h-28 w-28 shrink-0" role="img" aria-label="Efectivo y tarjeta">
        {!any && <circle r="32" fill="none" stroke="var(--border)" strokeWidth="16" />}
        {slices.map((slice, index) => {
          const path = paths[index]
          if (!path) return null
          return <path key={slice.key} d={path} fill={SLICE_COLOR[slice.key]} />
        })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map(slice => (
          <li key={slice.key} className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SLICE_COLOR[slice.key] }} />
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={slice.label}>{slice.label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {pending ? 'todavía no llegó' : formatARS(slice.amount)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function SoldDayBars({ bars, caption = 'Vendido por día' }: { bars: SoldDayBar[]; caption?: string }) {
  const known = bars.flatMap(bar => (bar.amount != null && bar.amount > 0 ? [bar.amount] : []))
  const max = Math.max(1, ...known)
  const wide = bars.length > 10
  return (
    <div className={wide ? 'overflow-x-auto pb-1' : undefined}>
      <div
        className="flex h-36 items-end gap-1"
        style={wide ? { minWidth: `${bars.length * 2.25}rem` } : undefined}
        role="img"
        aria-label={caption}
      >
        {bars.map((bar, index) => {
          const missing = bar.amount == null
          const title = missing
            ? `${bar.label}: todavía no llegó`
            : `${bar.label}: ${formatARS(bar.amount ?? 0)}`
          const height = missing
            ? 8
            : bar.amount === 0
              ? 2
              : Math.max(8, Math.round(((bar.amount ?? 0) / max) * 104))
          return (
            <div key={bar.ymd} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={title}>
              <div className="flex h-28 w-full items-end justify-center">
                <div
                  className={missing
                    ? 'w-full rounded-sm border border-dashed border-line'
                    : bar.amount === 0
                      ? 'w-full rounded-sm bg-accent'
                      : 'summary-bar w-full rounded-sm bg-accent'}
                  style={{
                    height: `${height}px`,
                    animationDelay: missing || bar.amount === 0 ? undefined : `${index * 18}ms`,
                  }}
                />
              </div>
              <span className="w-full truncate text-center text-[10px] font-medium text-muted">{bar.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
