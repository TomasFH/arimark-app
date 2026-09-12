/**
 * Registro de cebo del turno (kg + nota). No mueve caja.
 */
import { useEffect, useState } from 'react'
import DecimalInput from '../components/DecimalInput'
import { parseDecimalInput } from '../lib/numericInput'
import { formatKg, toLocalTime } from '../lib/datetime'
import { formatWeekRangeLabel, mondayWeekRange } from '@carniceria/shared'

const NOTES_MAX = 300

interface CeboRow {
  id: string
  quantityKg: number
  notes: string | null
  createdByName: string
  createdAt: string
  updatedByName: string | null
  updatedAt: string | null
  canEdit: boolean
}

interface Props {
  onClose: () => void
}

export default function CeboModal({ onClose }: Props) {
  const [rows, setRows] = useState<CeboRow[]>([])
  const [kgRaw, setKgRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const week = mondayWeekRange(weekOffset)
  const canRegister = weekOffset === 0

  async function reload() {
    const r = await window.hw.listShiftCebo({ weekOffset })
    if (!r.ok) {
      setError(r.error)
      return
    }
    setRows(r.data)
  }

  useEffect(() => {
    setEditingId(null)
    setKgRaw('')
    setNotes('')
    void reload()
  }, [weekOffset])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  function startEdit(row: CeboRow) {
    setEditingId(row.id)
    setKgRaw(String(row.quantityKg).replace('.', ','))
    setNotes(row.notes ?? '')
    setError(null)
  }

  function resetForm() {
    setEditingId(null)
    setKgRaw('')
    setNotes('')
  }

  async function handleSubmit() {
    const kg = parseDecimalInput(kgRaw)
    if (kg === null || kg <= 0) {
      setError('Ingresá los kilos (mayor a 0).')
      return
    }
    setSaving(true)
    setError(null)
    const payload = { quantityKg: kg, notes: notes.trim() || undefined }
    const r = editingId
      ? await window.hw.updateCebo({ id: editingId, ...payload })
      : await window.hw.registerCebo(payload)
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    resetForm()
    await reload()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-md shadow-xl space-y-4 p-6 border border-zinc-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold min-w-0 truncate" title="Cebo">Cebo</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 p-1"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-zinc-400">Anota kilos y una nota. No mueve caja ni stock.</p>

        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setWeekOffset(o => o - 1)}
            className="shrink-0 rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            ← Anterior
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-xs text-zinc-400" title={formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)}>
            {formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)}
            {weekOffset === 0 ? ' (actual)' : ''}
          </p>
          <button
            type="button"
            onClick={() => setWeekOffset(o => Math.min(0, o + 1))}
            disabled={weekOffset === 0}
            className="shrink-0 rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>

        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {rows.length === 0 && (
            <li className="text-sm text-zinc-500 text-center py-2">Sin cebo esta semana.</li>
          )}
          {rows.map(row => {
            const loaded = `Cargó ${row.createdByName} · ${toLocalTime(row.createdAt)}`
            const edited = row.updatedAt && row.updatedByName
              ? `Editó ${row.updatedByName} · ${toLocalTime(row.updatedAt)}`
              : null
            return (
              <li key={row.id} className="flex items-center gap-2 min-w-0 rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium truncate" title={formatKg(row.quantityKg)}>
                    {formatKg(row.quantityKg)}
                  </p>
                  {row.notes && (
                    <p className="text-xs text-zinc-400 truncate" title={row.notes}>{row.notes}</p>
                  )}
                  <p className="text-[11px] text-zinc-500 truncate" title={loaded}>{loaded}</p>
                  {edited && (
                    <p className="text-[11px] text-zinc-500 truncate" title={edited}>{edited}</p>
                  )}
                </div>
                {row.canEdit && (
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="shrink-0 text-xs text-zinc-300 border border-zinc-600 rounded-lg px-2 py-1 hover:bg-zinc-700"
                  >
                    Editar
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {canRegister || editingId ? (
          <>
            <div className="space-y-1">
              <label className="text-sm text-zinc-400">{editingId ? 'Kilos (edición)' : 'Kilos'}</label>
              <DecimalInput
                value={kgRaw}
                onChange={v => { setKgRaw(v); setError(null) }}
                maxDecimals={3}
                weightMode
                placeholder="0,000"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-zinc-400">Nota (opcional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                maxLength={NOTES_MAX}
                placeholder="Observaciones…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </>
        ) : (
          <p className="text-xs text-zinc-500">Para cargar cebo, volvé a la semana actual.</p>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 text-sm"
            >
              Cancelar edición
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 text-sm"
            >
              Cerrar
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || (!canRegister && !editingId)}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
