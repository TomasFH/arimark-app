/**
 * Historial completo de turnos: ventas + gastos por turno.
 * Extiende la funcionalidad del antiguo ShiftDetailView en AdminDashboard
 * con filtros de fecha y la sección de gastos.
 */
import { useState, useEffect, useCallback } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import { ScreenHeader, OfflineBanner, ErrorBanner, Spinner, EmptyState, StoreSelector } from './shared'
import {
  fetchAdminShifts,
  fetchAdminSalesForShift,
  sumPaymentTotals,
  type AdminShift,
  type AdminSale,
  type PaymentTotals,
} from '../../lib/adminHistory'
import {
  fetchExpensesForShift,
  formatMoney,
  formatDate,
  type Expense,
  type StoreDoc,
} from '../../lib/adminFirestore'
import type { PaymentMethod } from '../../types/pos'

interface Props {
  onBack: () => void
  stores: StoreDoc[]
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera',
  credit: 'Crédito',
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso ?? '—'
  }
}

export function HistoryScreen({ onBack, stores }: Props) {
  const online = useOnlineStatus()
  const activeStores = stores.filter(s => !s.archivedAt)
  const [storeId, setStoreId] = useState<string>(() => activeStores[0]?.id ?? '')
  const [shifts, setShifts] = useState<AdminShift[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedShift, setSelectedShift] = useState<AdminShift | null>(null)

  const loadShifts = useCallback(async (sid: string) => {
    if (!sid) {
      setShifts([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await fetchAdminShifts(sid)
      setShifts(list)
    } catch {
      setError('No se pudieron cargar los turnos.')
      setShifts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadShifts(storeId)
  }, [storeId, loadShifts])

  if (selectedShift) {
    return (
      <ShiftDetailScreen
        shift={selectedShift}
        online={online}
        onBack={() => setSelectedShift(null)}
      />
    )
  }

  const filteredShifts = shifts.filter(s => {
    if (dateFrom && s.startedAt < dateFrom) return false
    if (dateTo && s.startedAt > dateTo + 'T23:59:59') return false
    return true
  })

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader title="Historial" onBack={onBack} />

      {!online && <OfflineBanner />}

      <StoreSelector
        stores={activeStores}
        value={storeId}
        onChange={id => { setStoreId(id); setSelectedShift(null) }}
      />

      {/* Date filters */}
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2">
        <label className="flex flex-1 flex-col">
          <span className="mb-0.5 text-xs text-zinc-500">Desde</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
          />
        </label>
        <label className="flex flex-1 flex-col">
          <span className="mb-0.5 text-xs text-zinc-500">Hasta</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => { setDateFrom(''); setDateTo('') }}
            className="shrink-0 text-xs text-zinc-500 underline self-end pb-1"
          >
            Limpiar
          </button>
        )}
      </div>

      <main className="flex-1 px-4 py-4">
        {error && <ErrorBanner message={error} onRetry={() => void loadShifts(storeId)} />}
        {loading && <Spinner />}
        {!storeId && !loading && (
          <EmptyState message="Seleccioná un local para ver los turnos." />
        )}
        {storeId && !loading && !error && filteredShifts.length === 0 && (
          <EmptyState
            message={
              dateFrom || dateTo
                ? 'Sin turnos en el período seleccionado.'
                : 'No hay turnos sincronizados.'
            }
          />
        )}
        {!loading && !error && filteredShifts.length > 0 && (
          <ul className="space-y-2">
            {filteredShifts.map(shift => (
              <li key={shift.id}>
                <button
                  type="button"
                  onClick={() => setSelectedShift(shift)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="min-w-0 flex-1 truncate font-medium text-zinc-100"
                      title={shift.cashierName}
                    >
                      {shift.cashierName}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        shift.closedAt
                          ? 'bg-zinc-700 text-zinc-300 border border-zinc-600'
                          : 'bg-emerald-950/50 text-emerald-400/70 border border-emerald-900/40'
                      }`}
                    >
                      {shift.closedAt ? 'Cerrado' : 'Abierto'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">
                    {shift.shiftType === 'morning' ? 'Mañana' : 'Tarde'}
                    {' · '}{formatDateTime(shift.startedAt)}
                    {shift.closedAt ? ` → ${formatDateTime(shift.closedAt)}` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shift detail screen (sales + expenses)
// ---------------------------------------------------------------------------

interface ShiftDetailScreenProps {
  shift: AdminShift
  online: boolean
  onBack: () => void
}

function ShiftDetailScreen({ shift, online, onBack }: ShiftDetailScreenProps) {
  const [sales, setSales] = useState<AdminSale[]>([])
  const [totals, setTotals] = useState<PaymentTotals>(sumPaymentTotals([]))
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'sales' | 'expenses'>('sales')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [salesList, expensesList] = await Promise.all([
        fetchAdminSalesForShift(shift.id),
        fetchExpensesForShift(shift.id),
      ])
      const confirmed = salesList.filter(s => s.status === 'confirmed')
      setSales(confirmed)
      setTotals(sumPaymentTotals(salesList))
      setExpenses(expensesList)
    } catch {
      setError('No se pudieron cargar los datos del turno.')
    } finally {
      setLoading(false)
    }
  }, [shift.id])

  useEffect(() => {
    void load()
  }, [load])

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const netBalance = totals.total - totalExpenses

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-base font-semibold text-zinc-100"
              title={shift.cashierName}
            >
              {shift.cashierName}
            </h1>
            <p className="text-xs text-zinc-500">
              {shift.shiftType === 'morning' ? 'Mañana' : 'Tarde'}
              {' · '}{formatDateTime(shift.startedAt)}
              {shift.closedAt ? ` → ${formatDateTime(shift.closedAt)}` : ' · abierto'}
            </p>
          </div>
        </div>
        {!online && (
          <p className="mt-1.5 text-xs text-amber-400/80">Sin conexión</p>
        )}
      </header>

      <main className="flex-1 px-4 py-4 space-y-4">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}

        {!loading && !error && (
          <>
            {/* Summary card */}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">Resumen del turno</h2>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="text-xs text-zinc-500 underline"
                >
                  Actualizar
                </button>
              </div>
              <dl className="space-y-1.5 text-sm">
                {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map(method => (
                  <div
                    key={method}
                    className="flex items-center justify-between gap-2"
                  >
                    <dt className="text-zinc-400">{METHOD_LABEL[method]}</dt>
                    <dd className="font-mono font-medium text-zinc-100">
                      {formatMoney(totals[method])}
                    </dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-1.5">
                  <dt className="font-semibold text-zinc-100">Total ventas</dt>
                  <dd className="font-mono font-bold text-zinc-100">{formatMoney(totals.total)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-zinc-400">Gastos</dt>
                  <dd className="font-mono font-medium text-red-400/80">
                    -{formatMoney(totalExpenses)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-1.5">
                  <dt className="font-semibold text-zinc-100">Neto</dt>
                  <dd
                    className={`font-mono font-bold ${
                      netBalance >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatMoney(netBalance)}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Tab selector */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab('sales')}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  tab === 'sales' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400'
                }`}
              >
                Ventas ({sales.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('expenses')}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  tab === 'expenses' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400'
                }`}
              >
                Gastos ({expenses.length})
              </button>
            </div>

            {/* Sales list */}
            {tab === 'sales' && (
              <section>
                {sales.length === 0 ? (
                  <EmptyState message="Sin ventas confirmadas en este turno." />
                ) : (
                  <ul className="space-y-2">
                    {sales.map(sale => {
                      const methods = [
                        ...new Set(sale.payments.map(p => METHOD_LABEL[p.paymentMethod])),
                      ]
                      const itemNames = sale.items.map(i => i.productName).join(', ')
                      return (
                        <li
                          key={sale.id}
                          className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="min-w-0 flex-1 truncate text-sm text-zinc-300"
                              title={itemNames}
                            >
                              {itemNames || 'Venta'}
                            </span>
                            <span className="shrink-0 font-mono font-semibold text-zinc-100">
                              {formatMoney(sale.total)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-500" title={methods.join(' · ')}>
                            {formatDateTime(sale.createdAt)}
                            {methods.length > 0 ? ` · ${methods.join(' · ')}` : ''}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* Expenses list */}
            {tab === 'expenses' && (
              <section>
                {expenses.length === 0 ? (
                  <EmptyState message="Sin gastos registrados en este turno." />
                ) : (
                  <ul className="space-y-2">
                    {expenses.map(exp => (
                      <li
                        key={exp.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="min-w-0 flex-1 truncate text-sm text-zinc-300"
                            title={exp.description ?? exp.category}
                          >
                            {exp.description ?? exp.category}
                          </span>
                          <span className="shrink-0 font-mono font-semibold text-red-400/80">
                            -{formatMoney(exp.amount)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 min-w-0 text-xs text-zinc-500">
                          <span className="shrink-0">{formatDate(exp.createdAt)}</span>
                          <span
                            className="min-w-0 truncate"
                            title={[exp.category, exp.providerName].filter(Boolean).join(' · ')}
                          >
                            {exp.category}
                            {exp.providerName ? ` · ${exp.providerName}` : ''}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
