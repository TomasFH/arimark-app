/**
 * Tests del servicio de sincronización de ingresos de mercadería.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, merchandiseIntakes, merchandiseIntakeLines } from '../../db/schema'
import { isNull, isNotNull, eq } from 'drizzle-orm'

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
import { getDocs } from 'firebase/firestore'
import {
  pushUnsyncedMerchandiseIntakes,
  pullMerchandiseIntakesForStoreWeek,
  markMerchandiseIntakesDeletedInFirestore,
} from '../merchIntakeSync'

const TENANT = 'test-tenant'

function insertIntake(
  db: Awaited<ReturnType<typeof createInMemoryDb>>['db'],
  opts: { id: string; syncedAt: string | null; rubroName?: string },
) {
  const now = new Date().toISOString()
  db.insert(merchandiseIntakes).values({
    id: opts.id,
    storeId: 'store-001',
    shiftId: 'shift-001',
    notes: null,
    paymentKind: 'paid_now',
    paidAmount: 150000,
    debtAmount: 0,
    createdBy: 'user-001',
    createdAt: now,
    syncedAt: opts.syncedAt,
  }).run()
  db.insert(merchandiseIntakeLines).values({
    id: `${opts.id}-l1`,
    intakeId: opts.id,
    rubroId: 'rubro_media_res',
    rubroName: opts.rubroName ?? 'Media res',
    template: 'pieces_weight',
    sortOrder: 0,
    count: 2,
    netKg: 180,
    unitCount: 2,
    hasIce: false,
    weightsJson: '[90,90]',
  }).run()
}

describe('merchIntakeSync', () => {
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

  describe('pushUnsyncedMerchandiseIntakes', () => {
    it('pushea ingresos con syncedAt=null e incluye líneas', async () => {
      insertIntake(db, { id: 'merch-pending', syncedAt: null })
      insertIntake(db, { id: 'merch-synced', syncedAt: new Date().toISOString(), rubroName: 'Maple' })

      await pushUnsyncedMerchandiseIntakes(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'merchandiseIntakes',
        'merch-pending',
      )
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'merch-pending',
          paymentKind: 'paid_now',
          paidAmount: 150000,
          deleted: false,
          lines: expect.arrayContaining([
            expect.objectContaining({ rubroId: 'rubro_media_res', netKg: 180, count: 2 }),
          ]),
        }),
        { merge: true },
      )

      const remaining = db.select().from(merchandiseIntakes).where(isNull(merchandiseIntakes.syncedAt)).all()
      expect(remaining).toHaveLength(0)
      const synced = db.select().from(merchandiseIntakes).where(isNotNull(merchandiseIntakes.syncedAt)).all()
      expect(synced).toHaveLength(2)
    })

    it('no pushea borradores de visita', async () => {
      insertIntake(db, { id: 'merch-draft', syncedAt: null })
      db.update(merchandiseIntakes).set({ status: 'draft' }).where(eq(merchandiseIntakes.id, 'merch-draft')).run()

      await pushUnsyncedMerchandiseIntakes(TENANT)

      expect(mockSetDoc).not.toHaveBeenCalled()
      const remaining = db.select().from(merchandiseIntakes).where(isNull(merchandiseIntakes.syncedAt)).all()
      expect(remaining).toHaveLength(1)
    })

    it('no pushea si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      insertIntake(db, { id: 'merch-1', syncedAt: null, rubroName: 'Carbón' })

      await pushUnsyncedMerchandiseIntakes(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })
  })

  describe('markMerchandiseIntakesDeletedInFirestore', () => {
    it('marca deleted:true en cada id', async () => {
      await markMerchandiseIntakesDeletedInFirestore(TENANT, ['merch-a', 'merch-b'])
      expect(mockUpdateDoc).toHaveBeenCalledTimes(2)
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deleted: true, deletedAt: expect.any(String) }),
      )
    })

    it('no-op con lista vacía', async () => {
      await markMerchandiseIntakesDeletedInFirestore(TENANT, [])
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })

  describe('pullMerchandiseIntakesForStoreWeek', () => {
    it('upserta docs de la semana, sintetiza v1 y no pisa filas pendientes', async () => {
      insertIntake(db, { id: 'merch-pending', syncedAt: null, rubroName: 'Local' })

      vi.mocked(getDocs).mockResolvedValueOnce({
        docs: [
          {
            id: 'merch-pending',
            data: () => ({
              id: 'merch-pending',
              storeId: 'store-001',
              shiftId: 'shift-001',
              lines: [{ id: 'x', rubroId: 'rubro_cerdo', rubroName: 'Remoto', template: 'weight', count: 1, netKg: 9, weightsKg: [9] }],
              paymentKind: 'none',
              createdBy: 'user-001',
              createdAt: new Date().toISOString(),
            }),
          },
          {
            id: 'merch-remote',
            data: () => ({
              id: 'merch-remote',
              storeId: 'store-001',
              shiftId: 'shift-001',
              lines: [{ id: 'y', rubroId: 'rubro_maple', rubroName: 'Maple', template: 'count', count: 4, unitCount: 4 }],
              paymentKind: 'none',
              paidAmount: 0,
              debtAmount: 0,
              createdBy: 'user-001',
              createdAt: new Date().toISOString(),
            }),
          },
          {
            id: 'merch-legacy',
            data: () => ({
              id: 'merch-legacy',
              storeId: 'store-001',
              shiftId: 'shift-001',
              category: 'Carbón',
              unit: 'u',
              quantity: 10,
              paymentKind: 'none',
              createdBy: 'user-001',
              createdAt: new Date().toISOString(),
            }),
          },
          {
            id: 'merch-deleted',
            data: () => ({ deleted: true, shiftId: 'shift-001', createdBy: 'user-001' }),
          },
        ],
      } as never)

      const upserted = await pullMerchandiseIntakesForStoreWeek(
        TENANT,
        'store-001',
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
      )
      expect(upserted).toBe(2)
      const pending = db.select().from(merchandiseIntakes).all().find(r => r.id === 'merch-pending')
      const pendingLine = db.select().from(merchandiseIntakeLines).all().find(r => r.intakeId === 'merch-pending')
      expect(pendingLine?.rubroName).toBe('Local')
      const remoteLine = db.select().from(merchandiseIntakeLines).all().find(r => r.intakeId === 'merch-remote')
      expect(remoteLine?.rubroName).toBe('Maple')
      expect(remoteLine?.count).toBe(4)
      const legacyLine = db.select().from(merchandiseIntakeLines).all().find(r => r.intakeId === 'merch-legacy')
      expect(legacyLine?.rubroId).toBe('rubro_carbon')
      expect(legacyLine?.count).toBe(10)
      expect(pending).toBeTruthy()
    })
  })
})
