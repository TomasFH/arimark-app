/**
 * Pantalla de arqueo de caja — cierre deliberado de turno.
 *
 * Muestra el resumen del turno, permite contar billetes por denominación
 * y calcula la diferencia entre el efectivo esperado y el contado.
 */
import { useEffect, useState } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { ShiftSummary } from '../types/hw-api'

/** Denominaciones válidas en pesos argentinos (actualizar si cambia la emisión). */
const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10]

interface BillRow {
  denomination: number
  quantity: string // string para el NumericInput; parseado al enviar
}

function initialBillRows(): BillRow[] {
  return DENOMINATIONS.map(d => ({ denomination: d, quantity: '' }))
}

interface Props {
  onConfirmed: () => void
  onCancel: () => void
}

export default function CloseShiftScreen({ onConfirmed, onCancel }: Props) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [safeAmountRaw, setSafeAmountRaw] = useState('')
  const [deliveredAmountRaw, setDeliveredAmountRaw] = useState('')
  const [deliveredTo, setDeliveredTo] = useState('')
  const [notes, setNotes] = useState('')
  const [billRows, setBillRows] = useState<BillRow[]>(initialBillRows)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void window.hw.getShiftSummary().then(r => {
      if (r.ok) setSummary(r.data)
      else setLoadError(r.error)
    })
  }, [])

  /** Total contado en billetes */
  const countedCash = billRows.reduce((acc, r) => {
    const qty = parseNumericInput(r.quantity) ?? 0
    return acc + r.denomination * qty
  }, 0)

  /** Diferencia: positiva = sobrante, negativa = faltante */
  const diff = summary ? countedCash - summary.cashInHand : null

  function updateBillRow(denomination: number, quantity: string) {
    setBillRows(prev => prev.map(r => r.denomination === denomination ? { ...r, quantity } : r))
  }

  async function handleConfirm() {
    if (countedCash < 0) {
      setSaveError('El conteo de billetes no puede ser negativo.')
      return
    }

    setSaving(true)
    setSaveError(null)

    const safeAmount = parseNumericInput(safeAmountRaw) ?? undefined
    const deliveredAmount = parseNumericInput(deliveredAmountRaw) ?? undefined

    const billDenominations = billRows
      .map(r => ({ denomination: r.denomination, quantity: parseNumericInput(r.quantity) ?? 0 }))
      .filter(r => r.quantity > 0)

    const r = await window.hw.closeShift({
      closingCash: countedCash > 0 ? countedCash : undefined,
      safeAmount,
      deliveredAmount,
      deliveredTo: deliveredTo.trim() || undefined,
      notes: notes.trim() || undefined,
      billDenominations: billDenominations.length > 0 ? billDenominations : undefined,
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
    <div className="min-h-screen bg-gray-950 text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Turno" value={shiftLabel} />
              <Stat label="Apertura" value={startedFormatted} />
              <Stat label="Efectivo inicial" value={fmt(summary.openingCash)} />
              <Stat label="Ventas" value={String(summary.salesCount)} />
              <Stat label="Total vendido" value={fmt(summary.totalRevenue)} />
              <Stat label="Cobrado en efectivo" value={fmt(summary.totalCashSales)} />
              <Stat label="Gastos en efectivo" value={fmt(summary.totalExpenses)} />
              <Stat label="Efectivo esperado" value={fmt(summary.cashInHand)} highlight />
            </div>
          ) : (
            <p className="text-gray-500 text-sm animate-pulse">Cargando resumen…</p>
          )}
        </div>

        {/* Grilla de denominaciones */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Conteo de billetes</h2>
            <span className="text-sm font-semibold text-white">Total contado: <span className="text-emerald-400">{fmt(countedCash)}</span></span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {billRows.map(row => (
              <div key={row.denomination} className="flex items-center gap-2">
                <span className="w-24 text-sm text-gray-300 font-medium text-right">
                  {row.denomination >= 1000
                    ? `$${row.denomination / 1000}K`
                    : `$${row.denomination}`}
                </span>
                <span className="text-xs text-gray-500">×</span>
                <NumericInput
                  value={row.quantity}
                  onChange={v => updateBillRow(row.denomination, v)}
                  placeholder="0"
                  className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-center"
                />
                <span className="text-xs text-gray-500 w-24 text-right">
                  {parseNumericInput(row.quantity) ? fmt(row.denomination * (parseNumericInput(row.quantity) ?? 0)) : ''}
                </span>
              </div>
            ))}
          </div>

          {/* Diferencia */}
          {summary && countedCash > 0 && diff !== null && (
            <div className={`rounded-lg px-4 py-3 text-sm font-semibold ${
              diff === 0
                ? 'bg-emerald-900/40 text-emerald-300'
                : diff > 0
                ? 'bg-blue-900/40 text-blue-300'
                : 'bg-red-900/40 text-red-300'
            }`}>
              {diff === 0
                ? '✓ Caja cuadrada — no hay diferencia'
                : diff > 0
                ? `▲ Sobrante: ${fmt(diff)} (hay más efectivo del esperado)`
                : `▼ Faltante: ${fmt(Math.abs(diff))} (hay menos efectivo del esperado)`}
            </div>
          )}
        </div>

        {/* Datos adicionales */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Datos adicionales</h2>

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

        <div className="flex gap-3 pb-6">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleConfirm()}
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

function fmt(n: number) {
  return `$${n.toLocaleString('es-AR')}`
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
      <p className={`text-base font-semibold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}
