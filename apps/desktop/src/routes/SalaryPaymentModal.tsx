/**
 * Panel informativo admin: liquidación semanal esperada (sueldo − vales).
 * Solo consulta; el pago en efectivo lo hace la cajera fuera de este flujo.
 *
 * Los vales se consolidan de SQLite local + Firestore (todos los locales),
 * filtrados a la semana lun–dom actual, sin doble conteo por id.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  addDaysYmd,
  formatARS,
  getDisplayTimezone,
  toLocalDate,
  toLocalDateTime,
  weekStartMondayLocalYmd,
} from '../lib/datetime'
import type { EmployeeRow, RemoteEmployeeValeRow, WeeklyValeSummary } from '../types/hw-api'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

interface Props {
  onClose: () => void
}

interface ValeLine {
  id: string
  amount: number
  description: string | null
  paidAt: string
  storeId: string | null
}

interface RowState {
  employee: EmployeeRow
  summary: WeeklyValeSummary | null
  vales: ValeLine[]
  loadError: string | null
}

function utcToLocalYmd(utc: string): string {
  if (!utc) return ''
  return new Date(utc).toLocaleDateString('en-CA', { timeZone: getDisplayTimezone() })
}

function inWeek(paidAt: string, weekStart: string, weekEnd: string): boolean {
  const ymd = utcToLocalYmd(paidAt)
  return ymd !== '' && ymd >= weekStart && ymd <= weekEnd
}

export default function SalaryPaymentModal({ onClose }: Props) {
  const weekStart = weekStartMondayLocalYmd()
  const weekEnd = addDaysYmd(weekStart, 6)
  const weekLabel = `${toLocalDate(`${weekStart}T12:00:00.000Z`)} – ${toLocalDate(`${weekEnd}T12:00:00.000Z`)}`

  const [rows, setRows] = useState<RowState[]>([])
  const [filterText, setFilterText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const empRes = await window.hw.listEmployees()
    if (!empRes.ok) {
      setLoading(false)
      setError(empRes.error ?? 'Error al cargar empleados.')
      return
    }

    // Vales de todos los locales (Firestore). Si falla o no hay red, seguimos con local.
    const remoteRes = await window.hw.getRemoteEmployeeVales({ storeIdFilter: 'all' })
    const remoteWeek: RemoteEmployeeValeRow[] = remoteRes.ok
      ? remoteRes.data.filter(v => inWeek(v.paidAt, weekStart, weekEnd))
      : []

    const eligible = empRes.data.filter(e => e.weeklyWage > 0)
    const next: RowState[] = []

    for (const employee of eligible) {
      const [sumRes, localValesRes] = await Promise.all([
        window.hw.getWeeklyValeSummary({ employeeId: employee.id, weekStart }),
        window.hw.listVales({ employeeId: employee.id, weekStart, weekEnd }),
      ])

      if (!sumRes.ok) {
        next.push({
          employee,
          summary: null,
          vales: [],
          loadError: sumRes.error ?? 'Error al cargar resumen.',
        })
        continue
      }

      // Merge por id: local + remoto de la semana (sin doble conteo).
      const byId = new Map<string, ValeLine>()
      if (localValesRes.ok) {
        for (const v of localValesRes.data) {
          if (!inWeek(v.paidAt, weekStart, weekEnd)) continue
          byId.set(v.id, {
            id: v.id,
            amount: v.amount,
            description: v.description,
            paidAt: v.paidAt,
            storeId: null,
          })
        }
      }
      for (const v of remoteWeek) {
        if (v.employeeId !== employee.id) continue
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
        loadError: null,
      })
    }

    setRows(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredRows = useMemo(() => {
    const q = normalize(filterText.trim())
    if (!q) return rows
    return rows.filter(r => normalize(r.employee.name).includes(q))
  }, [rows, filterText])

  const totalNet = filteredRows.reduce((sum, r) => sum + (r.summary?.netToPay ?? 0), 0)
  const totalVales = filteredRows.reduce((sum, r) => sum + (r.summary?.totalVales ?? 0), 0)
  const totalGross = filteredRows.reduce((sum, r) => sum + (r.summary?.weeklyWage ?? 0), 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-zinc-700 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white truncate">Liquidación semanal</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate" title={weekLabel}>
              Semana {weekLabel} · se reinicia cada lunes
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-md px-2 py-1.5 text-xs text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              Actualizar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {!loading && rows.length > 0 && (
            <input
              type="text"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              maxLength={100}
              placeholder="Buscar empleado…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          )}

          {loading && (
            <p className="text-sm text-zinc-500 text-center py-8">Cargando…</p>
          )}

          {error && (
            <div className="rounded-lg bg-red-950/40 border border-red-800/60 px-3 py-2">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="text-center py-8 space-y-1">
              <p className="text-sm text-zinc-500">No hay empleados con sueldo semanal &gt; 0.</p>
              <p className="text-xs text-zinc-600">Configuralo en Empleados.</p>
            </div>
          )}

          {!loading && rows.length > 0 && filteredRows.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-6">Ningún empleado coincide con la búsqueda.</p>
          )}

          {!loading && filteredRows.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 grid grid-cols-3 gap-2 text-center mb-2">
              <div>
                <p className="text-[10px] text-zinc-500">Bruto total</p>
                <p className="text-xs text-zinc-200 tabular-nums">{formatARS(totalGross)}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Vales total</p>
                <p className="text-xs text-zinc-200 tabular-nums">{formatARS(totalVales)}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">A pagar</p>
                <p className="text-xs text-emerald-300 tabular-nums font-medium">{formatARS(totalNet)}</p>
              </div>
            </div>
          )}

          {!loading &&
            filteredRows.map(row => {
              const { employee, summary, vales, loadError } = row
              return (
                <div
                  key={employee.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 space-y-2"
                >
                  <p className="text-sm font-medium text-white truncate" title={employee.name}>
                    {employee.name}
                  </p>

                  {loadError && (
                    <p className="text-xs text-red-300">{loadError}</p>
                  )}

                  {summary && (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-[10px] text-zinc-500">Sueldo</p>
                        <p className="text-xs text-zinc-200 tabular-nums">{formatARS(summary.weeklyWage)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Vales</p>
                        <p className="text-xs text-zinc-200 tabular-nums">{formatARS(summary.totalVales)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Neto</p>
                        <p className="text-xs text-emerald-300 tabular-nums font-medium">
                          {formatARS(summary.netToPay)}
                        </p>
                      </div>
                    </div>
                  )}

                  {vales.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-zinc-800/80">
                      {vales.map(v => (
                        <div key={v.id} className="flex items-start gap-2 min-w-0 text-[11px]">
                          <div className="min-w-0 flex-1">
                            <p className="text-zinc-400 truncate" title={v.description ?? 'Vale'}>
                              {v.description?.trim() || 'Vale'}
                            </p>
                            <p className="text-zinc-600 truncate" title={toLocalDateTime(v.paidAt)}>
                              {toLocalDateTime(v.paidAt)}
                            </p>
                          </div>
                          <span className="shrink-0 text-zinc-300 tabular-nums">
                            {formatARS(v.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

          <p className="text-[10px] text-zinc-600 pt-1">
            Solo esta semana (lun–dom). El pago en efectivo lo hace la cajera; no se registra un pago de salario en la app.
          </p>
        </div>

        <div className="flex justify-end border-t border-zinc-700 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
