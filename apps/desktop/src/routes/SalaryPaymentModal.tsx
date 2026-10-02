/**
 * Liquidación semanal: sueldo − vales, pago en efectivo del turno, archivo por semana.
 * La nota es opcional (ej. “le pagué menos porque llegó tarde”).
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  addDaysYmd,
  formatARS,
  toLocalDate,
  toLocalDateTime,
  weekStartMondayLocalYmd,
} from '../lib/datetime'
import type {
  EmployeeRow,
  RemoteEmployeeValeRow,
  RemoteSalaryWeek,
  SalaryPaymentRow,
  WeeklyValeSummary,
} from '../types/hw-api'
import {
  getSalaryWeekRemoteCache,
  invalidateSalaryWeekRemoteCache,
  setSalaryWeekRemoteCache,
  shouldRefetchSalaryWeek,
} from '../lib/salaryWeekCache'
import {
  canPayCurrentSalaryWeek,
  mergeSalaryPayments,
  snapshotToValeLines,
  valeInLocalWeek,
  type SalaryValeLine,
} from '../lib/salaryWeekView'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

interface Props {
  onClose: () => void
  onPaid?: () => void
}

interface RowState {
  employee: EmployeeRow
  summary: WeeklyValeSummary | null
  vales: SalaryValeLine[]
  payment: SalaryPaymentRow | null
  loadError: string | null
}

export default function SalaryPaymentModal({ onClose, onPaid }: Props) {
  const currentWeekStart = weekStartMondayLocalYmd()
  const [weekStart, setWeekStart] = useState(currentWeekStart)
  const weekEnd = addDaysYmd(weekStart, 6)
  const weekLabel = `${toLocalDate(`${weekStart}T12:00:00.000Z`)} – ${toLocalDate(`${weekEnd}T12:00:00.000Z`)}`

  const [rows, setRows] = useState<RowState[]>([])
  const [filterText, setFilterText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasShift, setHasShift] = useState(false)
  const [notesByEmployee, setNotesByEmployee] = useState<Record<string, string>>({})
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getUserOpenShift().then(r => {
      setHasShift(Boolean(r.ok && r.data))
    })
  }, [])

  async function load(force = false) {
    setLoading(true)
    setError(null)
    const empRes = await window.hw.listEmployees()
    if (!empRes.ok) {
      setLoading(false)
      setError(empRes.error ?? 'Error al cargar empleados.')
      return
    }

    const refetchRemote = shouldRefetchSalaryWeek(weekStart, force)
    const [localPayRes, remoteWeekRes] = await Promise.all([
      window.hw.listSalaryPayments({ weekStart }),
      refetchRemote
        ? window.hw.getRemoteSalaryWeek({ weekStart })
        : Promise.resolve({ ok: true as const, data: getSalaryWeekRemoteCache(weekStart) ?? { payments: [], vales: [] } }),
    ])
    const localPayments = localPayRes.ok ? localPayRes.data : []
    let remote: RemoteSalaryWeek = { payments: [], vales: [] }
    if (refetchRemote) {
      if (remoteWeekRes.ok) {
        remote = remoteWeekRes.data
        setSalaryWeekRemoteCache(weekStart, remote)
      }
    } else if (remoteWeekRes.ok) {
      remote = remoteWeekRes.data
    }
    const remotePayments = remote.payments
    const remoteVales: RemoteEmployeeValeRow[] = remote.vales.filter(v => valeInLocalWeek(v.paidAt, weekStart, weekEnd))
    const paymentsByEmp = mergeSalaryPayments(localPayments, remotePayments)

    const eligible = empRes.data.filter(e => e.weeklyWage > 0 || paymentsByEmp.has(e.id))
    const next: RowState[] = []

    for (const employee of eligible) {
      const payment = paymentsByEmp.get(employee.id) ?? null
      if (payment) {
        const snapVales = snapshotToValeLines(payment.valesSnapshot)
        next.push({
          employee,
          summary: {
            employeeId: employee.id,
            weekStart,
            weekEnd,
            weeklyWage: payment.amount,
            totalVales: payment.valesDeducted,
            netToPay: payment.netPaid,
          },
          vales: snapVales.length > 0 ? snapVales : [],
          payment,
          loadError: null,
        })
        continue
      }

      const [sumRes, localValesRes] = await Promise.all([
        window.hw.getWeeklyValeSummary({ employeeId: employee.id, weekStart }),
        window.hw.listVales({ employeeId: employee.id, weekStart, weekEnd }),
      ])

      if (!sumRes.ok) {
        next.push({
          employee,
          summary: null,
          vales: [],
          payment: null,
          loadError: sumRes.error ?? 'Error al cargar resumen.',
        })
        continue
      }

      const byId = new Map<string, SalaryValeLine>()
      if (localValesRes.ok) {
        for (const v of localValesRes.data) {
          if (!valeInLocalWeek(v.paidAt, weekStart, weekEnd)) continue
          if (v.cancelledAt) continue
          byId.set(v.id, {
            id: v.id,
            amount: v.amount,
            description: v.description,
            paidAt: v.paidAt,
            storeId: null,
          })
        }
      }
      for (const v of remoteVales) {
        if (v.employeeId !== employee.id) continue
        if (v.cancelledAt) continue
        byId.set(v.id, {
          id: v.id,
          amount: v.amount,
          description: v.description,
          paidAt: v.paidAt,
          storeId: v.storeId,
        })
      }

      const vales = [...byId.values()].sort((a, b) => b.paidAt.localeCompare(a.paidAt))
      const totalVales = vales.reduce((s, v) => s + v.amount, 0)
      const weeklyWage = sumRes.data.weeklyWage
      const netToPay = Math.max(0, weeklyWage - totalVales)

      next.push({
        employee,
        summary: {
          ...sumRes.data,
          totalVales,
          netToPay,
        },
        vales,
        payment: null,
        loadError: null,
      })
    }

    setRows(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  const filteredRows = useMemo(() => {
    const q = normalize(filterText.trim())
    if (!q) return rows
    return rows.filter(r => normalize(r.employee.name).includes(q))
  }, [rows, filterText])

  const unpaid = filteredRows.filter(r => !r.payment)
  const totalNet = unpaid.reduce((sum, r) => sum + (r.summary?.netToPay ?? 0), 0)
  const totalVales = filteredRows.reduce((sum, r) => sum + (r.summary?.totalVales ?? 0), 0)
  const totalGross = filteredRows.reduce((sum, r) => sum + (r.summary?.weeklyWage ?? 0), 0)
  const totalPaid = filteredRows
    .filter(r => r.payment)
    .reduce((sum, r) => sum + (r.payment?.netPaid ?? 0), 0)

  const paying = payingId ? rows.find(r => r.employee.id === payingId) ?? null : null
  const isCurrentWeek = weekStart === currentWeekStart
  const canPayThisWeek = canPayCurrentSalaryWeek(weekStart, currentWeekStart, hasShift)

  async function confirmPay() {
    if (!paying || !paying.summary || paying.payment || saving) return
    setSaving(true)
    setPayError(null)
    const note = (notesByEmployee[paying.employee.id] ?? '').trim()
    const res = await window.hw.payWeeklySalary({
      employeeId: paying.employee.id,
      weekStart,
      amount: paying.summary.weeklyWage,
      valesDeducted: paying.summary.totalVales,
      notes: note.length > 0 ? note : null,
      valesSnapshot: paying.vales.map(v => ({
        id: v.id,
        amount: v.amount,
        description: v.description,
        paidAt: v.paidAt,
      })),
    })
    if (!res.ok) {
      setSaving(false)
      setPayError(res.error ?? 'No se pudo registrar el pago.')
      return
    }
    setSaving(false)
    setPayingId(null)
    onPaid?.()
    invalidateSalaryWeekRemoteCache(weekStart)
    await load(true)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !payingId) onClose()
      }}
    >
      <div className="flex flex-col bg-panel border border-line rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-ink truncate">Liquidación semanal</h2>
            <p className="text-[10px] text-muted mt-0.5 truncate" title={weekLabel}>
              Semana {weekLabel} · lun–dom
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setWeekStart(addDaysYmd(weekStart, -7))}
              className="rounded-md px-2 py-1.5 text-xs text-ink hover:bg-hover hover:text-ink transition-colors"
              aria-label="Semana anterior"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(addDaysYmd(weekStart, 7))}
              disabled={weekStart >= currentWeekStart}
              className="rounded-md px-2 py-1.5 text-xs text-ink hover:bg-hover hover:text-ink transition-colors disabled:opacity-40"
              aria-label="Semana siguiente"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="rounded-md px-2 py-1.5 text-xs text-danger hover:bg-hover hover:text-danger transition-colors disabled:opacity-40"
            >
              Actualizar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-ink transition-colors"
              aria-label="Cerrar"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 bg-app px-5 py-4">
          {!loading && rows.length > 0 && (
            <input
              type="text"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              maxLength={100}
              placeholder="Buscar empleado…"
              className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent"
            />
          )}

          {!loading && !isCurrentWeek && (
            <p className="text-[10px] text-muted">
              Semana anterior: solo consulta. El pago se registra en la semana en curso.
            </p>
          )}

          {loading && (
            <p className="text-sm text-muted text-center py-8">Cargando…</p>
          )}

          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/30 px-3 py-2">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="text-center py-8 space-y-1">
              <p className="text-sm text-muted">No hay empleados con sueldo semanal &gt; 0.</p>
              <p className="text-xs text-subtle">Configuralo en Empleados.</p>
            </div>
          )}

          {!loading && rows.length > 0 && filteredRows.length === 0 && (
            <p className="text-sm text-muted text-center py-6">Ningún empleado coincide con la búsqueda.</p>
          )}

          {!loading && filteredRows.length > 0 && (
            <div className="mb-2 grid grid-cols-3 gap-2 rounded-xl border border-line bg-panel px-3 py-3 text-center">
              <div>
                <p className="text-[10px] text-muted">Bruto total</p>
                <p className="text-xs text-ink tabular-nums">{formatARS(totalGross)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted">Vales total</p>
                <p className="text-xs text-ink tabular-nums">{formatARS(totalVales)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted">{totalPaid > 0 && unpaid.length === 0 ? 'Pagado' : 'A pagar'}</p>
                <p className="text-xs text-success tabular-nums font-medium">
                  {formatARS(unpaid.length === 0 ? totalPaid : totalNet)}
                </p>
              </div>
            </div>
          )}

          {!loading &&
            filteredRows.map(row => {
              const { employee, summary, vales, loadError, payment } = row
              const expanded = expandedId === employee.id
              return (
                <div
                  key={employee.id}
                  className="overflow-hidden rounded-xl border border-line bg-panel"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : employee.id)}
                    className="w-full flex items-center gap-2 min-w-0 px-3 py-2.5 text-left hover:bg-hover transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="min-w-0 flex-1 text-sm font-medium text-ink truncate" title={employee.name}>
                          {employee.name}
                        </p>
                        {payment && (
                          <span className="shrink-0 rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                            Pagado
                          </span>
                        )}
                      </div>
                      {summary && (
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-muted">Sueldo</p>
                            <p className="text-xs text-ink tabular-nums">{formatARS(summary.weeklyWage)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted">Vales</p>
                            <p className="text-xs text-ink tabular-nums">{formatARS(summary.totalVales)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted">Neto</p>
                            <p className="text-xs text-success tabular-nums font-medium">
                              {formatARS(summary.netToPay)}
                            </p>
                          </div>
                        </div>
                      )}
                      {!expanded && vales.length > 0 && (
                        <p className="text-[10px] text-subtle">
                          {vales.length} vale{vales.length !== 1 ? 's' : ''} · tocá para ver
                        </p>
                      )}
                    </div>
                    <svg
                      className={`h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>

                  {expanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-line">
                      {loadError && (
                        <p className="text-xs text-danger pt-2">{loadError}</p>
                      )}

                      {vales.length > 0 && (
                        <div className="space-y-1 pt-2">
                          {vales.map(v => (
                            <div key={v.id} className="flex items-start gap-2 min-w-0 text-[11px]">
                              <div className="min-w-0 flex-1">
                                <p className="text-muted truncate" title={v.description ?? 'Vale'}>
                                  {v.description?.trim() || 'Vale'}
                                </p>
                                <p className="text-subtle truncate" title={toLocalDateTime(v.paidAt)}>
                                  {toLocalDateTime(v.paidAt)}
                                </p>
                              </div>
                              <span className="shrink-0 text-ink tabular-nums">
                                {formatARS(v.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {payment?.notes && (
                        <p className="text-[11px] text-muted truncate" title={payment.notes}>
                          Nota: {payment.notes}
                        </p>
                      )}
                      {payment && (
                        <p className="text-[10px] text-subtle truncate" title={toLocalDateTime(payment.paidAt)}>
                          Registrado {toLocalDateTime(payment.paidAt)}
                        </p>
                      )}

                      {!payment && summary && canPayThisWeek && (
                        <div className="space-y-2 pt-1">
                          <textarea
                            value={notesByEmployee[employee.id] ?? ''}
                            onChange={e => setNotesByEmployee(prev => ({
                              ...prev,
                              [employee.id]: e.target.value.slice(0, 200),
                            }))}
                            maxLength={200}
                            rows={2}
                            placeholder="Nota opcional (ej. llegó tarde 2 veces)…"
                            className="w-full resize-none rounded-lg border border-line bg-raised px-3 py-2 text-xs text-ink placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-red-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setPayError(null)
                              setPayingId(employee.id)
                            }}
                            className="w-full shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-success/100 transition-colors"
                          >
                            {summary.netToPay > 0
                              ? `Pagar ${formatARS(summary.netToPay)}`
                              : 'Registrar (sin efectivo)'}
                          </button>
                        </div>
                      )}

                      {!payment && isCurrentWeek && !hasShift && (
                        <p className="text-[10px] text-subtle pt-1">
                          Se necesita un turno abierto para pagar (sale de esta caja).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

          <p className="text-[10px] text-subtle pt-1">
            El pago descuenta efectivo de la caja, como un vale. Queda archivado sueldo − vales de esa semana.
          </p>
        </div>

        <div className="flex justify-end border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-4 py-2 text-sm text-muted hover:text-ink hover:bg-hover transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>

      {paying && paying.summary && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-line bg-input p-4 space-y-3">
            <p className="text-sm font-medium text-ink truncate" title={paying.employee.name}>
              ¿Pagar a {paying.employee.name}?
            </p>
            <p className="text-xs text-muted">
              Sale {formatARS(paying.summary.netToPay)} en efectivo de esta caja.
              Sueldo {formatARS(paying.summary.weeklyWage)} − vales {formatARS(paying.summary.totalVales)}.
            </p>
            {payError && <p className="text-xs text-danger">{payError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPayingId(null)
                  setPayError(null)
                }}
                className="shrink-0 rounded-lg px-3 py-2 text-sm text-muted hover:bg-hover hover:text-ink"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmPay()}
                disabled={saving}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-success/100 disabled:opacity-40"
              >
                {saving ? 'Pagando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
