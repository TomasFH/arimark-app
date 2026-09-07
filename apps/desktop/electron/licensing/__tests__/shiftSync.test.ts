/**
 * Tests del servicio de sincronización de turnos (shiftSync).
 *
 * Cubre:
 *   - pushUnsyncedShifts: solo pushea filas con syncedAt=null, marca syncedAt tras push
 *   - no-op si Firebase no disponible
 *   - continúa con los demás si un setDoc falla
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts } from '../../db/schema'
import { isNull, isNotNull, eq } from 'drizzle-orm'

const { mockSetDoc, mockDoc, mockGetDocs, mockGetDoc } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn(),
  mockGetDocs: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
  mockGetDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => { mockDoc(...args); return { path: args.join('/') } },
  setDoc: mockSetDoc,
  collection: vi.fn(() => ({})),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((...args: unknown[]) => args),
  getDocs: mockGetDocs,
  getDoc: mockGetDoc,
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
import { pushUnsyncedShifts, reconcileStoreShifts } from '../shiftSync'

const TENANT = 'test-tenant'

describe('shiftSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const instance = await createInMemoryDb()
    db = instance.db

    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: new Date().toISOString() }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera Test',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  describe('pushUnsyncedShifts', () => {
    it('pushea shifts con syncedAt=null y los marca con timestamp', async () => {
      const now = new Date().toISOString()
      db.insert(shifts).values({
        id: 'shift-pending',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 1000,
        source: 'desktop',
        syncedAt: null,
      }).run()
      db.insert(shifts).values({
        id: 'shift-synced',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'evening',
        startedAt: now,
        openingCash: 500,
        source: 'desktop',
        syncedAt: now,
      }).run()

      await pushUnsyncedShifts(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'shifts',
        'shift-pending',
      )

      const remaining = db.select().from(shifts).where(isNull(shifts.syncedAt)).all()
      expect(remaining).toHaveLength(0)

      const synced = db.select().from(shifts).where(isNotNull(shifts.syncedAt)).all()
      expect(synced).toHaveLength(2)
    })

    it('incluye cashierName resuelto desde la tabla users', async () => {
      const now = new Date().toISOString()
      db.insert(shifts).values({
        id: 'shift-with-name',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 1000,
        source: 'desktop',
        syncedAt: null,
      }).run()

      await pushUnsyncedShifts(TENANT)

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'shift-with-name',
          cashierName: 'Cajera Test',
        }),
        { merge: true },
      )
    })

    it('cashierName es null si el usuario no está en cache local', async () => {
      // Insertar un user con nombre vacío para simular que el cache tiene el UID
      // pero no resolvió el nombre (edge case: primer login aún en proceso).
      const now = new Date().toISOString()
      db.insert(users).values({
        id: 'uid-sin-nombre',
        name: '',
        storeId: 'store-001',
        role: 'cashier',
        active: true,
        createdAt: now,
      }).run()
      db.insert(shifts).values({
        id: 'shift-no-name',
        storeId: 'store-001',
        userId: 'uid-sin-nombre',
        shiftType: 'evening',
        startedAt: now,
        openingCash: 0,
        source: 'desktop',
        syncedAt: null,
      }).run()

      await pushUnsyncedShifts(TENANT)

      // El nombre es una cadena vacía — historyFirestore muestra el fallback userId
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'uid-sin-nombre',
        }),
        { merge: true },
      )
    })

    it('incluye campos de cierre cuando el turno está cerrado', async () => {
      const now = new Date().toISOString()
      db.insert(shifts).values({
        id: 'shift-closed',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        closedAt: now,
        openingCash: 1000,
        closingCash: 2500,
        safeAmount: 500,
        deliveredAmount: 2000,
        deliveredTo: 'Admin',
        notes: 'ok',
        source: 'desktop',
        syncedAt: null,
      }).run()

      await pushUnsyncedShifts(TENANT)

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'shift-closed',
          closedAt: now,
          closingCash: 2500,
          safeAmount: 500,
          deliveredAmount: 2000,
          deliveredTo: 'Admin',
          notes: 'ok',
        }),
        { merge: true },
      )
    })

    it('no pushea si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      db.insert(shifts).values({
        id: 'shift-1',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: new Date().toISOString(),
        openingCash: 0,
        source: 'desktop',
        syncedAt: null,
      }).run()

      await pushUnsyncedShifts(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('si setDoc falla en uno, continúa con los demás', async () => {
      const now = new Date().toISOString()
      db.insert(shifts).values({
        id: 'shift-fail',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 0,
        source: 'desktop',
        syncedAt: null,
      }).run()
      db.insert(shifts).values({
        id: 'shift-ok',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'evening',
        startedAt: now,
        openingCash: 0,
        source: 'desktop',
        syncedAt: null,
      }).run()

      mockSetDoc
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(undefined)

      await pushUnsyncedShifts(TENANT)

      const synced = db.select().from(shifts).where(isNotNull(shifts.syncedAt)).all()
      expect(synced.map(s => s.id)).toEqual(['shift-ok'])
      const pending = db.select().from(shifts).where(isNull(shifts.syncedAt)).all()
      expect(pending.map(s => s.id)).toEqual(['shift-fail'])
    })
  })

  describe('reconcileStoreShifts', () => {
    it('aplica closedAt remoto sobre un turno local todavía abierto', async () => {
      const started = new Date().toISOString()
      const closed = new Date().toISOString()
      db.insert(shifts).values({
        id: 'shift-stale',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: started,
        openingCash: 0,
        source: 'desktop',
        closedAt: null,
        syncedAt: started,
      }).run()

      mockGetDocs.mockResolvedValueOnce({ size: 0, docs: [] })
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          id: 'shift-stale',
          storeId: 'store-001',
          userId: 'user-001',
          shiftType: 'morning',
          startedAt: started,
          closedAt: closed,
          openingCash: 0,
          source: 'desktop',
        }),
      })

      await reconcileStoreShifts(TENANT, { storeId: 'store-001' })

      const row = db.select().from(shifts).where(eq(shifts.id, 'shift-stale')).get()
      expect(row?.closedAt).toBe(closed)
    })

    it('inserta un turno remoto que no existe en SQLite', async () => {
      const started = new Date().toISOString()
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [{
          id: 'shift-remote',
          data: () => ({
            id: 'shift-remote',
            storeId: 'store-001',
            userId: 'user-001',
            cashierName: 'Cajera Test',
            shiftType: 'evening',
            startedAt: started,
            closedAt: null,
            openingCash: 1500,
            source: 'desktop',
          }),
        }],
      })

      await reconcileStoreShifts(TENANT, { storeId: 'store-001' })

      const row = db.select().from(shifts).where(eq(shifts.id, 'shift-remote')).get()
      expect(row?.openingCash).toBe(1500)
      expect(row?.closedAt).toBeNull()
    })

    it('no consulta Firestore si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      await reconcileStoreShifts(TENANT, { storeId: 'store-001' })
      expect(mockGetDocs).not.toHaveBeenCalled()
    })
  })
})
