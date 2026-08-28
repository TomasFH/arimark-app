/**
 * Liquidación semanal (admin móvil): consulta + archivo de pagos.
 * Semana actual: onSnapshot recortado. Semanas ya vistas: caché en memoria (sin reconsultar).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOnlineStatus } from '../../lib/connectivity'
import { useBackLayer } from '../../lib/backStack'
import {
  ScreenHeader,
  OfflineBanner,
  ErrorBanner,
  Spinner,
  EmptyState,
} from './shared'
import { fetchEmployees, formatMoney, formatDateTime, type Employee } from '../../lib/adminFirestore'
import {
  subscribeValesInPaidAtRange,
  subscribeSalaryPaymentsForWeek,
  fetchValesInPaidAtRange,
  fetchSalaryPaymentsForWeek,
} from '../../lib/adminPayroll'
import { buildWeeklyPayroll, mergePayrollWithPayments, type PayrollPayment, type PayrollVale } from '../../lib/payroll'
import {
  getPayrollWeekCache,
  invalidatePayrollWeekCache,
  setPayrollWeekCache,
  weekQueryPlan,
  resolveWeekView,
} from '../../lib/payrollWeekCache'
import {
  addDaysYmd,
  firestorePaidAtBounds,
  formatYmd,
  weekStartMondayLocalYmd,
} from '../../lib/week'

interface Props {
  onBack: () => void
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function PayrollScreen({ onBack }: Props) {
  useBackLayer(true, onBack)
  const online = useOnlineStatus()
  const currentWeekStart = weekStartMondayLocalYmd()
  const [weekStart, setWeekStart] = useState(currentWeekStart)
  const weekEnd = addDaysYmd(weekStart, 6)
  const weekLabel = `${formatYmd(weekStart)} – ${formatYmd(weekEnd)}`
  const bounds = firestorePaidAtBounds(weekStart, weekEnd)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [vales, setVales] = useState<PayrollVale[]>([])
  const [payments, setPayments] = useState<PayrollPayment[]>([])
  /** Semana a la que pertenecen `vales`/`payments` en estado. Evita pintar la semana nueva con datos viejos. */
  const [dataWeekStart, setDataWeekStart] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const loadEmployees = useCallback(async () => {
    const list = await fetchEmployees()
    setEmployees(list)
  }, [])

  useEffect(() => {
    void loadEmployees().catch(() => {
      setError('No se pudieron cargar los empleados.')
      setLoading(false)
    })
  }, [loadEmployees, reloadKey])

  useEffect(() => {
    let cancelled = false
    let unsubVales: (() => void) | undefined
    let unsubPay: (() => void) | undefined
    const cached = getPayrollWeekCache(weekStart)
    const plan = weekQueryPlan(weekStart, currentWeekStart, Boolean(cached), false)

    function remember(nextVales: PayrollVale[], nextPayments: PayrollPayment[]): void {
      setPayrollWeekCache({ weekStart, vales: nextVales, payments: nextPayments })
      setVales(nextVales)
      setPayments(nextPayments)
      setDataWeekStart(weekStart)
    }

    if (plan === 'cache-only' && cached) {
      remember(cached.vales, cached.payments)
      setLoading(false)
      setError(null)
      return
    }

    if (plan === 'cache-then-live' && cached) {
      remember(cached.vales, cached.payments)
      setLoading(false)
      setError(null)
    } else {
      setLoading(true)
      setError(null)
    }

    if (plan === 'fetch-once') {
      void Promise.all([
        fetchValesInPaidAtRange(bounds.from, bounds.to),
        fetchSalaryPaymentsForWeek(weekStart),
      ])
        .then(([nextVales, nextPayments]) => {
          if (cancelled) return
          remember(nextVales, nextPayments)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setError('No se pudo cargar esa semana.')
          setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

    let latestVales = cached?.vales ?? []
    let latestPayments = cached?.payments ?? []
    unsubVales = subscribeValesInPaidAtRange(
      bounds.from,
      bounds.to,
      next => {
        if (cancelled) return
        latestVales = next
        remember(next, latestPayments)
        setLoading(false)
      },
      message => {
        if (cancelled) return
        setError(message)
        setLoading(false)
      },
    )
    unsubPay = subscribeSalaryPaymentsForWeek(
      weekStart,
      next => {
        if (cancelled) return
        latestPayments = next
        remember(latestVales, next)
      },
      message => {
        if (cancelled) return
        setError(message)
      },
    )

    return () => {
      cancelled = true
      unsubVales?.()
      unsubPay?.()
    }
  }, [bounds.from, bounds.to, currentWeekStart, reloadKey, weekStart])

  const payrollEmployees = useMemo(
    () => employees.map(e => ({
      id: e.id,
      name: e.name,
      weeklyWage: e.weeklyWage,
      archivedAt: e.archivedAt,
      deleted: e.deleted,
    })),
    [employees],
  )

  const view = useMemo(
    () => resolveWeekView(weekStart, dataWeekStart, vales, payments),
    [weekStart, dataWeekStart, vales, payments],
  )

  const liveRows = useMemo(
    () => buildWeeklyPayroll(payrollEmployees, view.vales, weekStart, weekEnd),
    [payrollEmployees, view.vales, weekStart, weekEnd],
  )

  const rows = useMemo(
    () => mergePayrollWithPayments(liveRows, view.payments, payrollEmployees),
    [liveRows, view.payments, payrollEmployees],
  )

  const filteredRows = useMemo(() => {
    const q = normalize(filterText.trim())
    if (!q) return rows
    return rows.filter(r => normalize(r.employee.name).includes(q))
  }, [rows, filterText])

  const unpaid = filteredRows.filter(r => !r.payment)
  const totalNet = unpaid.reduce((sum, r) => sum + r.netToPay, 0)
  const totalVales = filteredRows.reduce((sum, r) => sum + r.totalVales, 0)
  const totalGross = filteredRows.reduce((sum, r) => sum + r.weeklyWage, 0)
  const totalPaid = filteredRows.filter(r => r.payment).reduce((sum, r) => sum + r.netToPay, 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <ScreenHeader
        title="Liquidación semanal"
        subtitle={`Semana ${weekLabel} · lun–dom`}
        onBack={onBack}
        action={(
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setWeekStart(addDaysYmd(weekStart, -7))}
              className="rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
              aria-label="Semana anterior"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(addDaysYmd(weekStart, 7))}
              disabled={weekStart >= currentWeekStart}
              className="rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-40"
              aria-label="Semana siguiente"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => {
                invalidatePayrollWeekCache(weekStart)
                setReloadKey(k => k + 1)
              }}
              disabled={loading}
              className="rounded-md px-2 py-1.5 text-xs text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              Actualizar
            </button>
          </div>
        )}
      />
      {!online && <OfflineBanner />}

      <main className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {!view.waiting && rows.length > 0 && (
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            maxLength={100}
            placeholder="Buscar empleado…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        )}

        {view.waiting && !error && <Spinner />}
        {error && (
          <ErrorBanner message={error} onRetry={() => setReloadKey(k => k + 1)} />
        )}

        {!view.waiting && !error && rows.length === 0 && (
          <EmptyState message="No hay empleados con sueldo semanal > 0. Configuralo en Carniceros." />
        )}

        {!view.waiting && rows.length > 0 && filteredRows.length === 0 && (
          <p className="py-6 text-center text-sm text-zinc-500">Ningún empleado coincide con la búsqueda.</p>
        )}

        {!view.waiting && filteredRows.length > 0 && (
          <div className="mb-2 grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-center">
            <div>
              <p className="text-[10px] text-zinc-500">Bruto total</p>
              <p className="text-xs tabular-nums text-zinc-200">{formatMoney(totalGross)}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500">Vales total</p>
              <p className="text-xs tabular-nums text-zinc-200">{formatMoney(totalVales)}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500">{totalPaid > 0 && unpaid.length === 0 ? 'Pagado' : 'A pagar'}</p>
              <p className="text-xs font-medium tabular-nums text-emerald-300">
                {formatMoney(unpaid.length === 0 ? totalPaid : totalNet)}
              </p>
            </div>
          </div>
        )}

        {!view.waiting && filteredRows.map(row => (
          <div
            key={row.employee.id}
            className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-white" title={row.employee.name}>
                {row.employee.name}
              </p>
              {row.payment && (
                <span className="shrink-0 rounded-md bg-emerald-950/80 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  Pagado
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-zinc-500">Sueldo</p>
                <p className="text-xs tabular-nums text-zinc-200">{formatMoney(row.weeklyWage)}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Vales</p>
                <p className="text-xs tabular-nums text-zinc-200">{formatMoney(row.totalVales)}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Neto</p>
                <p className="text-xs font-medium tabular-nums text-emerald-300">
                  {formatMoney(row.netToPay)}
                </p>
              </div>
            </div>
            {row.vales.length > 0 && (
              <div className="space-y-1 border-t border-zinc-800/80 pt-1">
                {row.vales.map(v => (
                  <div key={v.id} className="flex min-w-0 items-start gap-2 text-[11px]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-zinc-400" title={v.description ?? 'Vale'}>
                        {v.description?.trim() || 'Vale'}
                      </p>
                      <p className="truncate text-zinc-600" title={formatDateTime(v.paidAt)}>
                        {formatDateTime(v.paidAt)}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-zinc-300">
                      {formatMoney(v.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {row.payment?.notes && (
              <p className="truncate text-[11px] text-zinc-400" title={row.payment.notes}>
                Nota: {row.payment.notes}
              </p>
            )}
            {row.payment && (
              <p className="truncate text-[10px] text-zinc-600" title={formatDateTime(row.payment.paidAt)}>
                Registrado {formatDateTime(row.payment.paidAt)}
              </p>
            )}
          </div>
        ))}

        <p className="pt-1 text-[10px] text-zinc-600">
          El pago se registra en caja (PC). Cada semana se pide por separado; si ya la viste, no se vuelve a consultar.
        </p>
      </main>
    </div>
  )
}
