import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { registerProductsHandlers } from '../products.handler'

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
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({ all: productsAll }),
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
