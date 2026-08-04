/**
 * Modal para registrar asistencia del día (cajera o admin).
 * Carga empleados activos + registros de hoy; guarda con RECORD_ATTENDANCE (upsert).
 */
import { useEffect, useState } from 'react'
import { todayLocalYmd, toLocalDate } from '../lib/datetime'
import type { AttendanceStatus } from '../types/hw-api'

interface Props {
  onClose: () => void
}

interface EmployeeDraft {
  employeeId: string
  name: string
  status: AttendanceStatus | null
  note: string
}

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Presente' },
  { value: 'absent', label: 'Ausente' },
  { value: 'late', label: 'Llegó tarde' },
  { value: 'early_departure', label: 'Se retiró anticipado' },
]

function needsNote(status: AttendanceStatus | null): boolean {
  return status === 'absent' || status === 'early_departure'
}

export default function AttendanceModal({ onClose }: Props) {
  const date = todayLocalYmd()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [rows, setRows] = useState<EmployeeDraft[]>([])

  async function load() {
    setLoading(true)
    setError(null)
    setSuccess(null)

    const [empRes, attRes] = await Promise.all([
      window.hw.listEmployees(),
      window.hw.listAttendance({ startDate: date, endDate: date }),
    ])

    setLoading(false)

    if (!empRes.ok) {
      setError(empRes.error ?? 'Error al cargar empleados.')
      return
    }
    if (!attRes.ok) {
      setError(attRes.error ?? 'Error al cargar asistencia.')
      return
    }

    const byEmployee = new Map(attRes.data.map(a => [a.employeeId, a]))
    setRows(
      empRes.data.map(emp => {
        const existing = byEmployee.get(emp.id)
        return {
          employeeId: emp.id,
          name: emp.name,
          status: existing?.status ?? null,
          note: existing?.note ?? '',
        }
      }),
    )
  }

  useEffect(() => {
    void load()
    // Solo al montar (fecha del día)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateRow(employeeId: string, patch: Partial<Pick<EmployeeDraft, 'status' | 'note'>>) {
    setRows(prev =>
      prev.map(r => (r.employeeId === employeeId ? { ...r, ...patch } : r)),
    )
    setError(null)
    setSuccess(null)
  }

  async function handleSave() {
    setError(null)
    setSuccess(null)

    const toSave = rows.filter(r => r.status !== null)
    if (toSave.length === 0) {
      setError('Seleccioná el estado de al menos un empleado.')
      return
    }

    setSaving(true)
    const failures: string[] = []

    for (const r of toSave) {
      const status = r.status
      if (!status) continue
      const noteTrim = r.note.trim()
      const res = await window.hw.recordAttendance({
        employeeId: r.employeeId,
        date,
        status,
        note: needsNote(status) && noteTrim ? noteTrim : null,
      })
      if (!res.ok) {
        failures.push(`${r.name}: ${res.error ?? 'error'}`)
      }
    }

    setSaving(false)

    if (failures.length > 0) {
      setError(`Algunos registros fallaron:\n${failures.join('\n')}`)
      await load()
      return
    }

    setSuccess(`Asistencia guardada (${toSave.length}).`)
    setTimeout(() => onClose(), 1200)
  }

  const dateLabel = toLocalDate(`${date}T12:00:00.000Z`)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh]">
        <div className="flex items-center justify-between gap-2 min-w-0 border-b border-zinc-700 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white truncate">Asistencia</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate" title={dateLabel}>
              {dateLabel} · carniceros activos
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && (
            <p className="text-sm text-zinc-500 text-center py-8">Cargando…</p>
          )}

          {!loading && rows.length === 0 && !error && (
            <div className="text-center py-8 space-y-1">
              <p className="text-sm text-zinc-500">No hay empleados activos.</p>
              <p className="text-xs text-zinc-600">
                El admin debe crearlos en Empleados antes de marcar asistencia.
              </p>
            </div>
          )}

          {!loading &&
            rows.map(row => (
              <div
                key={row.employeeId}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 space-y-2"
              >
                <p className="text-sm font-medium text-white truncate" title={row.name}>
                  {row.name}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_OPTIONS.map(opt => {
                    const selected = row.status === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          updateRow(row.employeeId, {
                            status: selected ? null : opt.value,
                            note: selected ? row.note : needsNote(opt.value) ? row.note : '',
                          })
                        }
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors border ${
                          selected
                            ? opt.value === 'absent'
                              ? 'bg-red-700/40 border-red-600 text-red-200'
                              : opt.value === 'late' || opt.value === 'early_departure'
                                ? 'bg-amber-700/40 border-amber-600 text-amber-200'
                                : 'bg-emerald-700/40 border-emerald-600 text-emerald-200'
                            : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                {needsNote(row.status) && (
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">
                      Nota (opcional)
                    </label>
                    <input
                      type="text"
                      value={row.note}
                      maxLength={500}
                      disabled={saving}
                      onChange={e => updateRow(row.employeeId, { note: e.target.value })}
                      placeholder={
                        row.status === 'absent' ? 'Motivo de la ausencia…' : 'Detalle opcional…'
                      }
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}
              </div>
            ))}

          {error && (
            <div className="rounded-lg bg-red-950/40 border border-red-800/60 px-3 py-2">
              <p className="text-sm text-red-300 whitespace-pre-line">{error}</p>
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-emerald-950/40 border border-emerald-800/60 px-3 py-2">
              <p className="text-sm text-emerald-300">{success}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-700 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || rows.length === 0}
            className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
