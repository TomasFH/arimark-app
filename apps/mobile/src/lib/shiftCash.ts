/**
 * Efectivo esperado en caja del POS móvil.
 * Por ahora: apertura + ventas en efectivo del turno.
 * (El celu todavía no registra gastos/vales/señas; cuando existan, sumar acá.)
 */
export function cashFromPayments(
  payments: Array<{ paymentMethod: string; amount: number }>,
): number {
  return payments.reduce((sum, p) => (p.paymentMethod === 'cash' ? sum + p.amount : sum), 0)
}

export function expectedCashInHand(
  openingCash: number,
  sales: Array<{ payments: Array<{ paymentMethod: string; amount: number }> }>,
): number {
  return sales.reduce((sum, sale) => sum + cashFromPayments(sale.payments), openingCash)
}

export function shiftRevenue(sales: Array<{ total: number }>): number {
  return sales.reduce((sum, sale) => sum + sale.total, 0)
}
