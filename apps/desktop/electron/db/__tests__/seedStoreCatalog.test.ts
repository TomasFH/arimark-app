import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createInMemoryDb } from './helpers/inMemoryDb'
import { productPrices, products, storeProducts, stores, users } from '../schema'
import { and, eq, isNull } from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../client', () => ({
  getDb: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../client'
import {
  ensureCatalogSeedUser,
  ensureMasterCatalogProducts,
  FALLBACK_PRODUCT_ID,
  productIdForPlu,
  seedCatalogOntoStore,
} from '../seedStoreCatalog'

describe('seedCatalogOntoStore', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']
  let tmpDir: string

  beforeEach(async () => {
    const instance = await createInMemoryDb()
    db = instance.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-seed-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('copia productos activos y precios de la lista al local nuevo', () => {
    const now = '2026-09-07T03:00:00.000Z'
    db.insert(stores).values({ id: 'store-new', name: 'Nuevo', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-1', storeId: null, name: 'Sistema', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(products).values({
      id: 'prod-asado', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, active: true, createdAt: now,
    }).run()

    const seeded = seedCatalogOntoStore({
      storeId: 'store-new',
      createdByUserId: 'user-1',
      now,
      listPricesByPlu: new Map([[1, 20000]]),
    })

    expect(seeded).toBe(1)
    expect(db.select().from(storeProducts).where(eq(storeProducts.storeId, 'store-new')).all()).toHaveLength(1)
    const price = db.select().from(productPrices).where(and(
      eq(productPrices.storeId, 'store-new'),
      isNull(productPrices.validTo),
    )).get()
    expect(price?.price).toBe(20000)
  })

  it('no duplica si el local ya tiene precio vigente', () => {
    const now = '2026-09-07T03:00:00.000Z'
    db.insert(stores).values({ id: 'store-new', name: 'Nuevo', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-1', storeId: null, name: 'Sistema', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(products).values({
      id: 'prod-asado', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, active: true, createdAt: now,
    }).run()
    db.insert(storeProducts).values({ storeId: 'store-new', productId: 'prod-asado', available: true }).run()
    db.insert(productPrices).values({
      id: 'price-1', productId: 'prod-asado', storeId: 'store-new', price: 11111, validFrom: now, createdBy: 'user-1',
    }).run()

    const seeded = seedCatalogOntoStore({
      storeId: 'store-new',
      createdByUserId: 'user-1',
      now,
      listPricesByPlu: new Map([[1, 20000]]),
    })
    expect(seeded).toBe(0)
    expect(db.select().from(productPrices).all()).toHaveLength(1)
  })

  it('ensureCatalogSeedUser crea la fila una sola vez', () => {
    const id1 = ensureCatalogSeedUser('2026-09-07T03:00:00.000Z')
    const id2 = ensureCatalogSeedUser('2026-09-07T03:00:00.000Z')
    expect(id1).toBe(id2)
    expect(db.select().from(users).all()).toHaveLength(1)
  })

  it('ensureMasterCatalogProducts inserta lista + fallback y no pisa existentes', () => {
    const now = '2026-09-07T03:00:00.000Z'
    const filePath = path.join(tmpDir, 'catalog.json')
    fs.writeFileSync(filePath, JSON.stringify({
      products: [
        { plu: 1, name: 'Asado', category: 'beef_cut', unit: 'kg', price: 20000 },
        { plu: 2, name: 'Vacío', category: 'beef_cut', unit: 'kg', price: 23000 },
      ],
    }))

    const first = ensureMasterCatalogProducts({ now, filePath })
    expect(first.inserted).toBe(3)
    expect(db.select().from(products).all()).toHaveLength(3)
    expect(db.select().from(products).where(eq(products.id, productIdForPlu(1))).get()?.name).toBe('Asado')
    expect(db.select().from(products).where(eq(products.id, FALLBACK_PRODUCT_ID)).get()).toBeDefined()

    db.update(products).set({ name: 'Asado editado' }).where(eq(products.id, productIdForPlu(1))).run()
    const second = ensureMasterCatalogProducts({ now, filePath })
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBe(3)
    expect(db.select().from(products).where(eq(products.id, productIdForPlu(1))).get()?.name).toBe('Asado editado')
  })

  it('no asocia el producto fallback al local al sembrar precios', () => {
    const now = '2026-09-07T03:00:00.000Z'
    db.insert(stores).values({ id: 'store-new', name: 'Nuevo', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-1', storeId: null, name: 'Sistema', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(products).values({
      id: FALLBACK_PRODUCT_ID,
      name: 'Producto sin identificar',
      category: 'other',
      unit: 'kg',
      pluNumber: null,
      active: true,
      createdAt: now,
    }).run()

    const seeded = seedCatalogOntoStore({
      storeId: 'store-new',
      createdByUserId: 'user-1',
      now,
      listPricesByPlu: new Map(),
    })
    expect(seeded).toBe(0)
    expect(db.select().from(storeProducts).all()).toHaveLength(0)
  })
})
