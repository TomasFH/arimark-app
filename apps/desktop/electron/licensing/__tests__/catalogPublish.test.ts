/**
 * Tests de publicación de catálogo: omite vacío, archiva snapshot previo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, products, productPrices, storeProducts } from '../../db/schema'

const { mockGetDoc, mockSetDoc, mockGetDocs, mockDeleteDoc } = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDocs: vi.fn(),
  mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => ({ path: args.join('/'), id: String(args[args.length - 1]) }),
  collection: (...args: unknown[]) => ({ path: args.join('/') }),
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  query: (...args: unknown[]) => args[0],
  orderBy: vi.fn(),
  deleteDoc: mockDeleteDoc,
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
import { publishCatalog } from '../catalogPublish'

const TENANT = 'test-tenant'
const STORE = 'store-001'

describe('catalogPublish', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    mockSetDoc.mockResolvedValue(undefined)
    mockGetDocs.mockResolvedValue({ docs: [] })
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined })
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)

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

  it('omite publicación si no hay productos con PLU y precio', async () => {
    await publishCatalog(TENANT, STORE)
    expect(mockSetDoc).not.toHaveBeenCalled()
  })

  it('publica y archiva el snapshot anterior', async () => {
    const now = new Date().toISOString()
    db.insert(products).values({
      id: 'prod-a',
      name: 'Asado',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 1,
      active: true,
      createdAt: now,
    }).run()
    db.insert(productPrices).values({
      id: 'price-a',
      productId: 'prod-a',
      storeId: STORE,
      price: 18000,
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: null,
      createdBy: 'user-001',
    }).run()

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        products: [{ productId: 'old', pluNumber: 1, name: 'Viejo', category: 'beef_cut', unit: 'kg', price: 1 }],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    })

    await publishCatalog(TENANT, STORE)

    expect(mockSetDoc).toHaveBeenCalled()
    const payloads = mockSetDoc.mock.calls.map(c => c[1] as { productCount?: number; products?: unknown[] })
    expect(payloads.some(p => p.productCount === 1)).toBe(true)
    expect(payloads.some(p => Array.isArray(p.products) && p.products.length === 1 && 'updatedAt' in p && !('archivedAt' in p))).toBe(true)
  })

  it('publica updatedAt de ficha y priceUpdatedAt por ítem, no el sello del documento', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Asado',
      category: 'beef_cut',
      unit: 'kg',
      pluNumber: 1,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-16T02:00:00.000Z',
    }).run()
    db.insert(productPrices).values({
      id: 'price-a',
      productId: 'prod-a',
      storeId: STORE,
      price: 18000,
      validFrom: '2026-08-10T00:00:00.000Z',
      validTo: null,
      createdBy: 'user-001',
    }).run()

    await publishCatalog(TENANT, STORE)

    const catalogPayload = mockSetDoc.mock.calls
      .map(c => c[1] as { products?: Array<{ updatedAt?: string; priceUpdatedAt?: string }>; updatedAt?: string; archivedAt?: string })
      .find(p => Array.isArray(p.products) && !('archivedAt' in p))
    expect(catalogPayload).toBeDefined()
    expect(catalogPayload!.products![0]?.updatedAt).toBe('2026-08-16T02:00:00.000Z')
    expect(catalogPayload!.products![0]?.priceUpdatedAt).toBe('2026-08-10T00:00:00.000Z')
    expect(catalogPayload!.updatedAt).not.toBe('2026-08-16T02:00:00.000Z')
  })

  it('publica available=false si el producto está oculto en ese local', async () => {
    db.insert(products).values({
      id: 'prod-a',
      name: 'Carbón',
      category: 'other',
      unit: 'unit',
      pluNumber: 600,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }).run()
    db.insert(productPrices).values({
      id: 'price-a',
      productId: 'prod-a',
      storeId: STORE,
      price: 1500,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      createdBy: 'user-001',
    }).run()
    db.insert(storeProducts).values({ storeId: STORE, productId: 'prod-a', available: false }).run()

    await publishCatalog(TENANT, STORE)

    const catalogPayload = mockSetDoc.mock.calls
      .map(c => c[1] as { products?: Array<{ available?: boolean }>; archivedAt?: string })
      .find(p => Array.isArray(p.products) && !('archivedAt' in p))
    expect(catalogPayload?.products?.[0]?.available).toBe(false)
  })
})
