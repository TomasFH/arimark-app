/**
 * «Quedó en la caja» y «Se retiró».
 * Un campo vacío no se manda. Un cero tipeado se manda como 0.
 */
import { useState } from 'react'
import { amountPatch } from '@carniceria/shared'
import NumericInput from './NumericInput'
import { Button } from './ui'
import { parseNumericInput } from '../lib/numericInput'
import { cashAmountToInput } from '../lib/billCountUi'

interface Props {
  mode: 'close' | 'correct'
  initialCashLeft?: number | null
  initialWithdrawn?: number | null
  submitLabel: string
  disabled?: boolean
  onSubmit: (patch: { cashLeft?: number; withdrawn?: number }) => Promise<void> | void
}

function initialAmount(value: number | null | undefined): string {
  if (value == null) return ''
  return cashAmountToInput(value)
}

const FIELD = 'w-full rounded-lg border border-line bg-input py-2.5 pl-8 pr-3 text-sm text-ink placeholder:text-subtle focus:border-line-accent focus:outline-none'

export default function ShiftCloseAmountsForm({
  mode,
  initialCashLeft = null,
  initialWithdrawn = null,
  submitLabel,
  disabled = false,
  onSubmit,
}: Props) {
  const [cashLeft, setCashLeft] = useState(() => initialAmount(initialCashLeft))
  const [withdrawn, setWithdrawn] = useState(() => initialAmount(initialWithdrawn))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    const left = parseNumericInput(cashLeft)
    const took = parseNumericInput(withdrawn)
    const patch = amountPatch(left, took)
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0 space-y-1" htmlFor="cash-left">
          <span className="block truncate text-sm font-medium text-ink" title="Quedó en la caja">Quedó en la caja</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden="true">$</span>
            <NumericInput
              id="cash-left"
              value={cashLeft}
              onChange={setCashLeft}
              disabled={disabled || saving}
              className={FIELD}
            />
          </span>
        </label>
        <label className="block min-w-0 space-y-1" htmlFor="cash-withdrawn">
          <span className="block truncate text-sm font-medium text-ink" title="Se retiró">Se retiró</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden="true">$</span>
            <NumericInput
              id="cash-withdrawn"
              value={withdrawn}
              onChange={setWithdrawn}
              disabled={disabled || saving}
              className={FIELD}
            />
          </span>
        </label>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="button" onClick={() => void handleSubmit()} loading={saving} disabled={disabled}>
        {submitLabel}
      </Button>
    </div>
  )
}
