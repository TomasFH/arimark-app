import { describe, expect, it } from 'vitest'
import { createInMemoryDb } from './helpers/inMemoryDb'
import {
  customers,
  debtEvents,
  expenses,
  orders,
  salePayments,
  sales,
  shifts,
  stores,
  users,
} from '../schema'
import { computeShiftMoney, snapshotShiftMoney } from '../shiftMoney'

describe('computeShiftMoney desglose', () => {
  it('lee venta mixta, seña, fiado y deja afuera la anulada, el aporte y el efectivo por digital', async () => {
    const { db } = await createInMemoryDb()
    const now = '2026-10-20T12:00:00.000Z'
    db.insert(stores).values({ id: 'store-1', name: 'Centro', address: 'Calle 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-1', storeId: 'store-1', name: 'Ana', active: true, createdAt: now }).run()
    db.insert(customers).values({
      id: 'cust-1',
      storeId: 'store-1',
      name: 'Cliente',
      createdAt: now,
      createdBy: 'user-1',
    }).run()
    db.insert(shifts).values({
      id: 'shift-1',
      storeId: 'store-1',
      userId: 'user-1',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
    }).run()
    db.insert(sales).values({
      id: 'sale-ok',
      storeId: 'store-1',
      shiftId: 'shift-1',
      total: 5000,
      status: 'confirmed',
      createdAt: now,
      createdBy: 'user-1',
    }).run()
    db.insert(sales).values({
      id: 'sale-anulada',
      storeId: 'store-1',
      shiftId: 'shift-1',
      total: 9000,
      status: 'cancelled',
      createdAt: now,
      createdBy: 'user-1',
    }).run()
    db.insert(salePayments).values([
      { id: 'pay-cash', saleId: 'sale-ok', paymentMethod: 'cash', amount: 2000, createdAt: now, createdBy: 'user-1' },
      { id: 'pay-debit', saleId: 'sale-ok', paymentMethod: 'debit', amount: 3000, createdAt: now, createdBy: 'user-1' },
      { id: 'pay-anulada', saleId: 'sale-anulada', paymentMethod: 'debit', amount: 9000, createdAt: now, createdBy: 'user-1' },
    ]).run()
    db.insert(orders).values({
      id: 'order-1',
      storeId: 'store-1',
      customerName: 'Pedido',
      items: '[]',
      pickupDate: '2026-10-21',
      status: 'pending',
      depositAmount: 500,
      depositMethod: 'cash',
      depositPayments: JSON.stringify([{ method: 'wallet', amount: 500 }]),
      depositShiftId: 'shift-1',
      createdAt: now,
      createdBy: 'user-1',
    }).run()
    db.insert(orders).values({
      id: 'order-vieja',
      storeId: 'store-1',
      customerName: 'Pedido viejo',
      items: '[]',
      pickupDate: '2026-10-21',
      status: 'pending',
      depositAmount: 700,
      depositMethod: 'credit',
      depositShiftId: 'shift-1',
      createdAt: now,
      createdBy: 'user-1',
    }).run()
    db.insert(debtEvents).values({
      id: 'debt-1',
      customerId: 'cust-1',
      storeId: 'store-1',
      eventType: 'partial_payment',
      amount: -400,
      paymentMethod: 'wallet',
      shiftId: 'shift-1',
      createdAt: now,
      createdBy: 'user-1',
    }).run()
    db.insert(expenses).values([
      {
        id: 'exp-aporte',
        storeId: 'store-1',
        shiftId: 'shift-1',
        concept: 'Aporte',
        amount: 1000,
        kind: 'inject',
        injectReason: 'aporte',
        createdAt: now,
        createdBy: 'user-1',
      },
      {
        id: 'exp-digital',
        storeId: 'store-1',
        shiftId: 'shift-1',
        concept: 'Efectivo por digital',
        amount: 50,
        kind: 'inject',
        injectReason: 'wallet_cash',
        createdAt: now,
        createdBy: 'user-1',
      },
    ]).run()

    const money = computeShiftMoney(db as never, 'shift-1')
    expect(money.paymentSplit).toEqual({ debit: 3000, wallet: 900, credit: 700 })
    expect(money.cardWalletTotal).toBe(4600)
    const snap = snapshotShiftMoney(db as never, { id: 'shift-1', openedLocally: true }, now)
    expect(snap).toMatchObject({
      cardWalletTotal: 4600,
      debitTotal: 3000,
      walletTotal: 900,
      creditTotal: 700,
    })
    expect(money.cashTotal).toBe(2000)
    expect(money.contributionTotal).toBe(1000)
    expect(money.walletCashTotal).toBe(50)
    const hours = JSON.parse(money.soldHoursJson) as number[]
    expect(hours).toHaveLength(24)
    expect(hours.reduce((acc, amount) => acc + amount, 0)).toBe(money.soldTotal)
    expect(money.soldTotal).toBe(5000)
  })

  it('sin ventas guarda 24 ceros y sin libro no inventa el dato', async () => {
    const { db } = await createInMemoryDb()
    const now = '2026-10-20T12:00:00.000Z'
    db.insert(stores).values({ id: 'store-1', name: 'Centro', address: 'Calle 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-1', storeId: 'store-1', name: 'Ana', active: true, createdAt: now }).run()
    db.insert(shifts).values({
      id: 'shift-vacio',
      storeId: 'store-1',
      userId: 'user-1',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
      openedLocally: true,
    }).run()
    db.insert(shifts).values({
      id: 'shift-ajeno',
      storeId: 'store-1',
      userId: 'user-1',
      shiftType: 'evening',
      startedAt: now,
      openingCash: 0,
      openedLocally: false,
    }).run()

    const empty = snapshotShiftMoney(db as never, { id: 'shift-vacio', openedLocally: true }, now)
    expect(JSON.parse(empty?.soldHoursJson ?? 'null')).toEqual(Array.from({ length: 24 }, () => 0))
    expect(empty?.soldTotal).toBe(0)
    expect(empty?.providerExpenseTotal).toBe(0)
    db.insert(orders).values({
      id: 'order-ajeno',
      storeId: 'store-1',
      customerName: 'dodo',
      items: '[]',
      pickupDate: '2026-10-21',
      status: 'pending',
      depositAmount: 40000,
      depositPayments: JSON.stringify([{ method: 'wallet', amount: 40000 }]),
      depositShiftId: 'shift-ajeno',
      createdAt: now,
      createdBy: 'user-1',
    }).run()
    expect(snapshotShiftMoney(db as never, { id: 'shift-ajeno', openedLocally: false }, now)).toBeNull()
  })
})
