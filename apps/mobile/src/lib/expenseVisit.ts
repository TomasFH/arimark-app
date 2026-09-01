/**
 * Cálculo de una visita a proveedor (misma regla que ExpenseModal de PC,
 * sin deuda cross-local).
 *
 * `amount` que sale de caja = min(entregado, total visita).
 * El exceso sobre la visita va al ledger como `paysOldDebt` (cancela deuda
 * o genera saldo a favor). La diferencia visita − entregado es deuda nueva.
 */

export interface ProviderVisitInput {
  visitTotal: number
  delivered: number
  /** Positivo = le debemos. Negativo = saldo a favor. */
  previousBalance: number
}

export interface ProviderVisitResult {
  amountForVisit: number
  newDebtAmount: number
  paysOldDebt: number
  previousDebt: number
  previousCredit: number
  creditAppliedToVisit: number
  displayedNewDebt: number
  excessOverVisit: number
  finalBalance: number
}

export function computeProviderVisit(input: ProviderVisitInput): ProviderVisitResult {
  const visitTotal = Math.max(0, input.visitTotal)
  const delivered = Math.max(0, input.delivered)
  const previousBalance = input.previousBalance

  const amountForVisit = Math.min(delivered, visitTotal)
  const newDebtAmount = Math.max(0, visitTotal - delivered)
  const previousDebt = Math.max(0, previousBalance)
  const previousCredit = Math.max(0, -previousBalance)
  const creditAppliedToVisit = Math.min(previousCredit, newDebtAmount)
  const displayedNewDebt = Math.max(0, newDebtAmount - creditAppliedToVisit)
  const excessOverVisit = Math.max(0, delivered - visitTotal)
  const paysOldDebt = excessOverVisit
  const finalBalance = previousBalance + visitTotal - delivered

  return {
    amountForVisit,
    newDebtAmount,
    paysOldDebt,
    previousDebt,
    previousCredit,
    creditAppliedToVisit,
    displayedNewDebt,
    excessOverVisit,
    finalBalance,
  }
}

export function debtEventId(expenseId: string, type: 'debt' | 'payment'): string {
  return `${expenseId}:${type}`
}
