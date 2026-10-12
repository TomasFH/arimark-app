/**
 * Invariante de caja: `expenses.amount` es toda la plata que salió del turno.
 * `amount` del payload es la porción de la visita o del concepto.
 * `paysOldDebt` es solo el ledger (exceso sobre esa porción) y también salió hoy:
 * el impago no había restado caja el día que se generó.
 */

export function expenseCashAmount(visitOrConceptAmount: number, paysOldDebt?: number): number {
  return visitOrConceptAmount + (paysOldDebt ?? 0)
}

export interface OldDebtPaymentSlice {
  storeId: string
  amount: number
}

/**
 * Reparte el ledger de `paysOldDebt`.
 * Sin `crossStorePayment`, todo el exceso va a `debtStoreId` (o al local de la sesión).
 * Con `crossStorePayment`, esa parte queda en el otro local y el resto en la sesión:
 * el exceso de este local no se imputa al `debtStoreId` ajeno.
 */
export function splitOldDebtPayments(input: {
  paysOldDebt?: number
  sessionStoreId: string
  debtStoreId?: string
  crossStorePayment?: number
}): OldDebtPaymentSlice[] {
  const total = input.paysOldDebt ?? 0
  if (!(total > 0)) return []

  const targetStoreId = input.debtStoreId ?? input.sessionStoreId
  const splitting = input.crossStorePayment != null
    && input.debtStoreId != null
    && input.debtStoreId !== input.sessionStoreId
  if (!splitting) {
    return [{ storeId: targetStoreId, amount: total }]
  }

  const foreign = Math.min(input.crossStorePayment ?? 0, total)
  const local = total - foreign
  const slices: OldDebtPaymentSlice[] = []
  if (foreign > 0) slices.push({ storeId: input.debtStoreId!, amount: foreign })
  if (local > 0) slices.push({ storeId: input.sessionStoreId, amount: local })
  return slices
}

export function crossStorePaymentFits(data: { paysOldDebt?: number; crossStorePayment?: number }): boolean {
  if (data.crossStorePayment == null) return true
  return data.crossStorePayment <= (data.paysOldDebt ?? 0)
}
