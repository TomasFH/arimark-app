/**
 * Tests de outbox pedidos / fiados / clientes especiales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import {
  stores, users, products, orders, customers, debtEvents, shifts, sales,
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
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: mockOnSnapshot,
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: { get: () => Promise<{ exists: () => boolean; data: () => undefined }>; set: () => void }) => Promise<unknown>) =>
    fn({
      get: async () => ({ exists: () => false, data: () => undefined }),
      set: vi.fn(),
    }),
  ),
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

vi.mock('../notifyRenderer', () => ({
  notifyRenderer: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../../db/client'
import { isFirebaseAvailable } from '../firebase'
import { notifyRenderer } from '../notifyRenderer'
import { IPC } from '../../ipc/channels'
import { pushUnsyncedOrders, pullOrdersFromFirestore, startOrderSyncListener, stopOrderSyncListener, REMOTE_ORDER_UNKNOWN_USER } from '../orderSync'
import {
  pushUnsyncedCustomers,
  pushUnsyncedCustomerDebtEvents,
  pullCustomersFromFirestore,
  pullCustomerDebtEventsFromFirestore,
  stopCustomerDebtSyncListener,
  backfillDebtEventShiftIdsFromSales,
} from '../customerDebtSync'
import {
  pushUnsyncedSpecialCustomers,
  pushUnsyncedSpecialCustomerPrices,
  pullSpecialCustomersFromFirestore,
  pullSpecialCustomerPricesFromFirestore,
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

  it('backfill de shiftId en fiados viejos y re-push', async () => {
    const now = new Date().toISOString()
    db.insert(shifts).values({
      id: 'shift-bf',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
    }).run()
    db.insert(customers).values({
      id: 'cust-bf',
      storeId: 'store-001',
      name: 'Cliente BF',
      active: true,
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: now,
    }).run()
    db.insert(sales).values({
      id: 'sale-bf',
      storeId: 'store-001',
      shiftId: 'shift-bf',
      total: 15000,
      status: 'confirmed',
      isDebt: true,
      customerId: 'cust-bf',
      manualEntry: false,
      createdAt: now,
      createdBy: 'user-001',
    }).run()
    db.insert(debtEvents).values({
      id: 'debt-bf',
      customerId: 'cust-bf',
      saleId: 'sale-bf',
      storeId: 'store-001',
      eventType: 'created',
      amount: 15000,
      shiftId: null,
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: now,
    }).run()

    expect(backfillDebtEventShiftIdsFromSales()).toBe(1)
    const local = db.select().from(debtEvents).all().find(e => e.id === 'debt-bf')
    expect(local!.shiftId).toBe('shift-bf')
    expect(local!.syncedAt).toBeNull()

    await pushUnsyncedCustomerDebtEvents(TENANT)
    const pushed = mockSetDoc.mock.calls.find(c => {
      const payload = c[1] as { id?: string; shiftId?: string }
      return payload?.id === 'debt-bf'
    })
    expect(pushed).toBeDefined()
    expect((pushed![1] as { shiftId: string }).shiftId).toBe('shift-bf')
  })

  it('no pisa un fiado local con syncedAt=null al hacer pull', async () => {
    const now = new Date().toISOString()
    db.insert(shifts).values({
      id: 'shift-outbox',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
    }).run()
    db.insert(customers).values({
      id: 'cust-outbox',
      storeId: 'store-001',
      name: 'Outbox',
      active: true,
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: now,
    }).run()
    db.insert(debtEvents).values({
      id: 'debt-outbox',
      customerId: 'cust-outbox',
      storeId: 'store-001',
      eventType: 'created',
      amount: 8000,
      shiftId: 'shift-outbox',
      createdAt: now,
      createdBy: 'user-001',
      syncedAt: null,
    }).run()

    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'debt-outbox',
        data: () => ({
          id: 'debt-outbox',
          customerId: 'cust-outbox',
          storeId: 'store-001',
          eventType: 'created',
          amount: 8000,
          shiftId: null,
          createdAt: now,
          createdBy: 'user-001',
        }),
      }],
    })

    await pullCustomerDebtEventsFromFirestore(TENANT)
    const row = db.select().from(debtEvents).all().find(e => e.id === 'debt-outbox')
    expect(row!.shiftId).toBe('shift-outbox')
    expect(row!.syncedAt).toBeNull()
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

  it('pull de order sin createdBy no rompe NOT NULL: usa stub remoto', async () => {
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'ord-mobile-legacy',
        data: () => ({
          id: 'ord-mobile-legacy',
          storeId: 'store-001',
          customerName: 'Ana',
          items: 'vacío',
          pickupDate: '2026-08-18',
          status: 'pending',
          depositAmount: 1500,
          depositPayments: [{ method: 'cash', amount: 1500 }],
          priority: 'high',
          createdAt: new Date().toISOString(),
        }),
      }],
    })

    await pullOrdersFromFirestore(TENANT)

    const row = db.select().from(orders).all().find(r => r.id === 'ord-mobile-legacy')
    expect(row).toBeDefined()
    expect(row!.createdBy).toBe(REMOTE_ORDER_UNKNOWN_USER)
    expect(row!.priority).toBe(true)
    expect(row!.depositPayments).toBe(JSON.stringify([{ method: 'cash', amount: 1500 }]))

    const stub = db.select().from(users).all().find(u => u.id === REMOTE_ORDER_UNKNOWN_USER)
    expect(stub).toBeDefined()
  })

  it('pull de order con createdBy vacío tampoco falla el FK', async () => {
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'ord-empty-author',
        data: () => ({
          id: 'ord-empty-author',
          storeId: 'store-001',
          customerName: 'Luis',
          items: 'pollo',
          pickupDate: '2026-08-18',
          status: 'pending',
          depositAmount: 0,
          createdAt: new Date().toISOString(),
          createdBy: '   ',
        }),
      }],
    })

    await pullOrdersFromFirestore(TENANT)

    const row = db.select().from(orders).all().find(r => r.id === 'ord-empty-author')
    expect(row).toBeDefined()
    expect(row!.createdBy).toBe(REMOTE_ORDER_UNKNOWN_USER)
  })

  it('pull de order listo copia readyAt/readyByName', async () => {
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'ord-ready',
        data: () => ({
          id: 'ord-ready',
          storeId: 'store-001',
          customerName: 'Marta',
          items: 'vacío',
          pickupDate: '2026-09-05',
          status: 'ready',
          depositAmount: 0,
          createdAt: new Date().toISOString(),
          createdBy: 'user-001',
          readyAt: '2026-09-05T12:00:00.000Z',
          readyBy: 'butcher-uid',
          readyByName: 'Juan',
        }),
      }],
    })

    await pullOrdersFromFirestore(TENANT)

    const row = db.select().from(orders).all().find(r => r.id === 'ord-ready')
    expect(row?.status).toBe('ready')
    expect(row?.readyAt).toBe('2026-09-05T12:00:00.000Z')
    expect(row?.readyByName).toBe('Juan')
  })

  it('listener de pedidos aplica Listo y avisa al renderer una vez', () => {
    db.insert(orders).values({
      id: 'ord-live',
      storeId: 'store-001',
      customerName: 'Pedro',
      items: 'asado',
      pickupDate: '2026-09-05',
      status: 'pending',
      depositAmount: 0,
      createdAt: new Date().toISOString(),
      createdBy: 'user-001',
    }).run()

    let onSnap: ((snapshot: { docChanges: () => unknown[] }) => void) | undefined
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (snapshot: { docChanges: () => unknown[] }) => void) => {
      onSnap = cb
      return vi.fn()
    })

    startOrderSyncListener(TENANT)
    expect(onSnap).toBeDefined()

    onSnap!({
      docChanges: () => [{
        type: 'modified',
        doc: {
          id: 'ord-live',
          data: () => ({
            id: 'ord-live',
            storeId: 'store-001',
            customerName: 'Pedro',
            items: 'asado',
            pickupDate: '2026-09-05',
            status: 'ready',
            depositAmount: 0,
            createdAt: new Date().toISOString(),
            createdBy: 'user-001',
            readyAt: '2026-09-05T15:00:00.000Z',
            readyBy: 'butcher-uid',
            readyByName: 'Juan',
          }),
        },
      }],
    })

    const row = db.select().from(orders).all().find(r => r.id === 'ord-live')
    expect(row?.status).toBe('ready')
    expect(row?.readyByName).toBe('Juan')
    expect(notifyRenderer).toHaveBeenCalledTimes(1)
    expect(notifyRenderer).toHaveBeenCalledWith(IPC.ORDER_SYNC_UPDATED)
  })

  it('debt event sin cliente queda en cola y se aplica al llegar el customer', async () => {
    const now = new Date().toISOString()
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'evt-orphan',
        data: () => ({
          id: 'evt-orphan',
          customerId: 'cust-later',
          storeId: 'store-001',
          eventType: 'partial_payment',
          amount: -2000,
          createdAt: now,
          createdBy: 'user-001',
        }),
      }],
    })
    await pullCustomerDebtEventsFromFirestore(TENANT)
    expect(db.select().from(debtEvents).all().some(e => e.id === 'evt-orphan')).toBe(false)

    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'cust-later',
        data: () => ({
          id: 'cust-later',
          storeId: 'store-001',
          name: 'Llega después',
          active: true,
          createdAt: now,
          createdBy: 'user-001',
        }),
      }],
    })
    await pullCustomersFromFirestore(TENANT)
    const evt = db.select().from(debtEvents).all().find(e => e.id === 'evt-orphan')
    expect(evt).toBeDefined()
    expect(evt!.amount).toBe(-2000)
    expect(evt!.eventType).toBe('partial_payment')
  })

  it('precio especial sin cliente queda en cola y se aplica al llegar el cliente', async () => {
    const now = new Date().toISOString()
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'scp-orphan',
        data: () => ({
          id: 'scp-orphan',
          specialCustomerId: 'sc-later',
          productId: 'prod-001',
          price: 8000,
          updatedAt: now,
          updatedBy: 'user-001',
        }),
      }],
    })
    await pullSpecialCustomerPricesFromFirestore(TENANT)
    expect(db.select().from(specialCustomerPrices).all().some(p => p.id === 'scp-orphan')).toBe(false)

    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: 'sc-later',
        data: () => ({
          id: 'sc-later',
          name: 'Resto tardío',
          createdAt: now,
          createdBy: 'user-001',
        }),
      }],
    })
    await pullSpecialCustomersFromFirestore(TENANT)
    const price = db.select().from(specialCustomerPrices).all().find(p => p.id === 'scp-orphan')
    expect(price).toBeDefined()
    expect(price!.price).toBe(8000)
  })

  it('baja un cliente especial creado por un admin cuyo local no está en esta PC', async () => {
    const now = new Date().toISOString()
    mockGetDocs.mockResolvedValueOnce({
      size: 1,
      docs: [{
        id: '0654ac98-abb4-4c34-a104-09eebd094eed',
        data: () => ({
          id: '0654ac98-abb4-4c34-a104-09eebd094eed',
          name: 'Resto otro local',
          storeId: 'store-que-no-existe',
          createdAt: now,
          createdBy: 'admin-firebase-uid',
        }),
      }],
    })

    await pullSpecialCustomersFromFirestore(TENANT)

    const row = db.select().from(specialCustomers).all()
      .find(r => r.id === '0654ac98-abb4-4c34-a104-09eebd094eed')
    expect(row).toBeDefined()
    expect(row!.name).toBe('Resto otro local')
    expect(row!.storeId).toBeNull()
    const stub = db.select().from(users).all().find(u => u.id === 'admin-firebase-uid')
    expect(stub).toBeDefined()
    expect(stub!.storeId).toBeNull()
  })
})
