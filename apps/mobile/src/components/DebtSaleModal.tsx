/**
 * Fiado offline: cliente nuevo (nombre + teléfono opcional) y pago inicial.
 * No busca clientes en Firestore.
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
  onConfirm: (payload: {
    customerName: string
    customerPhone: string | null
    payments: SalePaymentDraft[]
    notes: string
  }) => void
  onCancel: () => void
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(n)
}

export function DebtSaleModal({ total, onConfirm, onCancel }: Props) {
  useBackLayer(true, onCancel)
  const keyboardInset = useKeyboardInset()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [amounts, setAmounts] = useState<Record<PaymentMethod, string>>(EMPTY_PAYMENT_AMOUNTS)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const settled = settleSalePayments(total, amounts, { allowPartial: true })

  function handleConfirm() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('El nombre es obligatorio.')
      return
    }
    if (!settled.canConfirm) {
      setError('El pago inicial no puede superar el total (salvo vuelto en efectivo).')
      return
    }
    onConfirm({
      customerName: trimmed.slice(0, 100),
      customerPhone: phone.trim() ? phone.trim().slice(0, 30) : null,
      payments: settled.payments,
      notes,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/80"
      style={{ paddingBottom: keyboardInset }}
    >
      <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-white" title="Fiado">
            📒 Fiado
          </h2>
          <button type="button" onClick={onCancel} className="shrink-0 text-2xl leading-none text-gray-400 hover:text-white">
            ×
          </button>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-gray-800 px-4 py-3">
          <span className="text-sm text-gray-300">Total</span>
          <span className="text-xl font-bold text-white">{formatARS(total)}</span>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-400">Nombre</label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value.slice(0, 100)); setError(null) }}
            maxLength={100}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Nombre del cliente"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-400">Teléfono (opcional)</label>
          <input
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value.slice(0, 30))}
            maxLength={30}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder="Sin buscar en la nube"
          />
        </div>

        <p className="text-xs text-gray-400">
          Pago ahora (opcional). Vacío = no pagó nada. El resto queda como deuda.
        </p>

        <PaymentMethodFields total={total} amounts={amounts} onChange={setAmounts} />

        <div>
          <label className="mb-1 block text-xs text-gray-400">Nota (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 200))}
            maxLength={200}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder="Observaciones…"
          />
        </div>

        {settled.change > 0 ? (
          <div className="rounded-xl border border-green-700/50 bg-green-900/20 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-green-300">Vuelto a entregar</span>
              <span className="text-xl font-bold text-green-400">{formatARS(settled.change)}</span>
            </div>
            <p className="mt-1 text-xs text-green-500/80">
              Se registra pago de {formatARS(total)}; el resto se devuelve.
            </p>
          </div>
        ) : settled.mixedOverage ? (
          <p className="text-center text-sm font-medium text-yellow-400">
            Sobran {formatARS(-settled.remaining)}
          </p>
        ) : settled.remaining > 0.5 ? (
          <p className="text-center text-sm font-medium text-orange-400">
            Deuda {formatARS(settled.remaining)}
            {settled.payments.length > 0
              ? ` · paga ahora ${formatARS(settled.payments.reduce((s, p) => s + p.amount, 0))}`
              : ''}
          </p>
        ) : (
          <p className="text-center text-sm font-medium text-emerald-400">
            Paga el total ahora (queda registrada como fiado)
          </p>
        )}

        {error && (
          <p className="text-center text-sm font-medium text-orange-400">{error}</p>
        )}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={settled.mixedOverage}
          className="w-full rounded-xl bg-amber-700 px-4 py-4 text-lg font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-700"
        >
          Confirmar fiado
        </button>
      </div>
    </div>
  )
}
