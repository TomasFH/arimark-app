/**
 * Efectivo esperado en caja del POS móvil.
 * Apertura + efectivo de ventas confirmadas − gastos + aportes.
 * Las ventas sin `status` (filas viejas) cuentan como confirmadas.
 */
export function cashFromPayments(
  payments: Array<{ paymentMethod: string; amount: number }>,
): number {
  return payments.reduce((sum, p) => (p.paymentMethod === 'cash' ? sum + p.amount : sum), 0)
}

export function resolvedSaleStatus(
  sale: { status?: string | null },
): 'confirmed' | 'cancelled' {
  return sale.status === 'cancelled' ? 'cancelled' : 'confirmed'
}

export function expectedCashInHand(
  openingCash: number,
  sales: Array<{
    payments: Array<{ paymentMethod: string; amount: number }>
    status?: string | null
  }>,
  expenses?: Array<{ kind?: string | null; amount: number }>,
): number {
  const fromSales = sales.reduce((sum, sale) => {
    if (resolvedSaleStatus(sale) === 'cancelled') return sum
    return sum + cashFromPayments(sale.payments)
  }, openingCash)

  if (!expenses || expenses.length === 0) return fromSales

  return expenses.reduce((sum, expense) => {
    if (expense.kind === 'inject') return sum + expense.amount
    return sum - expense.amount
  }, fromSales)
}

export function shiftRevenue(
  sales: Array<{ total: number; status?: string | null }>,
): number {
  return sales.reduce((sum, sale) => {
    if (resolvedSaleStatus(sale) === 'cancelled') return sum
    return sum + sale.total
  }, 0)
}
