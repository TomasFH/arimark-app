import { describe, expect, it } from 'vitest'
import { coverageAccount } from '../coverageAccount'
import { mediaResVisits } from '../mediaResSummary'

describe('coverageAccount', () => {
  it('no cuenta dos veces el gasto del ingreso ni el pago posterior', () => {
    const account = coverageAccount({
      fichas: [{
        soldTotal: 10_000,
        expenseTotal: 800,
        providerExpenseTotal: 700,
      }],
      intakes: [{
        lines: [{ costTotal: 500, moneyRole: 'payable' }],
      }],
    })
    expect(account.purchases).toBe(500)
    expect(account.otherExpenses).toBe(100)
    expect((account.otherExpenses ?? 0) + account.purchases).toBe(600)
    expect(account.difference).toBe(10_000 - 500 - 100)
    expect(account.shiftsLeftOut).toBe(0)
  })

  it('el insumo que también paga deuda deja en otros gastos solo lo que no es proveedor', () => {
    const account = coverageAccount({
      fichas: [{
        soldTotal: 4_000,
        expenseTotal: 1_000,
        providerExpenseTotal: 300,
      }],
      intakes: [],
    })
    expect(account.purchases).toBe(0)
    expect(account.otherExpenses).toBe(700)
    expect(account.difference).toBe(4_000 - 700)
  })

  it('suma el costo informado y el que quedó impago', () => {
    const account = coverageAccount({
      fichas: [{ soldTotal: 0, expenseTotal: 0, providerExpenseTotal: 0 }],
      intakes: [
        { lines: [{ costTotal: 2_000, moneyRole: 'informed' }] },
        { lines: [{ costTotal: 3_000, moneyRole: 'payable' }] },
        { lines: [{ costTotal: 9_000, moneyRole: 'none' }] },
      ],
    })
    expect(account.purchases).toBe(5_000)
    expect(account.mediaResWithoutPrice).toBe(0)
  })

  it('una ficha sin el número de proveedores queda sin dato y no suma cero', () => {
    const onlyMissing = coverageAccount({
      fichas: [{ soldTotal: 9_000, expenseTotal: 100, providerExpenseTotal: null }],
      intakes: [{ lines: [{ costTotal: 400, moneyRole: 'payable' }] }],
    })
    expect(onlyMissing.sales).toBeNull()
    expect(onlyMissing.otherExpenses).toBeNull()
    expect(onlyMissing.difference).toBeNull()
    expect(onlyMissing.purchases).toBe(400)
    expect(onlyMissing.shiftsLeftOut).toBe(1)

    const mixed = coverageAccount({
      fichas: [
        { soldTotal: 9_000, expenseTotal: 100, providerExpenseTotal: null },
        { soldTotal: 1_000, expenseTotal: 50, providerExpenseTotal: 20 },
      ],
      intakes: [],
    })
    expect(mixed.sales).toBe(1_000)
    expect(mixed.otherExpenses).toBe(30)
    expect(mixed.difference).toBeNull()
    expect(mixed.shiftsLeftOut).toBe(1)
  })

  it('la media res sin precio no suma y se avisa', () => {
    const account = coverageAccount({
      fichas: [{ soldTotal: 100, expenseTotal: 0, providerExpenseTotal: 0 }],
      intakes: [{
        lines: [{ costTotal: 0, moneyRole: 'none', mediaRes: true }],
      }],
    })
    expect(account.purchases).toBe(0)
    expect(account.mediaResWithoutPrice).toBe(1)
    expect(account.sales).toBe(100)
  })

  it('una semana sin ingresos tiene compras en cero', () => {
    const account = coverageAccount({
      fichas: [{ soldTotal: 2_000, expenseTotal: 40, providerExpenseTotal: 0 }],
      intakes: [],
    })
    expect(account.purchases).toBe(0)
    expect(account.sales).toBe(2_000)
    expect(account.otherExpenses).toBe(40)
    expect(account.difference).toBe(1_960)
    expect(account.shiftsLeftOut).toBe(0)
    expect(account.mediaResWithoutPrice).toBe(0)
  })
})

describe('media res sin precio', () => {
  it('muestra null y no cero, y el costo informado sí', () => {
    const unpriced = mediaResVisits([{
      id: 'v',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Frigorífico',
      receivedByName: 'Ana',
      lines: [{
        rubroId: 'rubro_media_res',
        count: 2,
        netKg: 180,
        weightsKg: [90, 90],
        costTotal: 0,
        moneyRole: 'none',
      }],
    }])
    expect(unpriced[0]?.cost).toBeNull()
    expect(unpriced[0]?.kg).toBe(180)

    const priced = mediaResVisits([{
      id: 'v2',
      createdAt: '2026-10-27T15:00:00.000Z',
      providerName: 'Frigorífico',
      receivedByName: 'Ana',
      lines: [{
        rubroId: 'rubro_media_res',
        count: 1,
        netKg: 90,
        weightsKg: [90],
        costTotal: 120_000,
        moneyRole: 'informed',
      }],
    }])
    expect(priced[0]?.cost).toBe(120_000)
  })

  it('un movimiento entre locales no cambia ventas, compras ni gastos', () => {
    const fichas = [{
      soldTotal: 10_000,
      expenseTotal: 800,
      providerExpenseTotal: 700,
    }]
    const intakes = [{
      lines: [{ costTotal: 500, moneyRole: 'payable' as const }],
    }]
    const movement = { estimatedValue: 15_000, productName: 'Vacío' }
    const before = coverageAccount({ fichas, intakes })
    const after = coverageAccount({ fichas, intakes })
    expect(after).toEqual(before)
    expect(after.sales).toBe(10_000)
    expect(after.purchases).toBe(500)
    expect(after.otherExpenses).toBe(100)
    expect(movement.estimatedValue).toBe(15_000)
  })
})
