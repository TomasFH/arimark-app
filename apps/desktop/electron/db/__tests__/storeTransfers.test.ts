import { describe, expect, it } from 'vitest'
import { transferOccurredAt } from '@carniceria/shared'
import { createInMemoryDb } from './helpers/inMemoryDb'
import { debtEvents, expenses, merchandiseIntakes, shifts, storeTransfers, stores, users, customers } from '../schema'
import {
  cancelStoreTransferRow,
  confirmStoreTransferRow,
  createStoreTransfer,
  type StoreTransferDb,
} from '../storeTransfers'

const WHEN = transferOccurredAt('2026-11-15') ?? ''
const NOW = '2026-11-20T15:00:00.000Z'

async function seed() {
  const { db } = await createInMemoryDb()
  const database = db as unknown as StoreTransferDb
  database.insert(stores).values([
    { id: 'norte', name: 'Norte', createdAt: NOW },
    { id: 'sur', name: 'Sur', createdAt: NOW },
    { id: 'archivado', name: 'Viejo', createdAt: NOW, archivedAt: NOW },
  ]).run()
  database.insert(users).values({ id: 'ana', name: 'Ana', createdAt: NOW }).run()
  database.insert(shifts).values({
    id: 'shift-1',
    storeId: 'norte',
    userId: 'ana',
    shiftType: 'morning',
    startedAt: NOW,
    openingCash: 0,
  }).run()
  database.insert(customers).values({
    id: 'cust-1',
    storeId: 'norte',
    name: 'Cliente',
    createdAt: NOW,
    createdBy: 'ana',
  }).run()
  database.insert(expenses).values({
    id: 'exp-1',
    storeId: 'norte',
    shiftId: 'shift-1',
    amount: 40,
    createdAt: NOW,
    createdBy: 'ana',
  }).run()
  database.insert(debtEvents).values({
    id: 'deuda-1',
    customerId: 'cust-1',
    storeId: 'norte',
    eventType: 'created',
    amount: 500,
    createdAt: NOW,
    createdBy: 'ana',
  }).run()
  database.insert(merchandiseIntakes).values({
    id: 'ing-1',
    storeId: 'norte',
    shiftId: 'shift-1',
    paymentKind: 'none',
    createdBy: 'ana',
    createdAt: NOW,
  }).run()
  return database
}

function input(overrides: Partial<Parameters<typeof createStoreTransfer>[1]> = {}) {
  return {
    id: 'tr-1',
    productName: 'Vacío',
    quantity: 4,
    unit: 'kg',
    fromStoreId: 'norte',
    toStoreId: 'sur',
    occurredAt: WHEN,
    notes: null,
    estimatedValue: null,
    createdBy: 'ana',
    createdAt: NOW,
    ...overrides,
  }
}

function counts(db: StoreTransferDb) {
  return {
    expenses: db.select().from(expenses).all().length,
    debts: db.select().from(debtEvents).all().length,
    intakes: db.select().from(merchandiseIntakes).all().length,
  }
}

describe('storeTransfers', () => {
  it('el alta no escribe gastos, deuda ni ingresos', async () => {
    const db = await seed()
    expect(counts(db)).toEqual({ expenses: 1, debts: 1, intakes: 1 })
    const created = createStoreTransfer(db, input())
    expect(created).toEqual({ ok: true, id: 'tr-1' })
    expect(counts(db)).toEqual({ expenses: 1, debts: 1, intakes: 1 })
    const row = db.select().from(storeTransfers).all()
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({
      status: 'pending',
      receivedQuantity: null,
      hasDifference: false,
      createdBy: 'ana',
      syncedAt: null,
    })
    expect(createStoreTransfer(db, input({ id: 'tr-archivo', fromStoreId: 'archivado' }))).toEqual({ ok: false, reason: 'STORES' })
    expect(db.select().from(storeTransfers).all()).toHaveLength(1)
  })

  it('confirmar dos veces no se puede y la cantidad distinta queda marcada', async () => {
    const db = await seed()
    createStoreTransfer(db, input())
    const first = confirmStoreTransferRow(db, {
      id: 'tr-1',
      receivedQuantity: 3.5,
      actorId: 'admin-1',
      confirmedAt: NOW,
    })
    expect(first).toEqual({ ok: true, hasDifference: true })
    const second = confirmStoreTransferRow(db, {
      id: 'tr-1',
      receivedQuantity: 4,
      actorId: 'admin-1',
      confirmedAt: NOW,
    })
    expect(second).toEqual({ ok: false, reason: 'NOT_PENDING' })
    expect(db.select().from(storeTransfers).all()[0]).toMatchObject({
      status: 'confirmed',
      receivedQuantity: 3.5,
      hasDifference: true,
      confirmedBy: 'admin-1',
    })
    expect(cancelStoreTransferRow(db, {
      id: 'tr-1',
      actorId: 'admin-1',
      role: 'admin',
      cancelledAt: NOW,
    })).toEqual({ ok: false, reason: 'NOT_PENDING' })
    expect(db.select().from(storeTransfers).all()[0]?.status).toBe('confirmed')
    expect(counts(db)).toEqual({ expenses: 1, debts: 1, intakes: 1 })
  })

  it('cancela el creador o un admin, y solo si sigue pendiente', async () => {
    const db = await seed()
    createStoreTransfer(db, input())
    expect(cancelStoreTransferRow(db, {
      id: 'tr-1',
      actorId: 'luis',
      role: 'cashier',
      cancelledAt: NOW,
    })).toEqual({ ok: false, reason: 'FORBIDDEN' })
    expect(db.select().from(storeTransfers).all()[0]?.status).toBe('pending')

    expect(cancelStoreTransferRow(db, {
      id: 'tr-1',
      actorId: 'admin-1',
      role: 'admin',
      cancelledAt: NOW,
    })).toEqual({ ok: true })
    const cancelled = db.select().from(storeTransfers).all()[0]
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      receivedQuantity: null,
      hasDifference: false,
      updatedBy: 'admin-1',
    })
    expect(confirmStoreTransferRow(db, {
      id: 'tr-1',
      receivedQuantity: 4,
      actorId: 'ana',
      confirmedAt: NOW,
    })).toEqual({ ok: false, reason: 'NOT_PENDING' })
    expect(cancelStoreTransferRow(db, {
      id: 'tr-1',
      actorId: 'ana',
      role: 'cashier',
      cancelledAt: NOW,
    })).toEqual({ ok: false, reason: 'NOT_PENDING' })
    expect(counts(db)).toEqual({ expenses: 1, debts: 1, intakes: 1 })
  })

  it('la cajera que lo creó puede cancelar el suyo', async () => {
    const db = await seed()
    createStoreTransfer(db, input({ id: 'tr-2' }))
    expect(cancelStoreTransferRow(db, {
      id: 'tr-2',
      actorId: 'ana',
      role: 'cashier',
      cancelledAt: NOW,
    })).toEqual({ ok: true })
    expect(db.select().from(storeTransfers).all()[0]?.status).toBe('cancelled')
  })
})
