/**
 * Registro de cebo del turno (kg + nota). No mueve caja.
 */
import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import DecimalInput from './DecimalInput'
import { parseDecimalInput } from '../lib/numericInput'
import { canEditCebo, CEBO_NOTES_MAX, listWeekCebo, upsertLocalCebo } from '../lib/cebo'
import { triggerSync } from '../lib/sync'
import { formatWeekRangeLabel, mondayWeekRange } from '@carniceria/shared'
import type { LocalCebo, LocalShift } from '../types/pos'

interface Props {
  shift: LocalShift
  viewerRole: 'admin' | 'cashier'
  viewerName: string
  onClose: () => void
}

function formatKg(kg: number): string {
  return `${kg.toFixed(3)} kg`
}

function toLocalTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function CeboModal({ shift, viewerRole, viewerName, onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const [rows, setRows] = useState<LocalCebo[]>([])
  const [kgRaw, setKgRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const week = mondayWeekRange(weekOffset)
  const canRegister = weekOffset === 0

  async function reload() {
    const list = await listWeekCebo(shift.storeId, weekOffset)
    setRows(list)
  }

  useEffect(() => {
    setEditingId(null)
    setKgRaw('')
    setNotes('')
    void reload()
  }, [shift.storeId, weekOffset])

  function startEdit(row: LocalCebo) {
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
    const now = new Date().toISOString()
    const existing = editingId ? rows.find(r => r.id === editingId) : undefined
    const row: LocalCebo = existing
      ? {
          ...existing,
          quantityKg: kg,
          notes: notes.trim() || null,
          updatedAt: now,
          updatedBy: shift.userId,
          updatedByName: viewerName,
        }
      : {
          id: uuidv4(),
          shiftId: shift.id,
          storeId: shift.storeId,
          quantityKg: kg,
          notes: notes.trim() || null,
          createdAt: now,
          createdBy: shift.userId,
          createdByName: viewerName,
          updatedAt: null,
          updatedBy: null,
          updatedByName: null,
          syncStatus: 'pending',
          syncedAt: null,
        }
    try {
      await upsertLocalCebo(row)
      resetForm()
      await reload()
      triggerSync().catch((err: unknown) => {
        console.error('[cebo] Error al disparar sync', err)
      })
    } catch {
      setError('No se pudo guardar el cebo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-white" title="Cebo">Cebo</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-2xl leading-none text-gray-400 hover:text-white">
            ×
          </button>
        </div>
        <p className="text-sm text-gray-400">Anota kilos y una nota. No mueve caja ni stock.</p>

        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setWeekOffset(o => o - 1)}
            className="shrink-0 rounded-lg border border-gray-600 px-2 py-1 text-xs text-gray-300"
          >
            ← Anterior
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-xs text-gray-400" title={formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)}>
            {formatWeekRangeLabel(week.startYmd, week.endInclusiveYmd)}
            {weekOffset === 0 ? ' (actual)' : ''}
          </p>
          <button
            type="button"
            onClick={() => setWeekOffset(o => Math.min(0, o + 1))}
            disabled={weekOffset === 0}
            className="shrink-0 rounded-lg border border-gray-600 px-2 py-1 text-xs text-gray-300 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>

        <ul className="max-h-40 space-y-2 overflow-y-auto">
          {rows.length === 0 && (
            <li className="py-2 text-center text-sm text-gray-500">Sin cebo esta semana.</li>
          )}
          {rows.map(row => {
            const loaded = `Cargó ${row.createdByName || 'cajera'} · ${toLocalTime(row.createdAt)}`
            const edited = row.updatedAt && row.updatedByName
              ? `Editó ${row.updatedByName} · ${toLocalTime(row.updatedAt)}`
              : null
            return (
              <li key={row.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white" title={formatKg(row.quantityKg)}>
                    {formatKg(row.quantityKg)}
                  </p>
                  {row.notes && (
                    <p className="truncate text-xs text-gray-400" title={row.notes}>{row.notes}</p>
                  )}
                  <p className="truncate text-[11px] text-gray-500" title={loaded}>{loaded}</p>
                  {edited && (
                    <p className="truncate text-[11px] text-gray-500" title={edited}>{edited}</p>
                  )}
                </div>
                {canEditCebo(viewerRole, shift.userId, row.createdBy) && (
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="shrink-0 rounded-lg border border-gray-600 px-2 py-1 text-xs text-gray-300"
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
            <div>
              <label className="mb-1 block text-xs text-gray-400">{editingId ? 'Kilos (edición)' : 'Kilos'}</label>
              <DecimalInput
                value={kgRaw}
                onChange={v => { setKgRaw(v); setError(null) }}
                maxDecimals={3}
                weightMode
                placeholder="0,000"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Nota (opcional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                maxLength={CEBO_NOTES_MAX}
                placeholder="Observaciones…"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
              />
            </div>
          </>
        ) : (
          <p className="text-center text-xs text-gray-500">Para cargar cebo, volvé a la semana actual.</p>
        )}

        {error && <p className="text-center text-sm font-medium text-orange-400">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded-xl bg-gray-800 py-4 font-semibold text-white"
            >
              Cancelar edición
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl bg-gray-800 py-4 font-semibold text-white"
            >
              Cerrar
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || (!canRegister && !editingId)}
            className="rounded-xl bg-emerald-700 py-4 font-bold text-white disabled:opacity-40"
          >
            {saving ? 'Guardando…' : editingId ? 'Guardar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
