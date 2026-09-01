/**
 * Líneas del resumen que se muestra DESPUÉS de confirmar el cierre de caja.
 * La pregunta “¿cerrar?” es otro modal; este es el recap post-cierre.
 */
export interface CloseRecapLine {
  label: string
  value: string
  indent?: boolean
  tone?: 'default' | 'emphasis' | 'ok' | 'info' | 'bad'
}

export function formatRecapMoney(n: number): string {
  return `$${n.toLocaleString('es-AR')}`
}

export interface CloseRecapInput {
  shiftType: 'morning' | 'evening'
  salesCount: number
  totalRevenue: number
  totalCashSales: number
  totalDebitSales: number
  totalWalletSales: number
  totalCreditSales: number
  totalExpenses: number
  totalCashInjects: number
  totalCashDebtPayments: number
  debtsCount: number
  totalDebts: number
  depositsCount: number
  totalCashDeposits: number
  totalDebitDeposits: number
  totalWalletDeposits: number
  totalCreditDeposits: number
  totalDigitalDeposits: number
  cashInHand: number
  deliveredAmount: number
  deliveredTo: string
  countedRegister: number
  diff: number
  notes: string
}

export function buildCloseShiftRecapLines(input: CloseRecapInput): CloseRecapLine[] {
  const lines: CloseRecapLine[] = [
    { label: 'Turno', value: input.shiftType === 'morning' ? 'Mañana' : 'Tarde' },
    { label: 'Ventas', value: String(input.salesCount) },
    { label: 'Total vendido', value: formatRecapMoney(input.totalRevenue) },
    { label: 'Cobrado en efectivo', value: formatRecapMoney(input.totalCashSales) },
  ]

  if (input.totalDebitSales > 0) {
    lines.push({ label: 'Cobrado con Débito', value: formatRecapMoney(input.totalDebitSales) })
  }
  if (input.totalWalletSales > 0) {
    lines.push({ label: 'Cobrado Billetera Virtual', value: formatRecapMoney(input.totalWalletSales) })
  }
  if (input.totalCreditSales > 0) {
    lines.push({ label: 'Cobrado con Crédito', value: formatRecapMoney(input.totalCreditSales) })
  }
  if (input.totalExpenses > 0) {
    lines.push({ label: 'Gastos', value: formatRecapMoney(input.totalExpenses) })
  }
  if (input.totalCashInjects > 0) {
    lines.push({ label: 'Ingresos', value: formatRecapMoney(input.totalCashInjects) })
  }
  if (input.totalCashDebtPayments > 0) {
    lines.push({ label: 'Cobranzas de fiado (efectivo)', value: formatRecapMoney(input.totalCashDebtPayments) })
  }
  if (input.debtsCount > 0) {
    lines.push({
      label: `Fiados (${input.debtsCount})`,
      value: formatRecapMoney(input.totalDebts),
    })
  }
  if (input.depositsCount > 0) {
    lines.push({
      label: `Señas (${input.depositsCount})`,
      value: formatRecapMoney(input.totalCashDeposits + input.totalDigitalDeposits),
    })
    if (input.totalCashDeposits > 0) {
      lines.push({ label: 'Señas en efectivo', value: formatRecapMoney(input.totalCashDeposits), indent: true })
    }
    if (input.totalDebitDeposits > 0) {
      lines.push({ label: 'Señas Débito', value: formatRecapMoney(input.totalDebitDeposits), indent: true })
    }
    if (input.totalWalletDeposits > 0) {
      lines.push({ label: 'Señas Billetera Virtual', value: formatRecapMoney(input.totalWalletDeposits), indent: true })
    }
    if (input.totalCreditDeposits > 0) {
      lines.push({ label: 'Señas Crédito', value: formatRecapMoney(input.totalCreditDeposits), indent: true })
    }
  }

  lines.push({
    label: 'Efectivo esperado',
    value: formatRecapMoney(input.cashInHand),
    tone: 'emphasis',
  })

  if (input.deliveredAmount > 0) {
    lines.push({
      label: input.deliveredTo ? `Entregado a ${input.deliveredTo}` : 'Monto entregado',
      value: formatRecapMoney(input.deliveredAmount),
    })
  }
  if (input.countedRegister > 0) {
    lines.push({ label: 'Contado en caja', value: formatRecapMoney(input.countedRegister) })
    if (input.diff === 0) {
      lines.push({ label: 'Caja', value: 'Cuadrada', tone: 'ok' })
    } else if (input.diff > 0) {
      lines.push({ label: 'Sobrante', value: formatRecapMoney(input.diff), tone: 'info' })
    } else {
      lines.push({ label: 'Faltante', value: formatRecapMoney(Math.abs(input.diff)), tone: 'bad' })
    }
  }
  if (input.notes) {
    lines.push({ label: 'Notas', value: input.notes })
  }

  return lines
}
