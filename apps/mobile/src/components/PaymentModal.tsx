/**
 * Modal de pago para el POS móvil.
 * Campos vacíos; cada medio tiene un botón para cubrir el resto (como en PC).
 */
import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import NumericInput from './NumericInput'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'
import { paidTotal, remainderForField } from '../lib/paymentSplit'
import type { PaymentMethod, SalePaymentDraft } from '../types/pos'

interface Props {
  total: number
  onConfirm: (payments: SalePaymentDraft[], notes: string) => void
  onCancel: () => void
}

const METHODS: { id: PaymentMethod; label: string; icon: string }[] = [
  { id: 'cash',   label: 'Efectivo',  icon: '💵' },
  { id: 'debit',  label: 'Débito',    icon: '💳' },
  { id: 'wallet', label: 'Billetera', icon: '📱' },
  { id: 'credit', label: 'Crédito',   icon: '🏦' },
]

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

const EMPTY: Record<PaymentMethod, string> = {
  cash: '', debit: '', wallet: '', credit: '',
}

export function PaymentModal({ total, onConfirm, onCancel }: Props) {
  useBackLayer(true, onCancel)
  const keyboardInset = useKeyboardInset()
  const [amounts, setAmounts] = useState<Record<PaymentMethod, string>>(EMPTY)
  const [notes, setNotes] = useState('')

  const paid = paidTotal(amounts)
  const remaining = Math.round((total - paid) * 100) / 100
  const isReady = Math.abs(remaining) < 0.5

  function fillRemainder(method: PaymentMethod) {
    const rem = remainderForField(total, amounts, method)
    if (rem <= 0) return
    setAmounts(prev => ({ ...prev, [method]: formatNumericInputValue(String(rem)) }))
  }

  function handleConfirm() {
    const payments: SalePaymentDraft[] = METHODS
      .map(m => ({ paymentMethod: m.id, amount: parseNumericInput(amounts[m.id]) ?? 0 }))
      .filter(p => p.amount > 0)
    onConfirm(payments, notes)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Cobro</h2>
          <button type="button" onClick={onCancel} className="text-2xl leading-none text-gray-400 hover:text-white">×</button>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-gray-800 px-4 py-3">
          <span className="text-sm text-gray-300">Total</span>
          <span className="text-xl font-bold text-white">{formatARS(total)}</span>
        </div>

        <div className="space-y-3">
          {METHODS.map(m => {
            const rem = remainderForField(total, amounts, m.id)
            const thisAmount = parseNumericInput(amounts[m.id]) ?? 0
            const showFill = !isReady && rem > 0 && thisAmount <= 0
            return (
              <div key={m.id} className="flex min-w-0 items-end gap-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-xl">
                  {m.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <label className="mb-0.5 block truncate text-xs text-gray-400">{m.label}</label>
                  <NumericInput
                    value={amounts[m.id]}
                    onChange={v => setAmounts(prev => ({ ...prev, [m.id]: v }))}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="0"
                  />
                </div>
                {showFill && (
                  <button
                    type="button"
                    onClick={() => fillRemainder(m.id)}
                    className="shrink-0 rounded-lg border border-gray-600 bg-gray-800 px-2 py-2 text-[11px] font-semibold text-gray-300"
                    title="Completar con el monto restante"
                  >
                    ← {formatARS(rem)}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-400">Nota (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 200))}
            maxLength={200}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder="Observaciones..."
          />
        </div>

        {!isReady && (
          <div className={`text-center text-sm font-medium ${remaining > 0 ? 'text-orange-400' : 'text-yellow-400'}`}>
            {remaining > 0 ? `Faltan ${formatARS(remaining)}` : `Sobran ${formatARS(-remaining)}`}
          </div>
        )}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!isReady}
          className="w-full rounded-xl bg-red-600 px-4 py-4 text-lg font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-700"
        >
          Confirmar venta
        </button>
      </div>
    </div>
  )
}
