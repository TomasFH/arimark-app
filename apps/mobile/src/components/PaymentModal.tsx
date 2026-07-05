/**
 * Modal de pago para el POS móvil.
 * Permite cobrar con uno o varios medios de pago (efectivo, débito, billetera, crédito).
 * Espejo del PaymentModal del desktop, adaptado para pantalla de celular.
 */
import { useState } from 'react'
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

export function PaymentModal({ total, onConfirm, onCancel }: Props) {
  const [amounts, setAmounts] = useState<Record<PaymentMethod, string>>({
    cash: String(total), debit: '', wallet: '', credit: '',
  })
  const [notes, setNotes] = useState('')

  const paid = METHODS.reduce((s, m) => s + (parseFloat(amounts[m.id].replace(',', '.')) || 0), 0)
  const remaining = Math.round((total - paid) * 100) / 100
  const isReady = Math.abs(remaining) < 0.5

  function handleAmountChange(method: PaymentMethod, value: string) {
    const clean = value.replace(/[^0-9.,]/g, '')
    setAmounts(prev => ({ ...prev, [method]: clean }))
  }

  function handleConfirm() {
    const payments: SalePaymentDraft[] = METHODS
      .map(m => ({ paymentMethod: m.id, amount: parseFloat(amounts[m.id].replace(',', '.')) || 0 }))
      .filter(p => p.amount > 0)
    onConfirm(payments, notes)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end">
      <div className="w-full bg-gray-900 rounded-t-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Cobro</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="bg-gray-800 rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-gray-300 text-sm">Total</span>
          <span className="text-white font-bold text-xl">{formatARS(total)}</span>
        </div>

        <div className="space-y-3">
          {METHODS.map(m => (
            <div key={m.id} className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center text-xl shrink-0">
                {m.icon}
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-0.5">{m.label}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amounts[m.id]}
                  onChange={e => handleAmountChange(m.id, e.target.value)}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="0"
                />
              </div>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Nota (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder="Observaciones..."
          />
        </div>

        {!isReady && (
          <div className={`text-sm text-center font-medium ${remaining > 0 ? 'text-orange-400' : 'text-yellow-400'}`}>
            {remaining > 0 ? `Faltan ${formatARS(remaining)}` : `Sobran ${formatARS(-remaining)}`}
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={!isReady}
          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-xl px-4 py-4 text-lg transition-colors"
        >
          Confirmar venta
        </button>
      </div>
    </div>
  )
}
