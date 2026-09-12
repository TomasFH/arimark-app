/**
 * Tests del servicio de sincronización de cebo (ceboSync).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, ceboEntries } from '../../db/schema'
import { isNull, isNotNull } from 'drizzle-orm'

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
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
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
import { pushUnsyncedCebo, markCeboDeletedInFirestore } from '../ceboSync'

const TENANT = 'test-tenant'

describe('ceboSync', () => {
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

  describe('pushUnsyncedCebo', () => {
    it('pushea cebo con syncedAt=null e incluye kilos', async () => {
      const now = new Date().toISOString()
      db.insert(ceboEntries).values({
        id: 'cebo-pending',
        storeId: 'store-001',
        shiftId: 'shift-001',
        quantityKg: 12.5,
        notes: 'Balde',
        createdBy: 'user-001',
        createdAt: now,
        syncedAt: null,
      }).run()
      db.insert(ceboEntries).values({
        id: 'cebo-synced',
        storeId: 'store-001',
        shiftId: 'shift-001',
        quantityKg: 1,
        notes: null,
        createdBy: 'user-001',
        createdAt: now,
        syncedAt: now,
      }).run()

      await pushUnsyncedCebo(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'ceboEntries',
        'cebo-pending',
      )
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'cebo-pending',
          quantityKg: 12.5,
          notes: 'Balde',
          shiftId: 'shift-001',
          deleted: false,
        }),
        { merge: true },
      )

      const remaining = db.select().from(ceboEntries).where(isNull(ceboEntries.syncedAt)).all()
      expect(remaining).toHaveLength(0)
      const synced = db.select().from(ceboEntries).where(isNotNull(ceboEntries.syncedAt)).all()
      expect(synced).toHaveLength(2)
    })

    it('no pushea si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      db.insert(ceboEntries).values({
        id: 'cebo-1',
        storeId: 'store-001',
        shiftId: 'shift-001',
        quantityKg: 2,
        createdBy: 'user-001',
        createdAt: new Date().toISOString(),
        syncedAt: null,
      }).run()

      await pushUnsyncedCebo(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })
  })

  describe('markCeboDeletedInFirestore', () => {
    it('marca deleted:true en cada id', async () => {
      await markCeboDeletedInFirestore(TENANT, ['cebo-a', 'cebo-b'])
      expect(mockUpdateDoc).toHaveBeenCalledTimes(2)
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deleted: true, deletedAt: expect.any(String) }),
      )
    })

    it('no-op con lista vacía', async () => {
      await markCeboDeletedInFirestore(TENANT, [])
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })
})
