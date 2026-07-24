/**
 * Tests del servicio de sincronización de proveedores (providerSync).
 *
 * Cubre:
 *   - pushUnsyncedProviders: solo pushea filas con syncedAt=null, marca syncedAt tras push
 *   - pushUnsyncedDebtEvents: ídem para eventos de deuda
 *   - startProviderSyncListener: onSnapshot upsertea providers en cache local
 *
 * Firebase/Firestore se mockea completamente; no se necesita conexión real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, providers, providerDebtEvents, shifts } from '../../db/schema'
import { isNull, isNotNull } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Mocks de Firebase
// ---------------------------------------------------------------------------

const { mockSetDoc, mockOnSnapshot, mockCollection, mockDoc } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockOnSnapshot: vi.fn(),
  mockCollection: vi.fn(),
  mockDoc: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: (...args: unknown[]) => { mockCollection(...args); return {} },
  doc: (...args: unknown[]) => { mockDoc(...args); return {} },
  setDoc: mockSetDoc,
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
import { providerIdFromName } from '../../ipc/providerUtils'

// Importar las funciones a testear después de los mocks
import {
  pushUnsyncedProviders,
  pushUnsyncedDebtEvents,
  startProviderSyncListener,
  stopProviderSyncListener,
} from '../providerSync'

const LICENSE = 'test-license-key'

describe('providerSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
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

    // El turno es necesario para el FK de provider_debt_events
    db.insert(shifts).values({
      id: 'shift-001',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: new Date().toISOString(),
      openingCash: 0,
      source: 'desktop',
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  // -------------------------------------------------------------------------
  describe('pushUnsyncedProviders', () => {
    it('pushea providers con syncedAt=null y los marca con timestamp', async () => {
      const id1 = providerIdFromName('oso')
      const id2 = providerIdFromName('conejo')
      const now = new Date().toISOString()

      db.insert(providers).values({ id: id1, name: 'Oso', nameKey: 'oso', createdAt: now, syncedAt: null }).run()
      db.insert(providers).values({ id: id2, name: 'Conejo', nameKey: 'conejo', createdAt: now, syncedAt: null }).run()

      await pushUnsyncedProviders(LICENSE)

      // setDoc llamado una vez por provider pendiente
      expect(mockSetDoc).toHaveBeenCalledTimes(2)

      // Ambos deben tener syncedAt != null tras el push
      const remaining = db.select().from(providers).where(isNull(providers.syncedAt)).all()
      expect(remaining).toHaveLength(0)

      const synced = db.select().from(providers).where(isNotNull(providers.syncedAt)).all()
      expect(synced).toHaveLength(2)
    })

    it('no pushea providers que ya tienen syncedAt', async () => {
      const id = providerIdFromName('ya sincronizado')
      db.insert(providers).values({
        id,
        name: 'Ya Sincronizado',
        nameKey: 'ya sincronizado',
        createdAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(), // ya sincronizado
      }).run()

      await pushUnsyncedProviders(LICENSE)

      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('no hace nada cuando no hay providers pendientes', async () => {
      await pushUnsyncedProviders(LICENSE)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('si setDoc falla en uno, continúa con los demás', async () => {
      const id1 = providerIdFromName('falla')
      const id2 = providerIdFromName('ok')
      const now = new Date().toISOString()

      db.insert(providers).values({ id: id1, name: 'Falla', nameKey: 'falla', createdAt: now, syncedAt: null }).run()
      db.insert(providers).values({ id: id2, name: 'Ok', nameKey: 'ok', createdAt: now, syncedAt: null }).run()

      // El primero falla, el segundo tiene éxito
      mockSetDoc
        .mockRejectedValueOnce(new Error('Firestore unavailable'))
        .mockResolvedValueOnce(undefined)

      await pushUnsyncedProviders(LICENSE)

      // Solo el segundo debería estar marcado como sincronizado
      const synced = db.select().from(providers).where(isNotNull(providers.syncedAt)).all()
      expect(synced).toHaveLength(1)
      expect(synced[0]?.nameKey).toBe('ok')
    })
  })

  // -------------------------------------------------------------------------
  describe('pushUnsyncedDebtEvents', () => {
    it('pushea eventos de deuda con syncedAt=null y los marca', async () => {
      const pid = providerIdFromName('proveedor x')
      const now = new Date().toISOString()

      db.insert(providers).values({ id: pid, name: 'Proveedor X', nameKey: 'proveedor x', createdAt: now, syncedAt: now }).run()

      db.insert(providerDebtEvents).values({
        id: 'evt-001',
        storeId: 'store-001',
        providerId: pid,
        provider: 'Proveedor X',
        type: 'debt',
        amount: 15000,
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: null,
      }).run()

      await pushUnsyncedDebtEvents(LICENSE)

      expect(mockSetDoc).toHaveBeenCalledTimes(1)

      const remaining = db.select().from(providerDebtEvents).where(isNull(providerDebtEvents.syncedAt)).all()
      expect(remaining).toHaveLength(0)
    })

    it('no pushea eventos que ya tienen syncedAt', async () => {
      const now = new Date().toISOString()
      db.insert(providerDebtEvents).values({
        id: 'evt-ya-sync',
        storeId: 'store-001',
        provider: 'Proveedor Z',
        type: 'payment',
        amount: 5000,
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: now,
      }).run()

      await pushUnsyncedDebtEvents(LICENSE)
      expect(mockSetDoc).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('startProviderSyncListener / stopProviderSyncListener', () => {
    it('registra un listener onSnapshot', () => {
      const mockUnsub = vi.fn()
      mockOnSnapshot.mockReturnValue(mockUnsub)

      startProviderSyncListener(LICENSE)

      expect(mockOnSnapshot).toHaveBeenCalledTimes(1)
    })

    it('stopProviderSyncListener cancela el listener', () => {
      const mockUnsub = vi.fn()
      mockOnSnapshot.mockReturnValue(mockUnsub)

      startProviderSyncListener(LICENSE)
      stopProviderSyncListener()

      expect(mockUnsub).toHaveBeenCalledTimes(1)
    })

    it('el callback de onSnapshot upsertea providers en la cache local', () => {
      let capturedCallback: (snapshot: unknown) => void = () => {}
      mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: unknown) => void) => {
        capturedCallback = cb
        return vi.fn()
      })

      startProviderSyncListener(LICENSE)

      const pid = providerIdFromName('nuevo desde firestore')
      const now = new Date().toISOString()

      // Simular un snapshot con un proveedor nuevo
      capturedCallback({
        docChanges: () => [
          {
            type: 'added',
            doc: {
              data: () => ({
                id: pid,
                name: 'Nuevo Desde Firestore',
                nameKey: 'nuevo desde firestore',
                phone: null,
                notes: null,
                archivedAt: null,
                createdAt: now,
                createdBy: null,
                updatedAt: null,
                updatedBy: null,
              }),
            },
          },
        ],
      })

      const cached = db.select().from(providers).all()
      expect(cached).toHaveLength(1)
      expect(cached[0]?.name).toBe('Nuevo Desde Firestore')
      // syncedAt se setea porque vino de Firestore — no necesita re-push
      expect(cached[0]?.syncedAt).toBeTruthy()
    })

    it('el callback de onSnapshot actualiza un proveedor existente (upsert)', () => {
      const pid = providerIdFromName('actualizable')
      const now = new Date().toISOString()
      db.insert(providers).values({
        id: pid,
        name: 'Actualizable',
        nameKey: 'actualizable',
        createdAt: now,
        syncedAt: null,
      }).run()

      let capturedCallback: (snapshot: unknown) => void = () => {}
      mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: unknown) => void) => {
        capturedCallback = cb
        return vi.fn()
      })

      startProviderSyncListener(LICENSE)

      capturedCallback({
        docChanges: () => [
          {
            type: 'modified',
            doc: {
              data: () => ({
                id: pid,
                name: 'Actualizable Editado',
                nameKey: 'actualizable',
                phone: '1234-5678',
                notes: null,
                archivedAt: null,
                createdAt: now,
                createdBy: null,
                updatedAt: new Date().toISOString(),
                updatedBy: null,
              }),
            },
          },
        ],
      })

      const cached = db.select().from(providers).all()
      expect(cached).toHaveLength(1)
      expect(cached[0]?.name).toBe('Actualizable Editado')
      expect(cached[0]?.phone).toBe('1234-5678')
      expect(cached[0]?.syncedAt).toBeTruthy()
    })

    it('ignora cambios de tipo "removed"', () => {
      let capturedCallback: (snapshot: unknown) => void = () => {}
      mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: unknown) => void) => {
        capturedCallback = cb
        return vi.fn()
      })

      startProviderSyncListener(LICENSE)

      capturedCallback({
        docChanges: () => [
          {
            type: 'removed',
            doc: { data: () => ({ id: 'x', name: 'X', nameKey: 'x', createdAt: new Date().toISOString() }) },
          },
        ],
      })

      // No debe haberse insertado nada
      const cached = db.select().from(providers).all()
      expect(cached).toHaveLength(0)
    })
  })
})
