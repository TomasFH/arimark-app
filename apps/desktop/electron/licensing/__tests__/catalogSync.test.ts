/**
 * Tests de syncCatalogWithFirestore: merge por producto (altas/precios/bajas)
 * y no pisar el catálogo local con un snapshot incompleto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, products, productPrices, storeProducts } from '../../db/schema'

const { mockGetDoc, mockPublishCatalog, mockOnSnapshot, mockNotifyRenderer } = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockPublishCatalog: vi.fn().mockResolvedValue(undefined),
  mockOnSnapshot: vi.fn().mockReturnValue(vi.fn()),
  mockNotifyRenderer: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => {
    const parts = args.filter((a): a is string => typeof a === 'string')
    return { path: parts.join('/') }
  },
  getDoc: mockGetDoc,
  onSnapshot: mockOnSnapshot,
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

vi.mock('../catalogPublish', () => ({
  publishCatalog: mockPublishCatalog,
  publishCatalogForAllStores: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../notifyRenderer', () => ({
  notifyRenderer: mockNotifyRenderer,
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(() => ({
    userId: 'user-001',
    storeId: 'store-001',
    role: 'cashier',
    shiftId: null,
  })),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('uuid', () => {
  let n = 0
  return { v4: () => `uuid-${++n}` }
})

import { getDb } from '../../db/client'
import { isFirebaseAvailable } from '../firebase'
import {
  syncCatalogWithFirestore,
  syncAllStoreCatalogs,
  pullCatalogFromFirestore,
  startCatalogSyncListener,
  stopCatalogSyncListener,
} from '../catalogSync'

const TENANT = 'test-tenant'
const STORE = 'store-001'

function remoteSnap(productsList: unknown[], updatedAt: string, deletedProductIds: string[] = []) {
  return {
    exists: () => true,
    data: () => ({ products: productsList, updatedAt, deletedProductIds }),
  }
}

function missingSnap() {
  return { exists: () => false, data: () => undefined }
}

describe('catalogSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    stopCatalogSyncListener()
    vi.clearAllMocks()
    mockPublishCatalog.mockResolvedValue(undefined)
    mockOnSnapshot.mockReturnValue(vi.fn())
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    mockGetDoc.mockResolvedValue(missingSnap())

    const instance = await createInMemoryDb()
    db = instance.db
    const now = '2026-01-01T00:00:00.000Z'

    db.insert(stores).values({ id: STORE, name: 'Local A', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera',
      storeId: STORE,
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  function addPrice(productId: string, storeId = STORE, id = `price-${productId}`, validFrom = '2026-01-01T00:00:00.000Z', price = 1000): void {
    db.insert(productPrices).values({
      id,
      productId,
      storeId,
      price,
      validFrom,
      validTo: null,
      createdBy: 'user-001',
    }).run()
  }

  it('SQLite vacío → pull del snapshot remoto', async () => {
    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-remoto',
        pluNumber: 1,
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        price: 18000,
      },
    ], '2026-08-01T00:00:00.000Z'))

    await syncCatalogWithFirestore(TENANT, STORE)

    expect(mockPublishCatalog).not.toHaveBeenCalled()
    const rows = db.select().from(products).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('prod-remoto')
    expect(rows[0]?.name).toBe('Asado')
  })

  it('une producto solo-local con producto solo-remoto y publica', async () => {
    db.insert(products).values({
      id: 'prod-local',
      name: 'Vacío',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 2,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
    addPrice('prod-local')

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-remoto',
        pluNumber: 999,
        name: 'Prueba 999',
        category: 'other',
        unit: 'kg',
        price: 99999,
        updatedAt: '2026-08-15T09:00:00.000Z',
      },
    ], '2026-08-15T09:00:00.000Z'))

    await syncCatalogWithFirestore(TENANT, STORE)

    expect(mockPublishCatalog).toHaveBeenCalledWith(TENANT, STORE)
    const ids = db.select({ id: products.id }).from(products).all().map(r => r.id)
    expect(ids).toContain('prod-local')
    expect(ids).toContain('prod-remoto')
    const remoto = db.select().from(products).all().find(r => r.id === 'prod-remoto')
    expect(remoto?.pluNumber).toBe(999)
    expect(remoto?.active).toBe(true)
  })

  it('respeta el precio local más nuevo y aplica el producto remoto extra', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Asado',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 1,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
    }).run()
    addPrice('prod-a', STORE, 'price-a', '2026-08-15T12:00:00.000Z', 50000)

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-a',
        pluNumber: 1,
        name: 'Asado viejo',
        category: 'beef_cut',
        unit: 'kg',
        price: 10000,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        productId: 'prod-c',
        pluNumber: 3,
        name: 'Pollo',
        category: 'poultry',
        unit: 'kg',
        price: 9000,
        updatedAt: '2026-08-15T09:00:00.000Z',
      },
    ], '2026-08-15T09:00:00.000Z'))

    await syncCatalogWithFirestore(TENANT, STORE)

    expect(mockPublishCatalog).toHaveBeenCalledWith(TENANT, STORE)
    const asado = db.select().from(products).all().find(r => r.id === 'prod-a')
    expect(asado?.name).toBe('Asado')
    const precio = db.select().from(productPrices).all().find(r => r.productId === 'prod-a' && r.validTo == null)
    expect(precio?.price).toBe(50000)
    const ids = db.select({ id: products.id }).from(products).all().map(r => r.id)
    expect(ids).toContain('prod-c')
  })

  it('aplica baja remota y conserva el producto local que no está en deleted', async () => {
    db.insert(products).values([
      { id: 'prod-a', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'prod-b', name: 'Vacío', category: 'beef_cut', unit: 'kg', pluNumber: 2, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]).run()
    addPrice('prod-a')
    addPrice('prod-b')

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-a',
        pluNumber: 1,
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        price: 18000,
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    ], '2026-08-15T00:00:00.000Z', ['prod-b']))

    await syncCatalogWithFirestore(TENANT, STORE)

    const b = db.select().from(products).all().find(r => r.id === 'prod-b')
    expect(b?.active).toBe(false)
    expect(b?.pluNumber).toBeNull()
    const a = db.select().from(products).all().find(r => r.id === 'prod-a')
    expect(a?.active).toBe(true)
  })

  it('no reactiva un producto borrado localmente aunque Firestore todavía lo liste', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Asado',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: null,
      active: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
    db.insert(products).values({
      id: 'prod-b',
      name: 'Vacío',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 2,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
    addPrice('prod-b')

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-a',
        pluNumber: 1,
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        price: 18000,
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    ], '2026-08-15T00:00:00.000Z'))

    await syncCatalogWithFirestore(TENANT, STORE)

    const a = db.select().from(products).all().find(r => r.id === 'prod-a')
    expect(a?.active).toBe(false)
    expect(mockPublishCatalog).toHaveBeenCalledWith(TENANT, STORE)
  })

  it('local con productos y Firestore ausente → publish', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Asado',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 1,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
    addPrice('prod-a')
    mockGetDoc.mockResolvedValue(missingSnap())

    await syncCatalogWithFirestore(TENANT, STORE)

    expect(mockPublishCatalog).toHaveBeenCalledWith(TENANT, STORE)
  })

  it('syncAllStoreCatalogs recorre cada local activo', async () => {
    db.insert(stores).values({
      id: 'store-002',
      name: 'Local B',
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
    db.insert(products).values({
      id: 'prod-a',
      name: 'Asado',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 1,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
    addPrice('prod-a')

    await syncAllStoreCatalogs(TENANT)

    expect(mockPublishCatalog).toHaveBeenCalledWith(TENANT, STORE)
    expect(mockPublishCatalog).not.toHaveBeenCalledWith(TENANT, 'store-002')
  })

  it('trae precio de un producto local sin precio si Firestore lo tiene', async () => {
    db.insert(products).values([
      { id: 'prod-a', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, active: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'prod-b', name: 'Vacío', category: 'beef_cut', unit: 'kg', pluNumber: 2, active: true, createdAt: '2026-08-14T00:00:00.000Z' },
    ]).run()
    addPrice('prod-a')

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-a',
        pluNumber: 1,
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        price: 18000,
      },
      {
        productId: 'prod-b',
        pluNumber: 2,
        name: 'Vacío',
        category: 'beef_cut',
        unit: 'kg',
        price: 23000,
      },
    ], '2026-08-15T00:00:00.000Z'))

    await syncCatalogWithFirestore(TENANT, STORE)

    expect(mockPublishCatalog).toHaveBeenCalledWith(TENANT, STORE)
    const priceB = db.select().from(productPrices).all().find(r => r.productId === 'prod-b' && r.validTo == null)
    expect(priceB?.price).toBe(23000)
  })

  it('no pisa el nombre local con un snapshot de lote (updatedAt = sello del documento)', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Probando 999',
      category: 'other',
      unit: 'kg',
      pluNumber: 999,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-16T02:00:00.000Z',
    }).run()
    addPrice('prod-a', STORE, 'price-a', '2026-08-16T02:00:00.000Z', 999)

    const docStamp = '2026-08-16T03:00:00.000Z'
    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-a',
        pluNumber: 999,
        name: 'Probando 999 2',
        category: 'other',
        unit: 'kg',
        price: 99999,
        updatedAt: docStamp,
      },
    ], docStamp))

    await syncCatalogWithFirestore(TENANT, STORE)

    const row = db.select().from(products).all().find(r => r.id === 'prod-a')
    expect(row?.name).toBe('Probando 999')
    const precio = db.select().from(productPrices).all().find(r => r.productId === 'prod-a' && r.validTo == null)
    expect(precio?.price).toBe(999)
  })

  it('aplica el nombre remoto si el ítem tiene updatedAt propio más nuevo que el local', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Probando 999 2',
      category: 'other',
      unit: 'kg',
      pluNumber: 999,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }).run()
    addPrice('prod-a')

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-a',
        pluNumber: 999,
        name: 'Probando 999',
        category: 'other',
        unit: 'kg',
        price: 999,
        updatedAt: '2026-08-16T02:00:00.000Z',
        priceUpdatedAt: '2026-08-16T02:00:00.000Z',
      },
    ], '2026-08-16T03:00:00.000Z'))

    await syncCatalogWithFirestore(TENANT, STORE)

    const row = db.select().from(products).all().find(r => r.id === 'prod-a')
    expect(row?.name).toBe('Probando 999')
    const precio = db.select().from(productPrices).all().find(r => r.productId === 'prod-a' && r.validTo == null)
    expect(precio?.price).toBe(999)
  })

  it('omite sync si Firebase no está disponible', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
    await syncCatalogWithFirestore(TENANT, STORE)
    expect(mockGetDoc).not.toHaveBeenCalled()
    expect(mockPublishCatalog).not.toHaveBeenCalled()
  })

  it('pull libera PLU ocupado por otro productId (UNIQUE plu_number)', async () => {
    db.insert(products).values({
      id: 'prod-local-viejo',
      name: 'Asado viejo',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 1,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-remoto',
        pluNumber: 1,
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        price: 18000,
      },
    ], '2026-08-01T00:00:00.000Z'))

    await pullCatalogFromFirestore(TENANT, STORE)

    const rows = db.select().from(products).all()
    const remoto = rows.find(r => r.id === 'prod-remoto')
    const viejo = rows.find(r => r.id === 'prod-local-viejo')
    expect(remoto?.pluNumber).toBe(1)
    expect(viejo?.pluNumber).toBeNull()
  })

  it('aplica available=false remoto en store_products del local', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Carbón',
      category: 'other',
      unit: 'unit',
      pluNumber: 600,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    }).run()
    addPrice('prod-a')

    mockGetDoc.mockResolvedValue(remoteSnap([
      {
        productId: 'prod-a',
        pluNumber: 600,
        name: 'Carbón',
        category: 'other',
        unit: 'unit',
        price: 1500,
        updatedAt: '2026-08-16T00:00:00.000Z',
        available: false,
      },
    ], '2026-08-16T00:00:00.000Z'))

    await syncCatalogWithFirestore(TENANT, STORE)

    const row = db.select().from(storeProducts).all().find(r => r.productId === 'prod-a' && r.storeId === STORE)
    expect(row?.available).toBe(false)
  })

  describe('startCatalogSyncListener', () => {
    function snapshotHandler(): (snap: unknown) => Promise<unknown> {
      const call = mockOnSnapshot.mock.calls[0]
      if (!call) throw new Error('onSnapshot no registrado')
      return call[1] as (snap: unknown) => Promise<unknown>
    }

    async function emitSnap(
      productsList: unknown[],
      updatedAt: string,
      deletedProductIds: string[] = [],
    ): Promise<void> {
      await snapshotHandler()(remoteSnap(productsList, updatedAt, deletedProductIds))
    }

    afterEach(() => {
      stopCatalogSyncListener()
    })

    it('registra onSnapshot en licenses/{tenant}/catalog/{storeId}', () => {
      startCatalogSyncListener(TENANT)
      expect(mockOnSnapshot).toHaveBeenCalledTimes(1)
      expect(mockOnSnapshot.mock.calls[0]?.[0]).toEqual({
        path: `licenses/${TENANT}/catalog/${STORE}`,
      })
    })

    it('inserta un producto nuevo desconocido en SQLite', async () => {
      startCatalogSyncListener(TENANT)
      await emitSnap([{
        productId: 'prod-nuevo',
        pluNumber: 7,
        name: 'Matambre',
        category: 'beef_cut',
        unit: 'kg',
        price: 22000,
        updatedAt: '2026-08-20T00:00:00.000Z',
      }], '2026-08-20T00:00:00.000Z')

      const row = db.select().from(products).all().find(r => r.id === 'prod-nuevo')
      expect(row?.name).toBe('Matambre')
      expect(row?.pluNumber).toBe(7)
      expect(row?.active).toBe(true)
    })

    it('snapshot incompleto no borra el producto local y republica el union', async () => {
      db.insert(products).values({
        id: 'prod-local',
        name: 'Vacío',
        category: 'beef_cut',
        unit: 'kg',
        pluNumber: 2,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      }).run()
      addPrice('prod-local')

      startCatalogSyncListener(TENANT)
      await emitSnap([{
        productId: 'prod-remoto',
        pluNumber: 9,
        name: 'Pollo',
        category: 'poultry',
        unit: 'kg',
        price: 9000,
        updatedAt: '2026-08-20T00:00:00.000Z',
      }], '2026-08-20T00:00:00.000Z')

      const local = db.select().from(products).all().find(r => r.id === 'prod-local')
      expect(local?.active).toBe(true)
      expect(local?.name).toBe('Vacío')
      expect(mockPublishCatalog).toHaveBeenCalledWith(TENANT, STORE)
    })

    it('snapshot eco (mismos ids/precios, local ≥ remoto) no llama publishCatalog', async () => {
      db.insert(products).values({
        id: 'prod-a',
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        pluNumber: 1,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-08-20T12:00:00.000Z',
      }).run()
      addPrice('prod-a', STORE, 'price-a', '2026-08-20T12:00:00.000Z', 18000)

      startCatalogSyncListener(TENANT)
      await emitSnap([{
        productId: 'prod-a',
        pluNumber: 1,
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        price: 18000,
        updatedAt: '2026-08-20T12:00:00.000Z',
        priceUpdatedAt: '2026-08-20T12:00:00.000Z',
      }], '2026-08-20T12:00:00.000Z')

      expect(mockPublishCatalog).not.toHaveBeenCalled()
    })

    it('no pisa identidad local más nueva (products.updatedAt > remoto)', async () => {
      db.insert(products).values({
        id: 'prod-a',
        name: 'Asado local',
        category: 'beef_cut',
        unit: 'kg',
        pluNumber: 1,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-08-28T00:00:00.000Z',
      }).run()
      addPrice('prod-a', STORE, 'price-a', '2026-08-28T00:00:00.000Z', 50000)

      startCatalogSyncListener(TENANT)
      await emitSnap([{
        productId: 'prod-a',
        pluNumber: 1,
        name: 'Asado viejo',
        category: 'beef_cut',
        unit: 'kg',
        price: 10000,
        updatedAt: '2026-08-01T00:00:00.000Z',
        priceUpdatedAt: '2026-08-01T00:00:00.000Z',
      }], '2026-08-01T00:00:00.000Z')

      const row = db.select().from(products).all().find(r => r.id === 'prod-a')
      expect(row?.name).toBe('Asado local')
      expect(mockPublishCatalog).not.toHaveBeenCalled()
    })

    it('aplica precio remoto más nuevo y conserva el local más nuevo', async () => {
      db.insert(products).values([
        {
          id: 'prod-remote-wins',
          name: 'Asado',
          category: 'beef_cut',
          unit: 'kg',
          pluNumber: 1,
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'prod-local-wins',
          name: 'Vacío',
          category: 'beef_cut',
          unit: 'kg',
          pluNumber: 2,
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
      ]).run()
      addPrice('prod-remote-wins', STORE, 'price-r', '2026-08-01T00:00:00.000Z', 10000)
      addPrice('prod-local-wins', STORE, 'price-l', '2026-08-20T00:00:00.000Z', 40000)

      startCatalogSyncListener(TENANT)
      await emitSnap([
        {
          productId: 'prod-remote-wins',
          pluNumber: 1,
          name: 'Asado',
          category: 'beef_cut',
          unit: 'kg',
          price: 18000,
          updatedAt: '2026-08-01T00:00:00.000Z',
          priceUpdatedAt: '2026-08-25T00:00:00.000Z',
        },
        {
          productId: 'prod-local-wins',
          pluNumber: 2,
          name: 'Vacío',
          category: 'beef_cut',
          unit: 'kg',
          price: 9000,
          updatedAt: '2026-08-20T00:00:00.000Z',
          priceUpdatedAt: '2026-08-01T00:00:00.000Z',
        },
      ], '2026-08-25T00:00:00.000Z')

      const precioRemoto = db.select().from(productPrices).all()
        .find(r => r.productId === 'prod-remote-wins' && r.validTo == null)
      const precioLocal = db.select().from(productPrices).all()
        .find(r => r.productId === 'prod-local-wins' && r.validTo == null)
      expect(precioRemoto?.price).toBe(18000)
      expect(precioLocal?.price).toBe(40000)
    })

    it('deletedProductIds desactiva el producto local y libera el PLU', async () => {
      db.insert(products).values({
        id: 'prod-b',
        name: 'Vacío',
        category: 'beef_cut',
        unit: 'kg',
        pluNumber: 2,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      }).run()
      addPrice('prod-b')

      startCatalogSyncListener(TENANT)
      await emitSnap([], '2026-08-20T00:00:00.000Z', ['prod-b'])

      const b = db.select().from(products).all().find(r => r.id === 'prod-b')
      expect(b?.active).toBe(false)
      expect(b?.pluNumber).toBeNull()
    })

    it('stopCatalogSyncListener llama unsubscribe y el segundo start no duplica', () => {
      const unsub = vi.fn()
      mockOnSnapshot.mockReturnValue(unsub)

      startCatalogSyncListener(TENANT)
      startCatalogSyncListener(TENANT)
      expect(mockOnSnapshot).toHaveBeenCalledTimes(1)

      stopCatalogSyncListener()
      expect(unsub).toHaveBeenCalledTimes(1)

      mockOnSnapshot.mockClear()
      mockOnSnapshot.mockReturnValue(vi.fn())
      startCatalogSyncListener(TENANT)
      expect(mockOnSnapshot).toHaveBeenCalledTimes(1)
    })

    it('isFirebaseAvailable() === false no registra listener', () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      startCatalogSyncListener(TENANT)
      expect(mockOnSnapshot).not.toHaveBeenCalled()
    })

    it('tras merge con applied > 0 llama notifyRenderer', async () => {
      startCatalogSyncListener(TENANT)
      await emitSnap([{
        productId: 'prod-aviso',
        pluNumber: 11,
        name: 'Bondiola',
        category: 'pork',
        unit: 'kg',
        price: 15000,
        updatedAt: '2026-08-20T00:00:00.000Z',
      }], '2026-08-20T00:00:00.000Z')

      expect(mockNotifyRenderer).toHaveBeenCalledWith('ipc:catalog-sync-updated', { storeId: STORE })
    })
  })
})
