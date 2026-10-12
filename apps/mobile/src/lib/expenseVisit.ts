/**
 * Cálculo de una visita a proveedor (misma regla que ExpenseModal de PC,
 * sin deuda cross-local).
 *
 * `cashOut` es la plata que sale de caja: el entregado (porción de la visita
 * más el exceso). `paysOldDebt` sigue siendo solo el exceso sobre la visita
 * y va al ledger. `amountForVisit` es lo aplicado a esta visita, no la caja.
 * La diferencia visita − entregado es deuda nueva.
 */

export interface ProviderVisitInput {
  visitTotal: number
  delivered: number
  /** Positivo = le debemos. Negativo = saldo a favor. */
  previousBalance: number
}

export interface ProviderVisitResult {
  /** Porción aplicada a esta visita. No incluye deuda vieja. */
  amountForVisit: number
  /** Plata que salió de caja: entregado = amountForVisit + paysOldDebt. */
  cashOut: number
  newDebtAmount: number
  /** Exceso sobre la visita. Solo ledger; ya está incluido en cashOut. */
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
  const cashOut = amountForVisit + paysOldDebt
  const finalBalance = previousBalance + visitTotal - delivered

  return {
    amountForVisit,
    cashOut,
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
