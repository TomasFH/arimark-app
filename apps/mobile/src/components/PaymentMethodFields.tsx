/**
 * Campos de medios de pago (efectivo / débito / billetera / crédito)
 * con botón para cubrir el resto. Usado en cobro y fiado.
 */
import NumericInput from './NumericInput'
import { formatNumericInputValue, parseNumericInput } from '../lib/numericInput'
import { remainderForField } from '../lib/paymentSplit'
import type { PaymentMethod, SalePaymentDraft } from '../types/pos'

export const PAYMENT_METHOD_OPTIONS: { id: PaymentMethod; label: string; icon: string }[] = [
  { id: 'cash', label: 'Efectivo', icon: '💵' },
  { id: 'debit', label: 'Débito', icon: '💳' },
  { id: 'wallet', label: 'Billetera', icon: '📱' },
  { id: 'credit', label: 'Crédito', icon: '🏦' },
]

export const EMPTY_PAYMENT_AMOUNTS: Record<PaymentMethod, string> = {
  cash: '',
  debit: '',
  wallet: '',
  credit: '',
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(n)
}

export function amountsToPayments(amounts: Record<PaymentMethod, string>): SalePaymentDraft[] {
  return PAYMENT_METHOD_OPTIONS
    .map(m => ({ paymentMethod: m.id, amount: parseNumericInput(amounts[m.id]) ?? 0 }))
    .filter(p => p.amount > 0)
}

interface Props {
  total: number
  amounts: Record<PaymentMethod, string>
  onChange: (next: Record<PaymentMethod, string>) => void
}

export function PaymentMethodFields({ total, amounts, onChange }: Props) {
  const paid = PAYMENT_METHOD_OPTIONS.reduce(
    (sum, m) => sum + (parseNumericInput(amounts[m.id]) ?? 0),
    0,
  )
  const remaining = Math.round((total - paid) * 100) / 100
  const isCovered = Math.abs(remaining) < 0.5

  function fillRemainder(method: PaymentMethod) {
    const rem = remainderForField(total, amounts, method)
    if (rem <= 0) return
    onChange({ ...amounts, [method]: formatNumericInputValue(String(rem)) })
  }

  return (
    <div className="space-y-3">
      {PAYMENT_METHOD_OPTIONS.map(m => {
        const rem = remainderForField(total, amounts, m.id)
        const thisAmount = parseNumericInput(amounts[m.id]) ?? 0
        const showFill = !isCovered && rem > 0 && thisAmount <= 0
        return (
          <div key={m.id} className="flex min-w-0 items-end gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-xl">
              {m.icon}
            </div>
            <div className="min-w-0 flex-1">
              <label className="mb-0.5 block truncate text-xs text-gray-400" title={m.label}>
                {m.label}
              </label>
              <NumericInput
                value={amounts[m.id]}
                onChange={v => onChange({ ...amounts, [m.id]: v })}
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
  )
}
