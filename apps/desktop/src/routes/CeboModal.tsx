/**
 * Registro de cebo del turno (kg + nota). No mueve caja.
 */
import { useEffect, useState } from 'react'
import DecimalInput from '../components/DecimalInput'
import { parseDecimalInput } from '../lib/numericInput'
import { formatKg, toLocalTime } from '../lib/datetime'
import { formatWeekRangeLabel, mondayWeekRange } from '@carniceria/shared'
import { Button, Modal } from '../components/ui'

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

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

export default function CeboModal({ onClose }: Props) {
  const [rows, setRows] = useState<CeboRow[]>([])
  const [kgRaw, setKgRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const week = mondayWeekRange(weekOffset)
  const canRegister = weekOffset === 0

  function changeWeek(next: number) {
    setWeekOffset(next)
    setRows([])
    setListLoading(true)
    setEditingId(null)
    setKgRaw('')
    setNotes('')
    setError(null)
  }

  useEffect(() => {
    let cancelled = false
    void window.hw.listShiftCebo({ weekOffset }).then(r => {
      if (cancelled) return
      setListLoading(false)
      if (!r.ok) {
        setError(r.error)
        setRows([])
        return
      }
      setRows([...r.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    })
    return () => { cancelled = true }
  }, [weekOffset])

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
    setListLoading(true)
    const listed = await window.hw.listShiftCebo({ weekOffset })
    setListLoading(false)
    if (listed.ok) {
      setRows([...listed.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    }
  }

  const weekTitle = formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlay={!saving}
      closeOnEscape={!saving}
      title="Cebo"
      size="md"
      footer={(
        <>
          {editingId ? (
            <Button variant="secondary" className="mr-auto" onClick={resetForm} disabled={saving}>
              Cancelar edición
            </Button>
          ) : (
            <Button variant="secondary" className="mr-auto" onClick={onClose} disabled={saving}>
              Cerrar
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            loading={saving}
            disabled={!canRegister && !editingId}
          >
            {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Registrar'}
          </Button>
        </>
      )}
    >
      <p className="mb-4 text-sm text-muted">Anota kilos y una nota. No mueve caja ni stock.</p>

      <div className="mb-4 flex min-w-0 items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => changeWeek(weekOffset - 1)}>
          ← Anterior
        </Button>
        <p className="min-w-0 flex-1 truncate text-center text-xs text-muted" title={weekTitle}>
          {weekTitle}
          {weekOffset === 0 ? ' (actual)' : ''}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => changeWeek(Math.min(0, weekOffset + 1))}
          disabled={weekOffset === 0}
        >
          Siguiente →
        </Button>
      </div>

      <ul className="mb-4 max-h-48 space-y-2 overflow-y-auto">
        {!listLoading && rows.length === 0 && (
          <li className="py-2 text-center text-sm text-muted">Sin cebo esta semana.</li>
        )}
        {rows.map(row => {
          const loaded = `Cargó ${row.createdByName} · ${toLocalTime(row.createdAt)}`
          const edited = row.updatedAt && row.updatedByName
            ? `Editó ${row.updatedByName} · ${toLocalTime(row.updatedAt)}`
            : null
          return (
            <li key={row.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={formatKg(row.quantityKg)}>
                  {formatKg(row.quantityKg)}
                </p>
                {row.notes && (
                  <p className="truncate text-xs text-muted" title={row.notes}>{row.notes}</p>
                )}
                <p className="truncate text-[11px] text-subtle" title={loaded}>{loaded}</p>
                {edited && (
                  <p className="truncate text-[11px] text-subtle" title={edited}>{edited}</p>
                )}
              </div>
              {row.canEdit && (
                <Button variant="secondary" size="sm" onClick={() => startEdit(row)}>
                  Editar
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {canRegister || editingId ? (
        <>
          <div className="mb-3 space-y-1">
            <label className="text-sm text-muted">{editingId ? 'Kilos (edición)' : 'Kilos'}</label>
            <DecimalInput
              value={kgRaw}
              onChange={v => { setKgRaw(v); setError(null) }}
              maxDecimals={3}
              weightMode
              placeholder="0,000"
              className={fieldClass}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted">Nota (opcional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={NOTES_MAX}
              placeholder="Observaciones…"
              className={fieldClass}
            />
          </div>
        </>
      ) : (
        <p className="text-xs text-muted">Para cargar cebo, volvé a la semana actual.</p>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  )
}
