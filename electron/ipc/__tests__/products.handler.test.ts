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

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { registerProductsHandlers } from '../products.handler'

type HandlerFn = (_event: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SAMPLE_PRODUCTS = [
  { id: 'prod-001', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1 },
  { id: 'prod-002', name: 'Vacío', category: 'beef_cut', unit: 'kg', pluNumber: 3 },
  { id: 'prod-003', name: 'Pollo entero', category: 'poultry', unit: 'kg', pluNumber: 100 },
]

function makeMockDb(rows = SAMPLE_PRODUCTS) {
  const mockAll = vi.fn().mockReturnValue(rows)
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ all: mockAll }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>,
    mockAll,
  }
}

describe('products.handler — GET_PRODUCTS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerProductsHandlers()
  })

  it('retorna lista de productos ordenada por plu_number', () => {
    const { db } = makeMockDb()
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:get-products')
    const result = handler({}) as { ok: boolean; data: typeof SAMPLE_PRODUCTS }

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(3)
    expect(result.data[0].pluNumber).toBe(1)
    expect(result.data[0].name).toBe('Asado')
    expect(result.data[2].pluNumber).toBe(100)
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
