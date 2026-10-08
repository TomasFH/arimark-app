/**
 * Tests del servicio de sincronización de locales (storeSync).
 *
 * Cubre:
 *   - pushUnsyncedStores: solo pushea filas con syncedAt=null, marca syncedAt tras push
 *   - no-op si Firebase no disponible
 *   - listener: upsert en SQLite con datos remotos (sin FK a users)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores } from '../../db/schema'
import { isNull, isNotNull } from 'drizzle-orm'

const { mockSetDoc, mockDoc, mockOnSnapshot, mockGetDocs } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockDoc: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockGetDocs: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => { mockDoc(...args); return { path: args.join('/') } },
  collection: vi.fn(() => ({})),
  setDoc: mockSetDoc,
  getDocs: mockGetDocs,
  onSnapshot: mockOnSnapshot,
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

vi.mock('../catalogPublish', () => ({
  publishCatalog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../../db/client'
import { isFirebaseAvailable } from '../firebase'
import {
  pushUnsyncedStores,
  startStoreSyncListener,
  stopStoreSyncListener,
  pullStoresFromFirestore,
  ensureStoresSynced,
} from '../storeSync'
import { STORE_SYNC_BOOTSTRAP, STORE_SYNC_UNARCHIVE } from '../storeSyncMarkers'

const TENANT = 'test-tenant'

describe('storeSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    mockOnSnapshot.mockReturnValue(vi.fn())
    mockGetDocs.mockResolvedValue({ size: 0, docs: [] })
    stopStoreSyncListener()
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    const instance = await createInMemoryDb()
    db = instance.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  describe('pushUnsyncedStores', () => {
    it('pushea stores con syncedAt=null y los marca con timestamp', async () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'store-pending', name: 'Local A', createdAt: now }).run()
      db.insert(stores).values({ id: 'store-synced', name: 'Local B', createdAt: now, syncedAt: now }).run()

      await pushUnsyncedStores(TENANT)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      expect(mockDoc).toHaveBeenCalledWith(
        expect.anything(),
        'licenses',
        TENANT,
        'stores',
        'store-pending',
      )

      const pending = db.select().from(stores).where(isNull(stores.syncedAt)).all()
      expect(pending).toHaveLength(0)

      const synced = db.select().from(stores).where(isNotNull(stores.syncedAt)).all()
      expect(synced).toHaveLength(2)
    })

    it('incluye regla de descuento efectivo en el push', async () => {
      db.insert(stores).values({
        id: 'store-disc',
        name: 'Local D',
        createdAt: new Date().toISOString(),
        cashDiscountMinAmount: 50000,
        cashDiscountPercent: 10,
      }).run()

      await pushUnsyncedStores(TENANT)

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'store-disc',
          cashDiscountMinAmount: 50000,
          cashDiscountPercent: 10,
        }),
        { merge: true },
      )
    })

    it('no pushea si Firebase no está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      db.insert(stores).values({ id: 'store-1', name: 'Local X', createdAt: new Date().toISOString() }).run()

      await pushUnsyncedStores(TENANT)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('si setDoc falla, continúa con los demás', async () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'store-fail', name: 'Local Fail', createdAt: now }).run()
      db.insert(stores).values({ id: 'store-ok', name: 'Local OK', createdAt: now }).run()

      mockSetDoc
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue(undefined)

      await pushUnsyncedStores(TENANT)

      // El segundo sí se pusheó
      const pending = db.select().from(stores).where(isNull(stores.syncedAt)).all()
      expect(pending).toHaveLength(1)
      expect(pending[0].id).toBe('store-fail')
    })
  })

  describe('startStoreSyncListener', () => {
    it('no arranca si Firebase no disponible', () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      startStoreSyncListener(TENANT)
      expect(mockOnSnapshot).not.toHaveBeenCalled()
    })

    it('llama onSnapshot con la colección correcta', () => {
      startStoreSyncListener(TENANT)
      expect(mockOnSnapshot).toHaveBeenCalledTimes(1)
    })

    it('upsertea stores remotos sin FK conflict (createdBy es null)', () => {
      // Simular callback del snapshot
      const fakeUnsub = vi.fn()
      mockOnSnapshot.mockImplementation((_col: unknown, cb: (snap: unknown) => void) => {
        cb({
          docChanges: () => [
            {
              type: 'added',
              doc: {
                id: 'store-remote',
                data: () => ({
                  id: 'store-remote',
                  name: 'Local Remoto',
                  createdAt: new Date().toISOString(),
                  address: null,
                  archivedAt: null,
                }),
              },
            },
          ],
        })
        return fakeUnsub
      })

      startStoreSyncListener(TENANT)

      const inserted = db.select().from(stores).all().find(s => s.id === 'store-remote')
      expect(inserted).toBeDefined()
      expect(inserted!.name).toBe('Local Remoto')
      expect(inserted!.syncedAt).not.toBeNull()
    })

    it('no registra un segundo listener si ya hay uno activo', () => {
      mockOnSnapshot.mockReturnValue(vi.fn())
      startStoreSyncListener(TENANT)
      startStoreSyncListener(TENANT)
      expect(mockOnSnapshot).toHaveBeenCalledTimes(1)
    })
  })

  describe('pullStoresFromFirestore', () => {
    it('upsertea docs de getDocs en SQLite', async () => {
      const createdAt = new Date().toISOString()
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'store-pull',
            data: () => ({
              id: 'store-pull',
              name: 'Local Actualizado',
              createdAt,
              address: 'Calle 1',
              archivedAt: null,
            }),
          },
        ],
      })

      await pullStoresFromFirestore(TENANT)

      const row = db.select().from(stores).all().find(s => s.id === 'store-pull')
      expect(row).toBeDefined()
      expect(row!.name).toBe('Local Actualizado')
      expect(row!.address).toBe('Calle 1')
    })

    it('no pisa un store local con syncedAt=null (outbox pendiente de push)', async () => {
      const createdAt = new Date().toISOString()
      const archivedAt = new Date().toISOString()
      db.insert(stores).values({
        id: 'store-pending-archive',
        name: 'Archivado local',
        createdAt,
        archivedAt,
        syncedAt: null,
      }).run()

      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'store-pending-archive',
            data: () => ({
              id: 'store-pending-archive',
              name: 'Nombre remoto viejo',
              createdAt,
              archivedAt: null,
            }),
          },
        ],
      })

      await pullStoresFromFirestore(TENANT)

      const row = db.select().from(stores).all().find(s => s.id === 'store-pending-archive')
      expect(row!.name).toBe('Archivado local')
      expect(row!.archivedAt).toBe(archivedAt)
      expect(row!.syncedAt).toBeNull()
    })

    it('actualiza nombre de un store ya existente', async () => {
      const createdAt = new Date().toISOString()
      db.insert(stores).values({
        id: 'store-old',
        name: 'Nombre Viejo',
        createdAt,
        syncedAt: createdAt,
      }).run()

      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'store-old',
            data: () => ({
              id: 'store-old',
              name: 'Nombre Nuevo',
              createdAt,
            }),
          },
        ],
      })

      await pullStoresFromFirestore(TENANT)
      const row = db.select().from(stores).all().find(s => s.id === 'store-old')
      expect(row!.name).toBe('Nombre Nuevo')
    })
  })

  describe('ensureStoresSynced', () => {
    it('pushea pendientes, hace pull y arranca listener', async () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'store-pending', name: 'Pendiente', createdAt: now, syncedAt: null }).run()
      mockGetDocs.mockResolvedValueOnce({ size: 0, docs: [] })
      mockOnSnapshot.mockReturnValue(vi.fn())

      await ensureStoresSynced(TENANT)

      expect(mockSetDoc).toHaveBeenCalled()
      expect(mockGetDocs).toHaveBeenCalled()
      expect(mockOnSnapshot).toHaveBeenCalled()
    })

    it('no republica el placeholder si Firestore ya lo tiene eliminado', async () => {
      const createdAt = '2026-01-01T00:00:00.000Z'
      const archivedAt = '2026-10-01T00:00:00.000Z'
      db.insert(stores).values({
        id: 'store-default',
        name: 'Nombre del negocio',
        createdAt,
        syncedAt: STORE_SYNC_BOOTSTRAP,
      }).run()
      db.insert(stores).values({
        id: 'store-real',
        name: 'San Martín',
        createdAt,
        syncedAt: createdAt,
      }).run()

      mockGetDocs.mockResolvedValueOnce({
        size: 2,
        docs: [
          {
            id: 'store-default',
            data: () => ({
              id: 'store-default',
              name: 'Nombre del negocio',
              createdAt,
              archivedAt,
            }),
          },
          {
            id: 'store-real',
            data: () => ({
              id: 'store-real',
              name: 'San Martín',
              createdAt,
              archivedAt: null,
            }),
          },
        ],
      })

      await ensureStoresSynced(TENANT)

      const placeholder = db.select().from(stores).all().find(s => s.id === 'store-default')
      expect(placeholder!.archivedAt).toBe(archivedAt)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('aplica la baja remota sobre una copia local activa que nunca se sincronizó', async () => {
      const createdAt = '2026-01-01T00:00:00.000Z'
      const archivedAt = '2026-10-01T00:00:00.000Z'
      db.insert(stores).values({
        id: 'store-default',
        name: 'Nombre del negocio',
        createdAt,
        syncedAt: null,
      }).run()
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'store-default',
            data: () => ({
              id: 'store-default',
              name: 'Nombre del negocio',
              createdAt,
              archivedAt,
            }),
          },
        ],
      })

      await ensureStoresSynced(TENANT)

      const row = db.select().from(stores).all().find(s => s.id === 'store-default')
      expect(row!.archivedAt).toBe(archivedAt)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('vuelve a empujar la baja local si el remoto la muestra activa sin restauración', async () => {
      const createdAt = '2026-01-01T00:00:00.000Z'
      const archivedAt = '2026-10-01T00:00:00.000Z'
      db.insert(stores).values({
        id: 'store-default',
        name: 'Nombre del negocio',
        createdAt,
        archivedAt,
        syncedAt: createdAt,
      }).run()
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'store-default',
            data: () => ({
              id: 'store-default',
              name: 'Nombre del negocio',
              createdAt,
              archivedAt: null,
            }),
          },
        ],
      })

      await ensureStoresSynced(TENANT)

      const row = db.select().from(stores).all().find(s => s.id === 'store-default')
      expect(row!.archivedAt).toBe(archivedAt)
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'store-default', archivedAt }),
        { merge: true },
      )
    })

    it('acepta una restauración explícita más nueva que la baja local', async () => {
      const createdAt = '2026-01-01T00:00:00.000Z'
      const archivedAt = '2026-10-01T00:00:00.000Z'
      const reactivatedAt = '2026-10-02T00:00:00.000Z'
      db.insert(stores).values({
        id: 'store-default',
        name: 'Nombre del negocio',
        createdAt,
        archivedAt,
        syncedAt: createdAt,
      }).run()
      mockGetDocs.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'store-default',
            data: () => ({
              id: 'store-default',
              name: 'Nombre del negocio',
              createdAt,
              archivedAt: null,
              reactivatedAt,
            }),
          },
        ],
      })

      await ensureStoresSynced(TENANT)

      const row = db.select().from(stores).all().find(s => s.id === 'store-default')
      expect(row!.archivedAt).toBeNull()
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('publica el placeholder solo si Firestore no tiene ese local', async () => {
      db.insert(stores).values({
        id: 'store-default',
        name: 'Nombre del negocio',
        createdAt: '2026-01-01T00:00:00.000Z',
        syncedAt: STORE_SYNC_BOOTSTRAP,
      }).run()
      mockGetDocs.mockResolvedValueOnce({ size: 0, docs: [] })

      await ensureStoresSynced(TENANT)

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'store-default', archivedAt: null }),
        { merge: true },
      )
    })
  })

  describe('restauración explícita', () => {
    it('incluye reactivatedAt al empujar un unarchive', async () => {
      const now = new Date().toISOString()
      db.insert(stores).values({
        id: 'store-back',
        name: 'Local',
        createdAt: now,
        archivedAt: null,
        syncedAt: STORE_SYNC_UNARCHIVE,
      }).run()

      await pushUnsyncedStores(TENANT)

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'store-back',
          archivedAt: null,
          reactivatedAt: expect.any(String),
        }),
        { merge: true },
      )
    })
  })
})
