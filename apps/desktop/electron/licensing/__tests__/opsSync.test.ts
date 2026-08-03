/**
 * Tests de outbox pedidos / fiados / clientes especiales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import {
  stores, users, products, orders, customers, debtEvents,
  specialCustomers, specialCustomerPrices,
} from '../../db/schema'
import { isNull } from 'drizzle-orm'

const { mockSetDoc, mockGetDocs, mockOnSnapshot } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDocs: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
  mockOnSnapshot: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => ({ path: args.join('/') }),
  collection: vi.fn(() => ({})),
  setDoc: mockSetDoc,
  getDocs: mockGetDocs,
  onSnapshot: mockOnSnapshot,
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../../db/client'
import { isFirebaseAvailable } from '../firebase'
import { pushUnsyncedOrders, pullOrdersFromFirestore, stopOrderSyncListener } from '../orderSync'
import {
  pushUnsyncedCustomers,
  pushUnsyncedCustomerDebtEvents,
  pullCustomersFromFirestore,
  stopCustomerDebtSyncListener,
} from '../customerDebtSync'
import {
  pushUnsyncedSpecialCustomers,
  pushUnsyncedSpecialCustomerPrices,
  stopSpecialCustomerSyncListener,
} from '../specialCustomerSync'

const TENANT = 'test-tenant'

describe('ops sync (orders / debts / special customers)', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    stopOrderSyncListener()
    stopCustomerDebtSyncListener()
    stopSpecialCustomerSyncListener()
    mockOnSnapshot.mockReturnValue(vi.fn())
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] })
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)

    const instance = await createInMemoryDb()
    db = instance.db
    const now = new Date().toISOString()

    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()
    db.insert(products).values({
      id: 'prod-001',
      name: 'Vacío',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 1,
      active: true,
      createdAt: now,
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  it('pushea orders con syncedAt=null', async () => {
    const now = new Date().toISOString()
    db.insert(orders).values({
      id: 'ord-1',
      storeId: 'store-001',
      customerName: 'Juan',
      items: 'asado',
      pickupDate: '2026-08-10',
      status: 'pending',
      depositAmount: 0,
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: null,
    }).run()

    await pushUnsyncedOrders(TENANT)

    expect(mockSetDoc).toHaveBeenCalled()
    expect(db.select().from(orders).where(isNull(orders.syncedAt)).all()).toHaveLength(0)
  })

  it('pushea customers y debt events', async () => {
    const now = new Date().toISOString()
    db.insert(customers).values({
      id: 'cust-1',
      storeId: 'store-001',
      name: 'Cliente Fiado',
      active: true,
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: null,
    }).run()
    db.insert(debtEvents).values({
      id: 'debt-1',
      customerId: 'cust-1',
      storeId: 'store-001',
      eventType: 'created',
      amount: 5000,
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: null,
    }).run()

    await pushUnsyncedCustomers(TENANT)
    await pushUnsyncedCustomerDebtEvents(TENANT)

    expect(mockSetDoc).toHaveBeenCalled()
    expect(db.select().from(customers).where(isNull(customers.syncedAt)).all()).toHaveLength(0)
    expect(db.select().from(debtEvents).where(isNull(debtEvents.syncedAt)).all()).toHaveLength(0)
  })

  it('pushea special customers y precios', async () => {
    const now = new Date().toISOString()
    db.insert(specialCustomers).values({
      id: 'sc-1',
      storeId: null,
      name: 'Restaurante X',
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: null,
    }).run()
    db.insert(specialCustomerPrices).values({
      id: 'scp-1',
      specialCustomerId: 'sc-1',
      productId: 'prod-001',
      price: 9000,
      updatedAt: now,
      updatedBy: 'user-001',
      syncedAt: null,
    }).run()

    await pushUnsyncedSpecialCustomers(TENANT)
    await pushUnsyncedSpecialCustomerPrices(TENANT)

    expect(mockSetDoc).toHaveBeenCalled()
    expect(db.select().from(specialCustomers).where(isNull(specialCustomers.syncedAt)).all()).toHaveLength(0)
    expect(db.select().from(specialCustomerPrices).where(isNull(specialCustomerPrices.syncedAt)).all()).toHaveLength(0)
  })

  it('pull de customers upsertea en SQLite', async () => {
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'cust-remote',
        data: () => ({
          id: 'cust-remote',
          storeId: 'store-001',
          name: 'Remoto',
          active: true,
          createdAt: new Date().toISOString(),
          createdBy: 'user-001',
        }),
      }],
    })

    await pullCustomersFromFirestore(TENANT)

    const rows = db.select().from(customers).all()
    expect(rows.some(r => r.id === 'cust-remote' && r.name === 'Remoto')).toBe(true)
  })

  it('pull de orders upsertea en SQLite', async () => {
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'ord-remote',
        data: () => ({
          id: 'ord-remote',
          storeId: 'store-001',
          customerName: 'Pedro',
          items: 'costilla',
          pickupDate: '2026-08-12',
          status: 'pending',
          depositAmount: 0,
          createdAt: new Date().toISOString(),
          createdBy: 'user-001',
        }),
      }],
    })

    await pullOrdersFromFirestore(TENANT)

    const rows = db.select().from(orders).all()
    expect(rows.some(r => r.id === 'ord-remote')).toBe(true)
  })
})
