import { describe, it, expect } from 'vitest'
import { expectedCashInHand, shiftRevenue, resolvedSaleStatus } from '../lib/shiftCash'

describe('shiftCash', () => {
  it('apertura + solo efectivo; débito no suma', () => {
    const sales = [
      { total: 15000, payments: [{ paymentMethod: 'cash', amount: 10000 }, { paymentMethod: 'debit', amount: 5000 }] },
      { total: 3000, payments: [{ paymentMethod: 'wallet', amount: 3000 }] },
    ]
    expect(expectedCashInHand(5000, sales)).toBe(15000)
    expect(shiftRevenue(sales)).toBe(18000)
  })

  it('sin ventas es el efectivo de apertura', () => {
    expect(expectedCashInHand(12000, [])).toBe(12000)
  })

  it('gastos restan y aportes suman', () => {
    const sales = [
      { total: 8000, payments: [{ paymentMethod: 'cash', amount: 8000 }] },
    ]
    const expenses = [
      { kind: 'expense', amount: 2000 },
      { kind: 'inject', amount: 1500 },
    ]
    expect(expectedCashInHand(5000, sales, expenses)).toBe(12500)
  })

  it('gasto sin kind se trata como expense', () => {
    expect(expectedCashInHand(10000, [], [{ amount: 3000 }])).toBe(7000)
  })

  it('ventas cancelled no suman caja ni revenue; sin status cuentan como confirmed', () => {
    const sales = [
      { total: 4000, payments: [{ paymentMethod: 'cash', amount: 4000 }] },
      { total: 9000, status: 'cancelled', payments: [{ paymentMethod: 'cash', amount: 9000 }] },
      { total: 2500, status: 'confirmed', payments: [{ paymentMethod: 'debit', amount: 2500 }] },
    ]
    expect(expectedCashInHand(1000, sales)).toBe(5000)
    expect(shiftRevenue(sales)).toBe(6500)
  })

  it('fiado: solo el pago inicial en efectivo suma caja; el resto no', () => {
    const sales = [
      {
        total: 20000,
        status: 'confirmed',
        isDebt: true,
        payments: [{ paymentMethod: 'cash', amount: 5000 }],
      },
    ]
    expect(expectedCashInHand(10000, sales)).toBe(15000)
    expect(shiftRevenue(sales)).toBe(20000)
  })

  it('resolvedSaleStatus trata filas viejas como confirmed', () => {
    expect(resolvedSaleStatus({})).toBe('confirmed')
    expect(resolvedSaleStatus({ status: 'confirmed' })).toBe('confirmed')
    expect(resolvedSaleStatus({ status: 'cancelled' })).toBe('cancelled')
    expect(resolvedSaleStatus({ status: 'in_progress' })).toBe('confirmed')
  })

  it('todas las ventas anuladas: caja = apertura ± movimientos de caja', () => {
    const sales = [
      { total: 9000, status: 'cancelled', payments: [{ paymentMethod: 'cash', amount: 9000 }] },
    ]
    expect(expectedCashInHand(4000, sales)).toBe(4000)
    expect(shiftRevenue(sales)).toBe(0)
  })

  it('fiado anulado no deja el pago inicial en caja', () => {
    const sales = [
      {
        total: 20000,
        status: 'cancelled',
        isDebt: true,
        payments: [{ paymentMethod: 'cash', amount: 5000 }],
      },
    ]
    expect(expectedCashInHand(10000, sales)).toBe(10000)
    expect(shiftRevenue(sales)).toBe(0)
  })

  it('fiado sin pago inicial no mueve efectivo', () => {
    const sales = [
      { total: 12000, status: 'confirmed', isDebt: true, payments: [] },
    ]
    expect(expectedCashInHand(3000, sales)).toBe(3000)
    expect(shiftRevenue(sales)).toBe(12000)
  })

  it('emergencia combinada: venta cash + débito + fiado + gasto + aporte + anulada', () => {
    const sales = [
      { total: 10000, payments: [{ paymentMethod: 'cash', amount: 10000 }] },
      { total: 4000, payments: [{ paymentMethod: 'debit', amount: 4000 }] },
      { total: 8000, isDebt: true, payments: [{ paymentMethod: 'cash', amount: 2000 }] },
      { total: 1500, status: 'cancelled', payments: [{ paymentMethod: 'cash', amount: 1500 }] },
    ]
    const expenses = [
      { kind: 'expense', amount: 3000 },
      { kind: 'inject', amount: 7000 },
    ]
    // 5000 + 10000 + 0 + 2000 + 0 - 3000 + 7000 = 21000
    expect(expectedCashInHand(5000, sales, expenses)).toBe(21000)
    expect(shiftRevenue(sales)).toBe(22000)
  })

  it('expenses vacío no cambia respecto de omitir el argumento', () => {
    const sales = [{ total: 1000, payments: [{ paymentMethod: 'cash', amount: 1000 }] }]
    expect(expectedCashInHand(0, sales, [])).toBe(expectedCashInHand(0, sales))
  })
})
