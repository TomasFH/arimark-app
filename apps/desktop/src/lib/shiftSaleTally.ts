import type { PaymentMethod } from './paymentMethod'

const DIGITAL_METHODS = ['debit', 'wallet', 'credit'] as const

export interface SalePaySlice {
  status: string
  total: number
  payments: Array<{ method: PaymentMethod; amount: number }>
}

export interface MethodTally {
  amount: number
  sales: number
}

export interface ShiftCollectionTally {
  saleCount: number
  total: number
  cashAmount: number
  cashSales: number
  digitalAmount: number
  digitalSales: number
  byMethod: Record<(typeof DIGITAL_METHODS)[number], MethodTally>
}

/** Cuenta ventas confirmadas. Una mezcla suma en efectivo y en digital, y en cada medio que usó. */
export function tallyShiftCollections(sales: SalePaySlice[]): ShiftCollectionTally {
  const tally: ShiftCollectionTally = {
    saleCount: 0,
    total: 0,
    cashAmount: 0,
    cashSales: 0,
    digitalAmount: 0,
    digitalSales: 0,
    byMethod: {
      debit: { amount: 0, sales: 0 },
      wallet: { amount: 0, sales: 0 },
      credit: { amount: 0, sales: 0 },
    },
  }

  for (const sale of sales) {
    if (sale.status !== 'confirmed') continue
    tally.saleCount += 1
    tally.total += sale.total
    const methods = new Set(sale.payments.map(pay => pay.method))
    if (methods.has('cash')) tally.cashSales += 1
    if (DIGITAL_METHODS.some(method => methods.has(method))) tally.digitalSales += 1
    for (const pay of sale.payments) {
      if (pay.method === 'cash') tally.cashAmount += pay.amount
      else tally.byMethod[pay.method].amount += pay.amount
    }
    for (const method of DIGITAL_METHODS) {
      if (methods.has(method)) tally.byMethod[method].sales += 1
    }
  }

  tally.digitalAmount = tally.byMethod.debit.amount + tally.byMethod.wallet.amount + tally.byMethod.credit.amount
  return tally
}

export function ventaCountLabel(count: number): string {
  return count === 1 ? '1 venta' : `${count} ventas`
}
