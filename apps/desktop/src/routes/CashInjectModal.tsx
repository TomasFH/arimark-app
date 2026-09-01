/**
 * Modal para registrar un ingreso de efectivo a caja durante el turno activo.
 * El monto entra a caja (suma en cashInHand); no se lista junto a los gastos.
 */
import { useEffect, useRef, useState } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'

interface Props {
  onCancel: () => void
  /** Tras guardar: refresca el saldo de caja. */
  onSaved: () => void
}

export default function CashInjectModal({ onCancel, onSaved }: Props) {
  const [amountRaw, setAmountRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onCancel])

  async function handleSubmit() {
    const amount = parseNumericInput(amountRaw)
    if (!amount || amount <= 0) {
      setError('Ingresá un monto válido.')
      return
    }

    setSaving(true)
    setError(null)
    const r = await window.hw.registerCashInject({
      amount,
      notes: notes.trim() || undefined,
    })
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onSaved()
    onCancel()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-overlay-fade">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-md shadow-xl space-y-4 p-6 border border-zinc-700">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold min-w-0 truncate" title="Ingreso de efectivo">
            Ingreso de efectivo
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="shrink-0 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 p-1"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-zinc-400">
          Suma el monto a la caja del turno.
        </p>

        <div className="space-y-1">
          <label className="text-sm text-zinc-400">Monto ($)</label>
          <NumericInput
            ref={amountRef}
            value={amountRaw}
            onChange={v => { setAmountRaw(v); setError(null) }}
            placeholder="0"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-zinc-400">Nota (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Quién aportó, motivo…"
            maxLength={200}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors disabled:opacity-40 text-sm"
          >
            {saving ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
