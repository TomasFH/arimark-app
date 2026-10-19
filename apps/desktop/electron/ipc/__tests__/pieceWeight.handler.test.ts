import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { products, productPieceWeights } from '../../db/schema'
import { registerPieceWeightHandlers } from '../pieceWeight.handler'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
}))

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls.filter(c => c[0] === channel)
  const call = calls[calls.length - 1]
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

describe('pieceWeight.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    db.insert(products).values({
      id: 'morcilla',
      name: 'Morcilla',
      category: 'pork',
      unit: 'kg',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue({
      userId: 'user-001', storeId: 'store-001', role: 'cashier', shiftId: 'shift-001', displayName: 'Ana',
    } as ReturnType<typeof getActiveSession>)
    registerPieceWeightHandlers()
  })

  it('guarda la primera referencia y la lee', async () => {
    const saved = await getHandler('ipc:set-piece-weights')(null, {
      items: [{ productId: 'morcilla', kgPerUnit: 0.2 }],
    }) as { ok: boolean; data?: { saved: number } }
    expect(saved.ok).toBe(true)
    expect(saved.data?.saved).toBe(1)
    const row = db.select().from(productPieceWeights).all()[0]
    expect(row?.kgPerUnit).toBe(0.2)
    const listed = await getHandler('ipc:get-piece-weights')(null, null) as {
      ok: boolean
      data: Array<{ productId: string; kgPerUnit: number }>
    }
    expect(listed.data).toEqual([{ productId: 'morcilla', kgPerUnit: 0.2 }])
  })

  it('rechaza un payload malformado', async () => {
    const result = await getHandler('ipc:set-piece-weights')(null, { items: [{ productId: 'morcilla', kgPerUnit: -1 }] }) as {
      ok: boolean
      code?: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza un producto que no existe', async () => {
    const result = await getHandler('ipc:set-piece-weights')(null, {
      items: [{ productId: 'no-esta', kgPerUnit: 0.2 }],
    }) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_FOUND')
  })

  it('sin sesión no guarda', async () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const result = await getHandler('ipc:set-piece-weights')(null, {
      items: [{ productId: 'morcilla', kgPerUnit: 0.2 }],
    }) as { code?: string }
    expect(result.code).toBe('NO_SESSION')
  })
})
