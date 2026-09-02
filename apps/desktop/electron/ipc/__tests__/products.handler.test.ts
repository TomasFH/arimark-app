import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerProductsHandlers, isListedForStore } from '../products.handler'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { products, productPrices, storeProducts, stores, users } from '../../db/schema'

type HandlerFn = (_event: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SAMPLE_PRODUCTS = [
  { id: 'prod-001', name: 'Asado de tira', category: 'beef_cut', unit: 'kg', pluNumber: 1 },
  { id: 'prod-002', name: 'Vacío', category: 'beef_cut', unit: 'kg', pluNumber: 3 },
  { id: 'prod-003', name: 'Pollo', category: 'poultry', unit: 'kg', pluNumber: 100 },
]

const SAMPLE_PRICES = [
  { productId: 'prod-001', price: 16322, validFrom: '2026-01-01T00:00:00.000Z' },
  { productId: 'prod-002', price: 19441, validFrom: '2026-01-01T00:00:00.000Z' },
]

function makeMockDb(productRows = SAMPLE_PRODUCTS, priceRows = SAMPLE_PRICES) {
  const productsAll = vi.fn().mockReturnValue(productRows)
  const pricesAll = vi.fn().mockReturnValue(priceRows)

  const productsChain = {
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ all: productsAll }),
        }),
      }),
    }),
  }

  const pricesChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ all: pricesAll }),
    }),
  }

  let selectCall = 0
  const db = {
    select: vi.fn().mockImplementation(() => {
      selectCall++
      return selectCall === 1 ? productsChain : pricesChain
    }),
  }

  return { db: db as unknown as ReturnType<typeof getDb>, productsAll, pricesAll }
}

describe('products.handler — GET_PRODUCTS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActiveSession).mockReturnValue({
      userId: 'user-001',
      storeId: 'store-001',
      role: 'cashier' as const,
      shiftId: 'shift-001',
    })
    registerProductsHandlers()
  })

  it('retorna lista de productos con precios vigentes', () => {
    const { db } = makeMockDb()
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:get-products')
    const result = handler({}) as { ok: boolean; data: Array<{ pluNumber: number; price: number | null }> }

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(3)
    expect(result.data[0].pluNumber).toBe(1)
    expect(result.data[0].price).toBe(16322)
    expect(result.data[1].price).toBe(19441)
    expect(result.data[2].price).toBeNull()
  })

  it('retorna lista vacía si no hay productos con PLU', () => {
    const { db } = makeMockDb([])
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:get-products')
    const result = handler({}) as { ok: boolean; data: [] }

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(0)
  })

  it('retorna DB_ERROR si getDb lanza una excepción', () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB no inicializada') })

    const handler = getHandler('ipc:get-products')
    const result = handler({}) as { ok: boolean; code: string }

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DB_ERROR')
  })
})

describe('isListedForStore', () => {
  it('sin fila (null/undefined) se lista', () => {
    expect(isListedForStore(null)).toBe(true)
    expect(isListedForStore(undefined)).toBe(true)
  })

  it('false o 0 se ocultan; true o 1 se listan', () => {
    expect(isListedForStore(false)).toBe(false)
    expect(isListedForStore(0)).toBe(false)
    expect(isListedForStore(true)).toBe(true)
    expect(isListedForStore(1)).toBe(true)
  })
})

describe('GET_PRODUCTS — disponibilidad por local (SQLite real)', () => {
  const STORE = '00000000-0000-0000-0000-000000000001'
  const PRODUCT = '11111111-1111-1111-1111-111111111111'

  beforeEach(async () => {
    vi.clearAllMocks()
    const { db } = await createInMemoryDb()
    const now = '2026-01-15T12:00:00.000Z'
    db.insert(stores).values({ id: STORE, name: 'Local A', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-1',
      name: 'Cajera',
      storeId: STORE,
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()
    db.insert(products).values({
      id: PRODUCT,
      name: 'PLU 789',
      category: 'other',
      unit: 'kg',
      pluNumber: 789,
      active: true,
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(productPrices).values({
      id: 'price-789',
      productId: PRODUCT,
      storeId: STORE,
      price: 1000,
      validFrom: now,
      validTo: null,
      createdBy: 'user-1',
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue({
      userId: 'user-1',
      storeId: STORE,
      role: 'cashier',
      shiftId: 'shift-1',
    })
    registerProductsHandlers()
  })

  function listPlus(): number[] {
    const handler = getHandler('ipc:get-products')
    const result = handler({}) as { ok: boolean; data: Array<{ pluNumber: number }> }
    expect(result.ok).toBe(true)
    return result.data.map(p => p.pluNumber)
  }

  it('oculta el PLU al marcar available=false y lo vuelve a listar con available=true', () => {
    const db = vi.mocked(getDb)()
    expect(listPlus()).toContain(789)

    db.insert(storeProducts).values({ storeId: STORE, productId: PRODUCT, available: false }).run()
    expect(listPlus()).not.toContain(789)

    db.update(storeProducts).set({ available: true })
      .where(eq(storeProducts.productId, PRODUCT))
      .run()
    expect(listPlus()).toContain(789)
  })
})
