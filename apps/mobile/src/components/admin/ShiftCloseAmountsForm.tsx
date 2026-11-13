/**
 * «Quedó en la caja» y «Se retiró» en el celu.
 * Un campo vacío no se manda. Un cero tipeado se manda como 0.
 */
import { useState } from 'react'
import { amountPatch } from '@carniceria/shared'
import NumericInput from '../NumericInput'
import { formatIntegerWithDots, parseNumericInput } from '../../lib/numericInput'

interface Props {
  mode: 'close' | 'correct'
  initialCashLeft?: number | null
  initialWithdrawn?: number | null
  submitLabel: string
  onSubmit: (patch: { cashLeft?: number; withdrawn?: number }) => Promise<void>
}

function initialAmount(value: number | null | undefined): string {
  if (value == null) return ''
  return formatIntegerWithDots(String(value))
}

const FIELD = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none'

export default function ShiftCloseAmountsForm({
  mode,
  initialCashLeft = null,
  initialWithdrawn = null,
  submitLabel,
  onSubmit,
}: Props) {
  const [cashLeft, setCashLeft] = useState(() => initialAmount(initialCashLeft))
  const [withdrawn, setWithdrawn] = useState(() => initialAmount(initialWithdrawn))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    const patch = amountPatch(parseNumericInput(cashLeft), parseNumericInput(withdrawn))
    if (mode === 'correct' && patch.cashLeft === undefined && patch.withdrawn === undefined) {
      setError('Escribí un monto.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit(patch)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <label className="block min-w-0 space-y-1" htmlFor="cash-left">
          <span className="block truncate text-sm font-medium text-zinc-100" title="Quedó en la caja">Quedó en la caja</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500" aria-hidden="true">$</span>
            <NumericInput id="cash-left" value={cashLeft} onChange={setCashLeft} disabled={saving} className={FIELD} />
          </span>
        </label>
        <label className="block min-w-0 space-y-1" htmlFor="cash-withdrawn">
          <span className="block truncate text-sm font-medium text-zinc-100" title="Se retiró">Se retiró</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500" aria-hidden="true">$</span>
            <NumericInput id="cash-withdrawn" value={withdrawn} onChange={setWithdrawn} disabled={saving} className={FIELD} />
          </span>
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={saving}
        className="w-full rounded-lg bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-zinc-950 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : submitLabel}
      </button>
    </div>
  )
}
