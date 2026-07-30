/**
 * Tests del servicio de sincronización de gastos (expenseSync).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, expenses, providers } from '../../db/schema'
import { isNull, isNotNull } from 'drizzle-orm'
import { providerIdFromName } from '../../ipc/providerUtils'

const { mockSetDoc, mockUpdateDoc, mockDoc } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => { mockDoc(...args); return { path: args.join('/') } },
  setDoc: mockSetDoc,
  updateDoc: mockUpdateDoc,
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
import { pushUnsyncedExpenses, markExpensesDeletedInFirestore } from '../expenseSync'

const TENANT = 'test-tenant'

describe('expenseSync', () => {
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

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  describe('pushUnsyncedExpenses', () => {
    it('pushea gastos con syncedAt=null e incluye providerName', async () => {
      const now = new Date().toISOString()
      const pid = providerIdFromName('oso')
      db.insert(providers).values({
        id: pid,
        name: 'Oso',
        nameKey: 'oso',
        createdAt: now,
        syncedAt: now,
      }).run()
      db.insert(expenses).values({
        id: 'exp-pending',
        storeId: 'store-001',
        shiftId: 'shift-001',
        concept: null,
        providerId: pid,
        amount: 5000,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: null,
      }).run()
      db.insert(expenses).values({
        id: 'exp-synced',
        storeId: 'store-001',
        shiftId: 'shift-001',
        concept: 'Luz',
        amount: 1000,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: now,
      }).run()

      await pushUnsyncedExpenses(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'exp-pending',
          providerId: pid,
          providerName: 'Oso',
          amount: 5000,
          deleted: false,
        }),
        { merge: true },
      )

      const remaining = db.select().from(expenses).where(isNull(expenses.syncedAt)).all()
      expect(remaining).toHaveLength(0)
      const synced = db.select().from(expenses).where(isNotNull(expenses.syncedAt)).all()
      expect(synced).toHaveLength(2)
    })

    it('no pushea si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      db.insert(expenses).values({
        id: 'exp-1',
        storeId: 'store-001',
        shiftId: 'shift-001',
        concept: 'Agua',
        amount: 100,
        createdAt: new Date().toISOString(),
        createdBy: 'user-001',
        syncedAt: null,
      }).run()

      await pushUnsyncedExpenses(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })
  })

  describe('markExpensesDeletedInFirestore', () => {
    it('marca deleted:true en cada id', async () => {
      await markExpensesDeletedInFirestore(TENANT, ['exp-a', 'exp-b'])
      expect(mockUpdateDoc).toHaveBeenCalledTimes(2)
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deleted: true, deletedAt: expect.any(String) }),
      )
    })

    it('no-op con lista vacía', async () => {
      await markExpensesDeletedInFirestore(TENANT, [])
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })
})
