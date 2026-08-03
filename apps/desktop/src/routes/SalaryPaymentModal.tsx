/**
 * Panel informativo admin: liquidación semanal esperada (sueldo − vales).
 * Solo consulta; el pago en efectivo lo hace la cajera fuera de este flujo.
 */
import { useEffect, useState } from 'react'
import {
  addDaysYmd,
  formatARS,
  toLocalDate,
  weekStartMondayLocalYmd,
} from '../lib/datetime'
import type { EmployeeRow, WeeklyValeSummary } from '../types/hw-api'

interface Props {
  onClose: () => void
}

interface RowState {
  employee: EmployeeRow
  summary: WeeklyValeSummary | null
  loadError: string | null
}

export default function SalaryPaymentModal({ onClose }: Props) {
  const weekStart = weekStartMondayLocalYmd()
  const weekEnd = addDaysYmd(weekStart, 6)
  const weekLabel = `${toLocalDate(`${weekStart}T12:00:00.000Z`)} – ${toLocalDate(`${weekEnd}T12:00:00.000Z`)}`

  const [rows, setRows] = useState<RowState[]>([])
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

    const eligible = empRes.data.filter(e => e.weeklyWage > 0)
    const next: RowState[] = []

    for (const employee of eligible) {
      const sumRes = await window.hw.getWeeklyValeSummary({
        employeeId: employee.id,
        weekStart,
      })
      if (!sumRes.ok) {
        next.push({
          employee,
          summary: null,
          loadError: sumRes.error ?? 'Error al cargar resumen.',
        })
      } else {
        next.push({
          employee,
          summary: sumRes.data,
          loadError: null,
        })
      }
    }

    setRows(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalNet = rows.reduce((sum, r) => sum + (r.summary?.netToPay ?? 0), 0)
  const totalVales = rows.reduce((sum, r) => sum + (r.summary?.totalVales ?? 0), 0)
  const totalGross = rows.reduce((sum, r) => sum + (r.summary?.weeklyWage ?? 0), 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-gray-700 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white truncate">Liquidación semanal</h2>
            <p className="text-[10px] text-gray-500 mt-0.5 truncate" title={weekLabel}>
              Semana {weekLabel} · solo consulta
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading && (
            <p className="text-sm text-gray-500 text-center py-8">Cargando…</p>
          )}

          {error && (
            <div className="rounded-lg bg-red-950/40 border border-red-800/60 px-3 py-2">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="text-center py-8 space-y-1">
              <p className="text-sm text-gray-500">No hay empleados con sueldo semanal &gt; 0.</p>
              <p className="text-xs text-gray-600">Configuralo en Empleados.</p>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/80 px-3 py-2 grid grid-cols-3 gap-2 text-center mb-2">
              <div>
                <p className="text-[10px] text-gray-500">Bruto total</p>
                <p className="text-xs text-gray-200 tabular-nums">{formatARS(totalGross)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500">Vales total</p>
                <p className="text-xs text-amber-300 tabular-nums">{formatARS(totalVales)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500">A pagar</p>
                <p className="text-xs text-emerald-300 tabular-nums font-medium">{formatARS(totalNet)}</p>
              </div>
            </div>
          )}

          {!loading &&
            rows.map(row => {
              const { employee, summary, loadError } = row
              return (
                <div
                  key={employee.id}
                  className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-3 space-y-2"
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
                        <p className="text-[10px] text-gray-500">Sueldo</p>
                        <p className="text-xs text-gray-200 tabular-nums">{formatARS(summary.weeklyWage)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500">Vales</p>
                        <p className="text-xs text-amber-300 tabular-nums">{formatARS(summary.totalVales)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500">Neto</p>
                        <p className="text-xs text-emerald-300 tabular-nums font-medium">
                          {formatARS(summary.netToPay)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

          <p className="text-[10px] text-gray-600 pt-1">
            Panel informativo. El pago en efectivo lo hace la cajera según lo que indiques; no se registra
            un “pago de salario” en la app.
          </p>
        </div>

        <div className="flex justify-end border-t border-gray-700 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
