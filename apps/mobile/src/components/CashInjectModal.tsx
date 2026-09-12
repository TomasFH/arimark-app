/**
 * Modal de ingreso de efectivo a caja (emergencia).
 */
import { INJECT_REASON_LABELS, type InjectReason } from '@carniceria/shared'
import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'

interface Props {
  onConfirm: (payload: { amount: number; notes: string | null; injectReason: InjectReason }) => void
  onClose: () => void
}

export function CashInjectModal({ onConfirm, onClose }: Props) {
  useBackLayer(true, onClose)
  const keyboardInset = useKeyboardInset()
  const [amountRaw, setAmountRaw] = useState('')
  const [notes, setNotes] = useState('')
  const [injectReason, setInjectReason] = useState<InjectReason>('aporte')
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    const amount = parseNumericInput(amountRaw)
    if (amount === null || amount <= 0) {
      setError('Ingresá un monto mayor a 0.')
      return
    }
    onConfirm({
      amount,
      notes: notes.trim() ? notes.trim().slice(0, 200) : null,
      injectReason,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-white" title="Ingreso de efectivo">
            Ingreso de efectivo
          </h2>
          <button type="button" onClick={onClose} className="shrink-0 text-2xl leading-none text-gray-400 hover:text-white">
            ×
          </button>
        </div>

        <p className="text-sm text-gray-400">
          Suma el monto a la caja del turno. La acreditación digital se hace afuera de la app.
        </p>

        <fieldset className="space-y-2">
          <legend className="text-xs text-gray-400">Motivo</legend>
          <label className="flex items-start gap-2 rounded-lg border border-gray-700 px-3 py-2">
            <input
              type="radio"
              name="inject-reason"
              checked={injectReason === 'aporte'}
              onChange={() => setInjectReason('aporte')}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm text-white">{INJECT_REASON_LABELS.aporte}</span>
              <span className="block text-xs text-gray-500">Plata que mandan los admin.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-gray-700 px-3 py-2">
            <input
              type="radio"
              name="inject-reason"
              checked={injectReason === 'wallet_cash'}
              onChange={() => setInjectReason('wallet_cash')}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm text-white">{INJECT_REASON_LABELS.wallet_cash}</span>
              <span className="block text-xs text-gray-500">El cliente deja efectivo; la acreditación es afuera.</span>
            </span>
          </label>
        </fieldset>

        <div>
          <label className="mb-1 block text-xs text-gray-400">Monto</label>
          <NumericInput
            value={amountRaw}
            onChange={v => { setAmountRaw(v); setError(null) }}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="0"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-400">Nota (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 200))}
            maxLength={200}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder={injectReason === 'wallet_cash' ? 'Nombre del cliente (opcional)' : 'Observaciones…'}
          />
        </div>

        {error && (
          <p className="text-center text-sm font-medium text-orange-400">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-800 py-4 font-semibold text-white transition-colors hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-xl bg-emerald-700 py-4 font-bold text-white transition-colors hover:bg-emerald-600"
          >
            Sumar a caja
          </button>
        </div>
      </div>
    </div>
  )
}
