export const INJECT_REASONS = ['aporte', 'wallet_cash'] as const

export type InjectReason = (typeof INJECT_REASONS)[number]

export const INJECT_REASON_LABELS: Record<InjectReason, string> = {
  aporte: 'Aporte',
  wallet_cash: 'Efectivo por digital',
}

export function coerceInjectReason(value: unknown): InjectReason {
  return value === 'wallet_cash' ? 'wallet_cash' : 'aporte'
}

export function injectConceptForReason(reason: InjectReason): string {
  return INJECT_REASON_LABELS[reason]
}

/** Etiqueta de historial: columna nueva, o concept legado. */
export function injectHistoryLabel(
  reason: unknown,
  concept?: string | null,
): string {
  if (reason === 'wallet_cash' || concept === INJECT_REASON_LABELS.wallet_cash) {
    return INJECT_REASON_LABELS.wallet_cash
  }
  return INJECT_REASON_LABELS.aporte
}
