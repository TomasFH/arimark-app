import { cx } from '../../components/ui'
import { formatARS } from '../../lib/datetime'

export function MoneyRow({
  label,
  amount,
  empty = 'todavía no llegó',
  valueClassName,
}: {
  label: string
  amount: number | null
  empty?: string
  valueClassName?: string
}) {
  const text = amount == null ? empty : formatARS(amount)
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-ink" title={label}>{label}</span>
      <span className={cx('shrink-0 font-semibold tabular-nums text-ink', valueClassName ?? 'text-sm')} title={text}>{text}</span>
    </div>
  )
}
