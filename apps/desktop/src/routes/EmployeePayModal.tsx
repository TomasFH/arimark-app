/**
 * Pago en efectivo a empleado (carnicero).
 * Baja caja vía gasto con concepto "Pago: {nombre}".
 * El monto es libre (lo que indicó el admin); el neto de liquidación es solo referencia.
 */
import { useEffect, useState } from 'react'
import NumericInput from '../components/NumericInput'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'
import {
  addDaysYmd,
  formatARS,
  toLocalDate,
  weekStartMondayLocalYmd,
} from '../lib/datetime'
import type { EmployeeRow, WeeklyValeSummary } from '../types/hw-api'

interface Props {
  onClose: () => void
  onPaid?: () => void
}

export default function EmployeePayModal({ onClose, onPaid }: Props) {
  const weekStart = weekStartMondayLocalYmd()
  const weekEnd = addDaysYmd(weekStart, 6)
  const weekLabel = `${toLocalDate(`${weekStart}T12:00:00.000Z`)} – ${toLocalDate(`${weekEnd}T12:00:00.000Z`)}`

  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<WeeklyValeSummary | null>(null)
  const [amountText, setAmountText] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      const res = await window.hw.listEmployees()
      setLoading(false)
      if (!res.ok) {
        setError(res.error ?? 'Error al cargar empleados.')
        return
      }
      setEmployees(res.data.filter(e => e.active))
    })()
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setSummary(null)
      setAmountText('')
      return
    }
    let cancelled = false
    void (async () => {
      setLoadingSummary(true)
      setError(null)
      const res = await window.hw.getWeeklyValeSummary({
        employeeId: selectedId,
        weekStart,
      })
      if (cancelled) return
      setLoadingSummary(false)
      if (!res.ok) {
        setSummary(null)
        setError(res.error ?? 'Error al cargar liquidación.')
        return
      }
      setSummary(res.data)
      // Prefill con neto sugerido; la cajera puede cambiarlo.
      setAmountText(
        res.data.netToPay > 0
          ? formatNumericInputValue(String(res.data.netToPay))
          : '',
      )
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, weekStart])

  const selected = employees.find(e => e.id === selectedId) ?? null

  async function handlePay() {
    if (!selected || saving) return
    const amount = parseNumericInput(amountText)
    if (amount === null || amount <= 0) {
      setError('Ingresá un monto válido mayor a 0.')
      return
    }

    setSaving(true)
    setError(null)
    const concept = `Pago: ${selected.name}`.slice(0, 80)
    const res = await window.hw.registerExpense({
      concept,
      amount,
      notes: notes.trim() || undefined,
    })
    setSaving(false)

    if (!res.ok) {
      setError(res.error ?? 'No se pudo registrar el pago.')
      return
    }
    setDone(true)
    onPaid?.()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-zinc-700 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white truncate">Pago a empleado</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate" title={weekLabel}>
              Semana {weekLabel} · baja efectivo de caja
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
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

        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <p className="text-emerald-300 font-medium">Pago registrado</p>
            <p className="text-xs text-zinc-500">
              Se descontó de la caja como gasto.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {loading && (
                <p className="text-sm text-zinc-500 text-center py-6">Cargando…</p>
              )}

              {error && (
                <div className="rounded-lg bg-red-950/40 border border-red-800/60 px-3 py-2">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              {!loading && employees.length === 0 && (
                <p className="text-sm text-zinc-500 text-center py-6">
                  No hay empleados activos.
                </p>
              )}

              {!loading && employees.length > 0 && (
                <label className="block text-xs text-zinc-400">
                  Empleado
                  <select
                    value={selectedId ?? ''}
                    onChange={e => setSelectedId(e.target.value || null)}
                    disabled={saving}
                    className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white"
                  >
                    <option value="">Elegí un empleado…</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </label>
              )}

              {selected && (
                <>
                  {loadingSummary && (
                    <p className="text-xs text-zinc-500">Cargando liquidación de la semana…</p>
                  )}
                  {summary && (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-[10px] text-zinc-500">Sueldo</p>
                        <p className="text-xs text-zinc-200 tabular-nums">{formatARS(summary.weeklyWage)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Vales</p>
                        <p className="text-xs text-amber-300 tabular-nums">{formatARS(summary.totalVales)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Neto ref.</p>
                        <p className="text-xs text-emerald-300 tabular-nums font-medium">
                          {formatARS(summary.netToPay)}
                        </p>
                      </div>
                    </div>
                  )}

                  <label className="block text-xs text-zinc-400">
                    Monto a pagar (efectivo)
                    <NumericInput
                      value={amountText}
                      onChange={v => {
                        setAmountText(v)
                        setError(null)
                      }}
                      disabled={saving}
                      placeholder="0"
                      className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </label>

                  <label className="block text-xs text-zinc-400">
                    Nota (opcional)
                    <input
                      type="text"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      maxLength={300}
                      disabled={saving}
                      placeholder="Ej. pago parcial, ajuste…"
                      className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </label>

                  <p className="text-[10px] text-zinc-600">
                    El neto es referencia. Pagá el monto que indicó el admin; se registra como gasto
                    “Pago: {selected.name}”.
                  </p>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-700 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="shrink-0 rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handlePay()}
                disabled={saving || !selected}
                className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Registrar pago'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
