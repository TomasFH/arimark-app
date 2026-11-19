import { describe, expect, it } from 'vitest'
import { createInMemoryDb } from './helpers/inMemoryDb'
import { expenses, merchandiseIntakes, providerDebtEvents, shifts, stores, users } from '../schema'
import { sumProviderExpenseTotal } from '../providerExpenseTotal'
import { snapshotShiftMoney } from '../shiftMoney'

describe('sumProviderExpenseTotal', () => {
  it('cuenta el ingreso una vez y el pago posterior aparte del resto', () => {
    const total = sumProviderExpenseTotal(
      [
        { id: 'hielo', amount: 100, kind: 'expense' },
        { id: 'visita', amount: 500, kind: 'expense' },
        { id: 'pago-despues', amount: 200, kind: 'expense' },
        { id: 'insumos', amount: 1000, kind: 'expense' },
        { id: 'visita-con-deuda', amount: 800, kind: 'expense' },
        { id: 'aporte', amount: 50, kind: 'inject' },
      ],
      ['visita', 'visita-con-deuda', null],
      [
        { expenseId: 'pago-despues', amount: 200 },
        { expenseId: 'insumos', amount: 300 },
        { expenseId: 'visita-con-deuda', amount: 100 },
        { expenseId: null, amount: 999 },
        { expenseId: 'pago-despues', amount: 50 },
      ],
    )
    // 500 ingreso + 200 pago posterior (el evento de más no pasa el gasto)
    // + 300 de los insumos + 800 de la visita que también pagó deuda vieja, una sola vez.
    expect(total).toBe(500 + 200 + 300 + 800)
  })
})

describe('snapshotShiftMoney gastos a proveedores', () => {
  it('sella el número y no cuenta el hielo ni el saldado sin gasto', async () => {
    const { db } = await createInMemoryDb()
    const now = '2026-11-18T12:00:00.000Z'
    db.insert(stores).values({ id: 'store-1', name: 'Centro', address: 'Calle 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-1', storeId: 'store-1', name: 'Ana', active: true, createdAt: now }).run()
    db.insert(shifts).values({
      id: 'shift-1',
      storeId: 'store-1',
      userId: 'user-1',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
      openedLocally: true,
    }).run()
    db.insert(expenses).values([
      { id: 'hielo', storeId: 'store-1', shiftId: 'shift-1', concept: 'Hielo', amount: 100, kind: 'expense', createdAt: now, createdBy: 'user-1' },
      { id: 'visita', storeId: 'store-1', shiftId: 'shift-1', concept: 'Mercadería: Pollo', amount: 500, kind: 'expense', createdAt: now, createdBy: 'user-1' },
      { id: 'pago', storeId: 'store-1', shiftId: 'shift-1', concept: null, amount: 200, kind: 'expense', createdAt: now, createdBy: 'user-1' },
    ]).run()
    db.insert(merchandiseIntakes).values({
      id: 'ingreso-1',
      storeId: 'store-1',
      shiftId: 'shift-1',
      paymentKind: 'paid_now',
      providerName: 'Frigorífico',
      expenseId: 'visita',
      status: 'confirmed',
      createdBy: 'user-1',
      createdAt: now,
    }).run()
    db.insert(providerDebtEvents).values([
      {
        id: 'evt-pago',
        storeId: 'store-1',
        provider: 'Frigorífico',
        type: 'payment',
        amount: 200,
        expenseId: 'pago',
        shiftId: 'shift-1',
        createdAt: now,
        createdBy: 'user-1',
      },
      {
        id: 'evt-saldo',
        storeId: 'store-1',
        provider: 'Frigorífico',
        type: 'payment',
        amount: 9000,
        expenseId: null,
        shiftId: 'shift-1',
        createdAt: now,
        createdBy: 'user-1',
        notes: 'Compensación entre locales',
      },
    ]).run()

    const snap = snapshotShiftMoney(db as never, { id: 'shift-1', openedLocally: true }, now)
    expect(snap?.providerExpenseTotal).toBe(700)
    expect(snap?.expenseTotal).toBe(800)
  })
})
