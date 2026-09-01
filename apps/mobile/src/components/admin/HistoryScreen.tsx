/**
 * Historial completo de turnos: ventas + gastos por turno.
 * Extiende la funcionalidad del antiguo ShiftDetailView en AdminDashboard
 * con filtros de fecha y la sección de gastos.
 */
import { useState, useEffect, useCallback } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import { useBackLayer } from '../../lib/backStack'
import { ScreenHeader, OfflineBanner, ErrorBanner, Spinner, EmptyState, StoreSelector } from './shared'
import {
  fetchAdminShifts,
  fetchAdminSalesForShift,
  fetchDebtsForShift,
  fetchDepositsForShift,
  fetchValesForShift,
  sumPaymentTotals,
  type AdminShift,
  type AdminSale,
  type AdminShiftDebt,
  type AdminShiftDeposit,
  type AdminVale,
  type PaymentTotals,
} from '../../lib/adminHistory'
import {
  fetchExpensesForShift,
  formatMoney,
  type Expense,
  type StoreDoc,
} from '../../lib/adminFirestore'
import { expenseNote, expenseTitle } from '../../lib/adminLedger'
import { formatDepositPaymentsLine } from '../../lib/orderMapping'
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
  useBackLayer(true, onBack)
  const [storeId, setStoreId] = useState<string>('')
  const [shifts, setShifts] = useState<AdminShift[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedShift, setSelectedShift] = useState<AdminShift | null>(null)

  const loadShifts = useCallback(async (sid: string) => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchAdminShifts(sid || undefined)
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
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader title="Historial" onBack={onBack} />

      {!online && <OfflineBanner />}

      <StoreSelector
        stores={activeStores}
        value={storeId}
        onChange={id => { setStoreId(id); setSelectedShift(null) }}
        allowAll
      />

      {/* Date filters */}
      <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-800 px-4 py-2">
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
        {!loading && !error && filteredShifts.length === 0 && (
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
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-left hover:border-zinc-500 transition-colors"
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
                    {shift.source === 'mobile' && (
                      <span className="shrink-0 rounded-full border border-sky-800/60 bg-sky-950/40 px-2 py-0.5 text-xs text-sky-300">
                        Móvil
                      </span>
                    )}
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
  useBackLayer(true, onBack)
  const [sales, setSales] = useState<AdminSale[]>([])
  const [totals, setTotals] = useState<PaymentTotals>(sumPaymentTotals([]))
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [debts, setDebts] = useState<AdminShiftDebt[]>([])
  const [deposits, setDeposits] = useState<AdminShiftDeposit[]>([])
  const [vales, setVales] = useState<AdminVale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'sales' | 'expenses' | 'debts' | 'deposits' | 'vales'>('sales')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const salesList = await fetchAdminSalesForShift(shift.id)
      const saleIds = salesList.map(s => s.id)
      const [expensesList, debtsList, depositsList, valesList] = await Promise.all([
        fetchExpensesForShift(shift.id),
        fetchDebtsForShift(shift.id, saleIds),
        fetchDepositsForShift(shift.id),
        fetchValesForShift(shift.id),
      ])
      const confirmed = salesList.filter(s => s.status === 'confirmed')
      setSales(confirmed)
      setTotals(sumPaymentTotals(salesList))
      setExpenses(expensesList)
      setDebts(debtsList)
      setDeposits(depositsList)
      setVales(valesList)
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
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title={shift.cashierName}
        subtitle={`${shift.shiftType === 'morning' ? 'Mañana' : 'Tarde'} · ${formatDateTime(shift.startedAt)}${shift.closedAt ? ` → ${formatDateTime(shift.closedAt)}` : ' · abierto'}`}
        onBack={onBack}
      />
      {!online && <OfflineBanner />}

      <main className="flex-1 px-4 py-4 space-y-4">
        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading && <Spinner />}

        {!loading && !error && (
          <>
            {/* Summary card */}
            <section className="rounded-xl border border-zinc-700 bg-zinc-800 p-4">
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
            <div className="flex gap-1 overflow-x-auto">
              {(
                [
                  { key: 'sales' as const, label: `Ventas (${sales.length})` },
                  { key: 'expenses' as const, label: `Gastos (${expenses.length})` },
                  { key: 'debts' as const, label: `Fiados (${debts.length})` },
                  { key: 'deposits' as const, label: `Señas (${deposits.length})` },
                  { key: 'vales' as const, label: `Vales (${vales.length})` },
                ]
              ).map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    tab === t.key ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
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
                            className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3"
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
                    {expenses.map(exp => {
                      const title = expenseTitle(exp)
                      const note = expenseNote(exp)
                      return (
                        <li
                          key={exp.id}
                            className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100"
                              title={title}
                            >
                              {title}
                            </span>
                            <span className="shrink-0 font-mono font-semibold text-red-400/80">
                              -{formatMoney(exp.amount)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-500" title={note ?? undefined}>
                            {formatDateTime(exp.createdAt)}
                            {note ? ` · ${note}` : ''}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}

            {tab === 'debts' && (
              <section>
                {debts.length === 0 ? (
                  <EmptyState message="Sin fiados en este turno." />
                ) : (
                  <ul className="space-y-2">
                    {debts.map(debt => (
                      <li
                        key={debt.id}
                            className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100"
                            title={debt.customerName}
                          >
                            {debt.customerName}
                          </span>
                          <span className="shrink-0 font-mono font-semibold text-zinc-100">
                            {formatMoney(debt.amount)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-zinc-500" title={debt.notes ?? undefined}>
                          {formatDateTime(debt.createdAt)}
                          {debt.notes ? ` · ${debt.notes}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {tab === 'deposits' && (
              <section>
                {deposits.length === 0 ? (
                  <EmptyState message="Sin señas en este turno." />
                ) : (
                  <ul className="space-y-2">
                    {deposits.map(dep => {
                      const breakdown = formatDepositPaymentsLine(dep.depositPayments, {
                        fallbackMethod: dep.depositMethod,
                        fallbackAmount: dep.depositAmount,
                        formatAmount: formatMoney,
                      })
                      return (
                        <li
                          key={dep.id}
                            className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100"
                              title={dep.customerName}
                            >
                              {dep.customerName}
                            </span>
                            <span className="shrink-0 font-mono font-semibold text-zinc-100">
                              {formatMoney(dep.depositAmount)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-500" title={dep.items}>
                            {formatDateTime(dep.createdAt)}
                            {dep.items ? ` · ${dep.items}` : ''}
                          </p>
                          {breakdown && (
                            <p className="mt-0.5 truncate text-xs text-zinc-400" title={breakdown}>
                              {breakdown}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}

            {tab === 'vales' && (
              <section>
                {vales.length === 0 ? (
                  <EmptyState message="Sin vales en este turno." />
                ) : (
                  <ul className="space-y-2">
                    {vales.map(vale => {
                      const detail = vale.items.length > 0
                        ? vale.items.map(i => i.productName).join(', ')
                        : vale.description
                      return (
                        <li
                          key={vale.id}
                            className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100"
                              title={vale.employeeName}
                            >
                              {vale.employeeName}
                            </span>
                            <span
                              className={`shrink-0 font-mono font-semibold ${
                                vale.cancelledAt ? 'text-zinc-500 line-through' : 'text-zinc-100'
                              }`}
                            >
                              {formatMoney(vale.amount)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-500" title={detail ?? undefined}>
                            {formatDateTime(vale.createdAt)}
                            {detail ? ` · ${detail}` : ' · Adelanto en efectivo'}
                          </p>
                          {vale.cancelledAt && (
                            <p className="mt-0.5 text-[10px] text-red-400/80">Anulado</p>
                          )}
                        </li>
                      )
                    })}
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
