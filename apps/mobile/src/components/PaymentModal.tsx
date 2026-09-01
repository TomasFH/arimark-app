/**
 * Modal de pago para el POS móvil.
 * Campos vacíos; cada medio tiene un botón para cubrir el resto (como en PC).
 */
import { useState } from 'react'
import { useBackLayer } from '../lib/backStack'
import { useKeyboardInset } from '../lib/keyboardInset'
import { settleSalePayments } from '../lib/paymentSplit'
import {
  EMPTY_PAYMENT_AMOUNTS,
  PaymentMethodFields,
} from './PaymentMethodFields'
import type { PaymentMethod, SalePaymentDraft } from '../types/pos'

interface Props {
  total: number
  onConfirm: (payments: SalePaymentDraft[], notes: string) => void
  onCancel: () => void
  /** Abre el flujo de fiado (cierra este modal desde el padre). */
  onFiado?: () => void
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

export function PaymentModal({ total, onConfirm, onCancel, onFiado }: Props) {
  useBackLayer(true, onCancel)
  const keyboardInset = useKeyboardInset()
  const [amounts, setAmounts] = useState<Record<PaymentMethod, string>>(EMPTY_PAYMENT_AMOUNTS)
  const [notes, setNotes] = useState('')

  const settled = settleSalePayments(total, amounts)

  function handleConfirm() {
    if (!settled.canConfirm) return
    onConfirm(settled.payments, notes)
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

        <PaymentMethodFields total={total} amounts={amounts} onChange={setAmounts} />

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

        {settled.change > 0 && (
          <div className="rounded-xl border border-green-700/50 bg-green-900/20 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-green-300">Vuelto a entregar</span>
              <span className="text-xl font-bold text-green-400">{formatARS(settled.change)}</span>
            </div>
            <p className="mt-1 text-xs text-green-500/80">
              Se registra el cobro de {formatARS(total)}; el resto se devuelve.
            </p>
          </div>
        )}

        {!settled.canConfirm && settled.remaining > 0.5 && (
          <div className="text-center text-sm font-medium text-orange-400">
            Faltan {formatARS(settled.remaining)}
          </div>
        )}

        {settled.mixedOverage && (
          <div className="text-center text-sm font-medium text-yellow-400">
            Sobran {formatARS(-settled.remaining)}
          </div>
        )}

        {onFiado && (
          <button
            type="button"
            onClick={onFiado}
            className="w-full rounded-xl border border-gray-600 bg-gray-800 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-gray-700"
            title="El cliente se lleva la mercadería y paga después"
          >
            📒 Fiado
          </button>
        )}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!settled.canConfirm}
          className="w-full rounded-xl bg-red-600 px-4 py-4 text-lg font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-700"
        >
          Confirmar venta
        </button>
      </div>
    </div>
  )
}
