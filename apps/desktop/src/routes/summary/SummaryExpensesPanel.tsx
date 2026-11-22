import { type ExpenseRow, type ExpenseSummaryView } from '@carniceria/shared'
import { CollapseReveal, cx } from '../../components/ui'
import { formatARS } from '../../lib/datetime'

const EXPENSE_COLS = 'grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_9.25rem_7.5rem_minmax(0,0.9fr)_minmax(4.5rem,0.7fr)]'
const EXPENSE_COLS_ONE_STORE = 'grid-cols-[minmax(0,1.8fr)_minmax(0,1.15fr)_9.25rem_7.5rem_minmax(0,1fr)]'
const EXPENSE_AMOUNT_COL = 'grid-cols-[minmax(0,1fr)_9.25rem]'

function expenseDayLabel(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
}

function expenseDays(rows: ExpenseRow[]): { ymd: string; rows: ExpenseRow[] }[] {
  const days: { ymd: string; rows: ExpenseRow[] }[] = []
  for (const row of rows) {
    const last = days[days.length - 1]
    if (!last || last.ymd !== row.ymd) days.push({ ymd: row.ymd, rows: [row] })
    else last.rows.push(row)
  }
  return days
}

function ExpenseChronological({ rows, showStore }: { rows: ExpenseRow[]; showStore: boolean }) {
  const cols = showStore ? EXPENSE_COLS : EXPENSE_COLS_ONE_STORE
  return (
    <div className={cx('grid gap-x-3', cols)} role="table">
      <div className={cx('col-span-full grid grid-cols-subgrid items-end px-1 pb-1 text-xs font-medium text-muted')} role="row">
        <span>Concepto</span>
        <span>Proveedor</span>
        <span className="text-right">Monto</span>
        <span>Origen</span>
        <span>Nota</span>
        {showStore && <span>Local</span>}
      </div>
      {expenseDays(rows).map(day => (
        <div key={day.ymd} className="col-span-full grid grid-cols-subgrid">
          <p className="col-span-full border-t border-line px-1 pb-1 pt-2 text-xs font-medium tabular-nums text-muted">
            {expenseDayLabel(day.ymd)}
          </p>
          {day.rows.map(row => {
            const note = row.notes ?? ''
            return (
              <div
                key={row.id}
                role="row"
                className="col-span-full grid grid-cols-subgrid items-center border-t border-line px-1 py-1.5"
              >
                <span className="min-w-0 truncate text-sm text-ink" title={row.concept}>{row.concept}</span>
                <span className="min-w-0 truncate text-sm text-muted" title={row.providerName}>{row.providerName}</span>
                <span className="whitespace-nowrap text-right text-sm tabular-nums text-ink">{formatARS(row.amount)}</span>
                <span className="min-w-0 truncate text-sm text-ink" title={row.origin}>{row.origin}</span>
                <span className="min-w-0 truncate text-sm text-muted" title={note}>{note}</span>
                {showStore && (
                  <span className="min-w-0 truncate text-sm text-muted" title={row.storeName}>{row.storeName}</span>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ExpenseAmountList({
  title,
  rows,
}: {
  title: string
  rows: { key: string; label: string; amount: number }[]
}) {
  return (
    <div>
      <p className="mb-1 px-1 text-xs font-medium text-muted">{title}</p>
      <ul className={cx('grid gap-x-3', EXPENSE_AMOUNT_COL)}>
        {rows.map(row => (
          <li key={row.key} className="col-span-2 grid grid-cols-subgrid items-baseline border-t border-line px-1 py-1.5">
            <span className="min-w-0 truncate text-sm text-ink" title={row.label}>{row.label}</span>
            <span className="whitespace-nowrap text-right text-sm tabular-nums text-ink">{formatARS(row.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ExpenseGrouped({ view }: { view: ExpenseSummaryView }) {
  return (
    <div className="space-y-4">
      <ExpenseAmountList
        title="Por origen"
        rows={view.byOrigin.map(item => ({ key: item.origin, label: item.origin, amount: item.amount }))}
      />
      <ExpenseAmountList title="Por proveedor" rows={view.byProvider} />
      <ExpenseAmountList title="Por concepto" rows={view.byConcept} />
    </div>
  )
}

export function SummaryExpensesPanel({
  tally,
  open,
  view,
  onView,
  onToggle,
  loading,
  canOpen,
  error,
  detail,
  showStore,
}: {
  tally: string | null
  open: boolean
  view: 'fecha' | 'grupo'
  onView: (view: 'fecha' | 'grupo') => void
  onToggle: () => void
  loading: boolean
  canOpen: boolean
  error: string | null
  detail: ExpenseSummaryView
  showStore: boolean
}) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">Detalle de gastos</h2>
          {tally && (
            <p className="mt-0.5 truncate text-xs tabular-nums text-muted" title={tally}>{tally}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {open && (
            <>
              <button
                type="button"
                onClick={() => onView('fecha')}
                className={`rounded-lg px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${view === 'fecha' ? 'bg-hover text-ink' : 'text-muted'}`}
              >
                Por fecha
              </button>
              <button
                type="button"
                onClick={() => onView('grupo')}
                className={`rounded-lg px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${view === 'grupo' ? 'bg-hover text-ink' : 'text-muted'}`}
              >
                Agrupado
              </button>
            </>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            disabled={!canOpen}
            className="rounded-lg border border-line px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            {open ? 'Ocultar detalle' : 'Ver detalle de gastos'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 min-w-0 truncate text-sm text-danger" title={error}>{error}</p>
      )}
      {detail.gap && (
        <p className="mt-3 min-w-0 truncate text-sm text-muted" title={`${formatARS(detail.gap.difference)}. ${detail.gap.cause}`}>
          {`Diferencia ${formatARS(detail.gap.difference)}. ${detail.gap.cause}`}
        </p>
      )}
      <CollapseReveal open={open} className="pt-3">
        {loading && <p className="text-sm text-muted">Leyendo gastos…</p>}
        {detail.rows.length === 0 ? (
          detail.gap ? null : <p className="text-sm text-muted">No hay gastos en este período.</p>
        ) : view === 'fecha' ? (
          <ExpenseChronological rows={detail.rows} showStore={showStore} />
        ) : (
          <ExpenseGrouped view={detail} />
        )}
      </CollapseReveal>
    </section>
  )
}
