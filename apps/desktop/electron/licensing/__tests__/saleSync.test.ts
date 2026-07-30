/**
 * Tests del servicio de sincronización de ventas (saleSync).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, products, sales, saleItems, salePayments } from '../../db/schema'
import { isNull, isNotNull } from 'drizzle-orm'

const { mockSetDoc, mockDoc } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => { mockDoc(...args); return { path: args.join('/') } },
  setDoc: mockSetDoc,
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
import { pushUnsyncedSales } from '../saleSync'

const TENANT = 'test-tenant'

describe('saleSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const instance = await createInMemoryDb()
    db = instance.db

    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera Test',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()
    db.insert(shifts).values({
      id: 'shift-001',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
      source: 'desktop',
    }).run()
    db.insert(products).values({
      id: 'prod-001',
      name: 'Asado',
      category: 'beef_cut',
      pluNumber: 1,
      unit: 'kg',
      active: true,
      createdAt: now,
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  function insertConfirmedSale(id: string, syncedAt: string | null = null): void {
    const now = new Date().toISOString()
    db.insert(sales).values({
      id,
      storeId: 'store-001',
      shiftId: 'shift-001',
      total: 3000,
      isDebt: false,
      status: 'confirmed',
      manualEntry: false,
      createdAt: now,
      createdBy: 'user-001',
      syncedAt,
    }).run()
    db.insert(saleItems).values({
      id: `${id}-item`,
      saleId: id,
      productId: 'prod-001',
      quantity: 1.5,
      unitPrice: 2000,
      subtotal: 3000,
    }).run()
    db.insert(salePayments).values({
      id: `${id}-pay`,
      saleId: id,
      paymentMethod: 'cash',
      amount: 3000,
      createdAt: now,
      createdBy: 'user-001',
    }).run()
  }

  describe('pushUnsyncedSales', () => {
    it('pushea ventas confirmadas con syncedAt=null e incluye items y payments', async () => {
      insertConfirmedSale('sale-pending', null)
      insertConfirmedSale('sale-synced', new Date().toISOString())

      await pushUnsyncedSales(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'sales',
        'sale-pending',
      )
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'sale-pending',
          total: 3000,
          shiftId: 'shift-001',
          items: [
            expect.objectContaining({
              productId: 'prod-001',
              productName: 'Asado',
              quantity: 1.5,
              subtotal: 3000,
            }),
          ],
          payments: [
            expect.objectContaining({
              paymentMethod: 'cash',
              amount: 3000,
            }),
          ],
        }),
        { merge: true },
      )

      const remaining = db.select().from(sales).where(isNull(sales.syncedAt)).all()
      expect(remaining).toHaveLength(0)
      const synced = db.select().from(sales).where(isNotNull(sales.syncedAt)).all()
      expect(synced).toHaveLength(2)
    })

    it('no pushea ventas que no están confirmed', async () => {
      const now = new Date().toISOString()
      db.insert(sales).values({
        id: 'sale-progress',
        storeId: 'store-001',
        shiftId: 'shift-001',
        total: 100,
        isDebt: false,
        status: 'in_progress',
        manualEntry: false,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: null,
      }).run()

      await pushUnsyncedSales(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('no pushea si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      insertConfirmedSale('sale-1')
      await pushUnsyncedSales(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('si setDoc falla en uno, continúa con los demás', async () => {
      insertConfirmedSale('sale-fail')
      insertConfirmedSale('sale-ok')

      mockSetDoc
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(undefined)

      await pushUnsyncedSales(TENANT)

      const synced = db.select().from(sales).where(isNotNull(sales.syncedAt)).all()
      expect(synced.map(s => s.id)).toEqual(['sale-ok'])
      const pending = db.select().from(sales).where(isNull(sales.syncedAt)).all()
      expect(pending.map(s => s.id)).toEqual(['sale-fail'])
    })
  })
})
