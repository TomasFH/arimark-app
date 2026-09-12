/**
 * Modal para registrar un ingreso de efectivo a caja durante el turno activo.
 * El monto entra a caja (suma en cashInHand); no se lista junto a los gastos.
 */
import { useEffect, useRef, useState } from 'react'
import NumericInput from '../components/NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import { INJECT_REASON_LABELS, type InjectReason } from '@carniceria/shared'
import { Button, Modal } from '../components/ui'

interface Props {
  onCancel: () => void
  /** Tras guardar: refresca el saldo de caja. */
  onSaved: () => void
}

const fieldClass =
  'w-full rounded-xl border border-line bg-input px-3 py-2 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-line-accent'

export default function CashInjectModal({ onCancel, onSaved }: Props) {
  const [amountRaw, setAmountRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [injectReason, setInjectReason] = useState<InjectReason>('aporte')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    amountRef.current?.focus()
  }, [])

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
      injectReason,
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
    <Modal
      open
      onClose={onCancel}
      closeOnOverlay={!saving}
      closeOnEscape={!saving}
      title="Ingreso de efectivo"
      size="sm"
      footer={(
        <>
          <Button variant="secondary" className="mr-auto" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} loading={saving}>
            {saving ? 'Guardando…' : 'Registrar'}
          </Button>
        </>
      )}
    >
      <p className="mb-4 text-sm text-muted">
        Suma el monto a la caja del turno. La acreditación digital se hace afuera de la app.
      </p>

      <fieldset className="mb-4 space-y-2">
        <legend className="text-sm text-muted">Motivo</legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line px-3 py-2 hover:bg-hover">
          <input
            type="radio"
            name="inject-reason"
            checked={injectReason === 'aporte'}
            onChange={() => setInjectReason('aporte')}
            className="mt-1 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm text-ink">{INJECT_REASON_LABELS.aporte}</span>
            <span className="block text-xs text-muted">Plata que mandan los admin.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line px-3 py-2 hover:bg-hover">
          <input
            type="radio"
            name="inject-reason"
            checked={injectReason === 'wallet_cash'}
            onChange={() => setInjectReason('wallet_cash')}
            className="mt-1 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm text-ink">{INJECT_REASON_LABELS.wallet_cash}</span>
            <span className="block text-xs text-muted">El cliente deja efectivo; la acreditación es afuera.</span>
          </span>
        </label>
      </fieldset>

      <div className="mb-4 space-y-1">
        <label className="text-sm text-muted">Monto ($)</label>
        <NumericInput
          ref={amountRef}
          value={amountRaw}
          onChange={v => { setAmountRaw(v); setError(null) }}
          placeholder="0"
          className={fieldClass}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-muted">Nota (opcional)</label>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={injectReason === 'wallet_cash' ? 'Nombre del cliente (opcional)' : 'Quién aportó, motivo…'}
          maxLength={200}
          className={fieldClass}
        />
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  )
}
