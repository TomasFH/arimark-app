/**
 * Pantalla de arqueo de caja — cierre deliberado de turno.
 *
 * Muestra el resumen del turno (calculado desde DB) y permite ingresar
 * los datos de cierre: efectivo al cerrar, monto al cofre, entregado y notas.
 * El efectivo al cerrar es obligatorio en cierre manual; en auto-cierre por
 * inactividad el handler acepta closingCash omitido.
 */
import { useEffect, useState } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ShiftSummary } from '../types/hw-api'

interface Props {
  onConfirmed: () => void
  onCancel: () => void
}

export default function CloseShiftScreen({ onConfirmed, onCancel }: Props) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [closingCashRaw, setClosingCashRaw] = useState('')
  const [safeAmountRaw, setSafeAmountRaw] = useState('')
  const [deliveredAmountRaw, setDeliveredAmountRaw] = useState('')
  const [deliveredTo, setDeliveredTo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getShiftSummary().then(r => {
      if (r.ok) setSummary(r.data)
      else setLoadError(r.error)
    })
  }, [])

  async function handleConfirm() {
    const closingCash = parseNumericInput(closingCashRaw)
    if (closingCash === null || closingCash < 0) {
      setSaveError('Ingresá el efectivo en caja al cerrar.')
      return
    }

    setSaving(true)
    setSaveError(null)

    const safeAmount = parseNumericInput(safeAmountRaw) ?? undefined
    const deliveredAmount = parseNumericInput(deliveredAmountRaw) ?? undefined

    const r = await window.hw.closeShift({
      closingCash,
      safeAmount,
      deliveredAmount: deliveredAmount,
      deliveredTo: deliveredTo.trim() || undefined,
      notes: notes.trim() || undefined,
    })

    setSaving(false)
    if (!r.ok) {
      setSaveError(r.error)
      return
    }
    onConfirmed()
  }

  const shiftLabel = summary?.shiftType === 'morning' ? 'Mañana' : 'Tarde'
  const startedFormatted = summary
    ? new Date(summary.startedAt).toLocaleString('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—'

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Cerrar caja</h1>
          <p className="text-sm text-gray-400">Registrá el arqueo antes de finalizar el turno</p>
        </div>

        {/* Resumen del turno */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Resumen del turno</h2>
          {loadError ? (
            <p className="text-red-400 text-sm">{loadError}</p>
          ) : summary ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Turno" value={shiftLabel} />
              <Stat label="Apertura" value={startedFormatted} />
              <Stat label="Efectivo inicial" value={`$${summary.openingCash.toLocaleString('es-AR')}`} />
              <Stat label="Ventas en el turno" value={String(summary.salesCount)} />
              <Stat
                label="Total vendido"
                value={`$${summary.totalRevenue.toLocaleString('es-AR')}`}
                highlight
              />
            </div>
          ) : (
            <p className="text-gray-500 text-sm animate-pulse">Cargando resumen…</p>
          )}
        </div>

        {/* Formulario de cierre */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Datos de cierre</h2>

          <Field label="Efectivo en caja al cerrar *">
            <NumericInput
              value={closingCashRaw}
              onChange={setClosingCashRaw}
              placeholder="0"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </Field>

          <Field label="Monto al cofre (opcional)">
            <NumericInput
              value={safeAmountRaw}
              onChange={setSafeAmountRaw}
              placeholder="0"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </Field>

          <Field label="Monto entregado (opcional)">
            <NumericInput
              value={deliveredAmountRaw}
              onChange={setDeliveredAmountRaw}
              placeholder="0"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </Field>

          {(parseNumericInput(deliveredAmountRaw) ?? 0) > 0 && (
            <Field label="¿A quién se entregó?">
              <input
                type="text"
                value={deliveredTo}
                onChange={e => setDeliveredTo(e.target.value)}
                placeholder="Nombre o cargo"
                maxLength={80}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </Field>
          )}

          <Field label="Notas (opcional)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Observaciones del turno…"
              rows={2}
              maxLength={300}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </Field>
        </div>

        {saveError && (
          <p className="text-red-400 text-sm text-center">{saveError}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !summary}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Cerrando…' : 'Confirmar cierre de turno'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-400">{label}</label>
      {children}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${highlight ? 'text-green-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}
