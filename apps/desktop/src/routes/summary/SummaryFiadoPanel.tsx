import type { CustomerHistoryMove } from '@carniceria/shared'
import { formatARS } from '../../lib/datetime'
import { MoneyRow } from './SummaryMoney'

function historyMoveLabel(eventType: string): string {
  if (eventType === 'created' || eventType === 'debt') return 'Deuda registrada'
  if (eventType === 'partial_payment') return 'Pago parcial'
  if (eventType === 'paid') return 'Pago total'
  if (eventType === 'cancelled') return 'Deuda cancelada'
  if (eventType === 'reopened') return 'Deuda reabierta'
  return 'Movimiento'
}

function historyMoveWhen(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SummaryFiadoPanel({
  previewOn,
  periodLoading,
  onLoadPeriod,
  periodError,
  newDebt,
  collections,
  periodIncomplete,
  note,
  debtNow,
  showCustomers,
  customerError,
  customersListed,
  customers,
  storeId,
  storeName,
  openCustomerId,
  histories,
  onToggleCustomer,
  onLoadMore,
}: {
  previewOn: boolean
  periodLoading: boolean
  onLoadPeriod: () => void
  periodError: string | null
  newDebt: number | null
  collections: number | null
  periodIncomplete: boolean
  note: string | null
  debtNow: number | null
  showCustomers: boolean
  customerError: string | null
  customersListed: boolean
  customers: Array<{ id: string; name: string; storeId: string }>
  storeId: string
  storeName: (id: string) => string
  openCustomerId: string | null
  histories: Record<string, {
    moves: CustomerHistoryMove[]
    hasMore: boolean
    loading: boolean
    error: string | null
  }>
  onToggleCustomer: (row: { id: string; storeId: string }) => void
  onLoadMore: (row: { id: string; storeId: string }) => void
}) {
  return (
    <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <section className="min-w-0 space-y-2 rounded-xl border border-line bg-panel p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">Fiados y cobranzas</h2>
          {!previewOn && (
            <button
              type="button"
              onClick={onLoadPeriod}
              disabled={periodLoading}
              className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
            >
              {periodLoading ? 'Leyendo…' : 'Ver fiado del período'}
            </button>
          )}
        </div>
        {periodError && (
          <p className="min-w-0 truncate text-sm text-danger" title={periodError}>{periodError}</p>
        )}
        <div className="mt-3 border-t border-line">
          <div className="border-b border-line py-2">
            <MoneyRow
              label="Fiado nuevo"
              amount={newDebt}
              empty={periodIncomplete ? 'incompleta' : 'todavía no llegó'}
            />
          </div>
          <div className="border-b border-line py-2">
            <MoneyRow
              label="Cobros del período"
              amount={collections}
              empty={periodIncomplete ? 'incompleta' : 'pendiente'}
            />
          </div>
          {note && <p className="border-b border-line py-2 text-sm text-ink">{note}</p>}
          <div className="border-b border-line py-2">
            <MoneyRow label="Deuda de ahora" amount={debtNow} empty="pendiente" />
          </div>
        </div>
      </section>
      {showCustomers && (
        <section className="min-w-0 space-y-2 rounded-xl border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold text-ink">Clientes</h2>
          {customerError && (
            <p className="min-w-0 truncate text-sm text-danger" title={customerError}>{customerError}</p>
          )}
          {customersListed && customers.length === 0 && !customerError && (
            <p className="text-sm text-muted">No hay clientes en este local.</p>
          )}
          <ul className="space-y-2">
            {customers.map(row => {
              const history = histories[row.id]
              const open = openCustomerId === row.id
              const who = storeId === 'all'
                ? `${row.name} · ${storeName(row.storeId)}`
                : row.name
              return (
                <li key={row.id} className="min-w-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={open ? `Ocultar historial de ${row.name}` : `Ver historial de ${row.name}`}
                    onClick={() => onToggleCustomer(row)}
                    className="flex w-full min-w-0 items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink" title={who}>{who}</span>
                  </button>
                  {open && (
                    <div className="mt-1 space-y-1">
                      {history?.error && (
                        <p className="min-w-0 truncate text-sm text-danger" title={history.error}>{history.error}</p>
                      )}
                      {history && history.moves.length === 0 && !history.loading && !history.error && (
                        <p className="text-sm text-muted">No hay movimientos.</p>
                      )}
                      <ul className="space-y-1">
                        {(history?.moves ?? []).map(move => {
                          const label = historyMoveLabel(move.eventType)
                          const when = historyMoveWhen(move.createdAt)
                          const line = [label, formatARS(move.amount), when].filter(Boolean).join(' · ')
                          return (
                            <li key={move.id} className="flex min-w-0 items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={line}>{line}</span>
                            </li>
                          )
                        })}
                      </ul>
                      {history?.hasMore && (
                        <button
                          type="button"
                          onClick={() => onLoadMore(row)}
                          disabled={history.loading}
                          className="rounded-lg border border-line px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
                        >
                          {history.loading ? 'Leyendo…' : 'Ver más'}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
