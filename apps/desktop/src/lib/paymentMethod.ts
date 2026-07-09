/** Etiquetas y estilos de los medios de pago, compartidos entre vistas de ventas. */
export type PaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera',
  credit: 'Crédito',
}

export const PAYMENT_SHORT: Record<PaymentMethod, string> = {
  cash: '💵',
  debit: '💳',
  wallet: '📱',
  credit: '💳',
}

/** Resume los medios de pago de una venta en una etiqueta legible. */
export function summarizePaymentMethods(methods: PaymentMethod[]): string {
  const unique = [...new Set(methods)]
  if (unique.length === 0) return '—'
  if (unique.length === 1) return PAYMENT_LABELS[unique[0]!]
  return 'Combinado'
}
