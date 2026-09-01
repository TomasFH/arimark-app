import { describe, it, expect } from 'vitest'
import { buildCloseShiftRecapLines, formatRecapMoney, type CloseRecapInput } from '../closeShiftRecap'

function base(over: Partial<CloseRecapInput> = {}): CloseRecapInput {
  return {
    shiftType: 'morning',
    salesCount: 3,
    totalRevenue: 10000,
    totalCashSales: 8000,
    totalDebitSales: 0,
    totalWalletSales: 0,
    totalCreditSales: 0,
    totalExpenses: 0,
    totalCashInjects: 0,
    totalCashDebtPayments: 0,
    debtsCount: 0,
    totalDebts: 0,
    depositsCount: 0,
    totalCashDeposits: 0,
    totalDebitDeposits: 0,
    totalWalletDeposits: 0,
    totalCreditDeposits: 0,
    totalDigitalDeposits: 0,
    cashInHand: 15000,
    deliveredAmount: 0,
    deliveredTo: '',
    countedRegister: 0,
    diff: 0,
    notes: '',
    ...over,
  }
}

describe('buildCloseShiftRecapLines', () => {
  it('siempre incluye turno, ventas, total y efectivo esperado', () => {
    const lines = buildCloseShiftRecapLines(base())
    expect(lines.find(l => l.label === 'Turno')?.value).toBe('Mañana')
    expect(lines.find(l => l.label === 'Ventas')?.value).toBe('3')
    expect(lines.find(l => l.label === 'Total vendido')?.value).toBe(formatRecapMoney(10000))
    expect(lines.find(l => l.label === 'Efectivo esperado')?.tone).toBe('emphasis')
  })

  it('omite medios en cero y agrega diferencia de arqueo', () => {
    const empty = buildCloseShiftRecapLines(base())
    expect(empty.some(l => l.label.includes('Débito'))).toBe(false)

    const withDiff = buildCloseShiftRecapLines(base({
      totalDebitSales: 2000,
      countedRegister: 14000,
      diff: -1000,
    }))
    expect(withDiff.find(l => l.label === 'Cobrado con Débito')?.value).toBe(formatRecapMoney(2000))
    expect(withDiff.find(l => l.label === 'Faltante')?.tone).toBe('bad')
  })

  it('muestra caja cuadrada y entrega', () => {
    const lines = buildCloseShiftRecapLines(base({
      deliveredAmount: 5000,
      deliveredTo: 'Admin',
      countedRegister: 10000,
      diff: 0,
      notes: 'Todo ok',
    }))
    expect(lines.find(l => l.label === 'Entregado a Admin')).toBeTruthy()
    expect(lines.find(l => l.label === 'Caja')?.value).toBe('Cuadrada')
    expect(lines.find(l => l.label === 'Notas')?.value).toBe('Todo ok')
  })

  it('incluye gastos, ingresos, fiados, señas y sobrante', () => {
    const lines = buildCloseShiftRecapLines(base({
      shiftType: 'evening',
      totalWalletSales: 1000,
      totalCreditSales: 500,
      totalExpenses: 2000,
      totalCashInjects: 1500,
      totalCashDebtPayments: 300,
      debtsCount: 2,
      totalDebts: 4000,
      depositsCount: 3,
      totalCashDeposits: 1000,
      totalDebitDeposits: 200,
      totalWalletDeposits: 100,
      totalCreditDeposits: 50,
      totalDigitalDeposits: 350,
      countedRegister: 16000,
      diff: 1000,
    }))
    expect(lines.find(l => l.label === 'Turno')?.value).toBe('Tarde')
    expect(lines.find(l => l.label === 'Cobrado Billetera Virtual')).toBeTruthy()
    expect(lines.find(l => l.label === 'Cobrado con Crédito')).toBeTruthy()
    expect(lines.find(l => l.label === 'Gastos')).toBeTruthy()
    expect(lines.find(l => l.label === 'Ingresos')).toBeTruthy()
    expect(lines.find(l => l.label === 'Cobranzas de fiado (efectivo)')).toBeTruthy()
    expect(lines.find(l => l.label === 'Fiados (2)')).toBeTruthy()
    expect(lines.find(l => l.label === 'Señas (3)')).toBeTruthy()
    expect(lines.find(l => l.label === 'Señas en efectivo')?.indent).toBe(true)
    expect(lines.find(l => l.label === 'Señas Débito')).toBeTruthy()
    expect(lines.find(l => l.label === 'Señas Billetera Virtual')).toBeTruthy()
    expect(lines.find(l => l.label === 'Señas Crédito')).toBeTruthy()
    expect(lines.find(l => l.label === 'Sobrante')?.tone).toBe('info')
  })
})
