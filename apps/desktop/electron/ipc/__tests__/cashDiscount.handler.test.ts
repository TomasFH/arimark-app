import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, cashDiscountAudits } from '../../db/schema'

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

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-license' })),
}))

vi.mock('../../licensing/storeSync', () => ({
  pushUnsyncedStores: vi.fn().mockResolvedValue(undefined),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerCashDiscountHandlers } from '../cashDiscount.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001', displayName: 'Ana' }

describe('cashDiscount.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: new Date().toISOString() }).run()
    db.insert(users).values({
      id: 'user-001', name: 'Ana', storeId: 'store-001', role: 'cashier', active: true, createdAt: new Date().toISOString(),
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)
    registerCashDiscountHandlers()
  })

  it('GET retorna 0% por defecto', () => {
    const result = getHandler('ipc:get-cash-discount-rule')(null) as {
      ok: boolean
      data: { minAmount: number; percent: number; schedule: unknown[]; audits: unknown[] }
    }
    expect(result.ok).toBe(true)
    expect(result.data.minAmount).toBe(0)
    expect(result.data.percent).toBe(0)
    expect(result.data.schedule).toEqual([])
    expect(result.data.audits).toEqual([])
  })

  it('SET guarda min y % y deja auditoría', () => {
    const set = getHandler('ipc:set-cash-discount-rule')
    const result = set(null, { minAmount: 50000, percent: 10 }) as {
      ok: boolean
      data: { minAmount: number; percent: number; schedule: unknown[]; audits: Array<{ actorName: string; nextPercent: number }> }
    }
    expect(result.ok).toBe(true)
    expect(result.data.minAmount).toBe(50000)
    expect(result.data.percent).toBe(10)
    expect(result.data.audits).toHaveLength(1)
    expect(result.data.audits[0]?.actorName).toBe('Ana')
    expect(result.data.audits[0]?.nextPercent).toBe(10)

    const store = db.select().from(stores).all()[0]
    expect(store?.cashDiscountMinAmount).toBe(50000)
    expect(store?.cashDiscountPercent).toBe(10)
    expect(store?.syncedAt).toBeNull()
    expect(db.select().from(cashDiscountAudits).all()).toHaveLength(1)
  })

  it('SET con los mismos valores no duplica auditoría', () => {
    const set = getHandler('ipc:set-cash-discount-rule')
    set(null, { minAmount: 1000, percent: 5 })
    set(null, { minAmount: 1000, percent: 5 })
    expect(db.select().from(cashDiscountAudits).all()).toHaveLength(1)
  })

  it('rechaza payload inválido', () => {
    const result = getHandler('ipc:set-cash-discount-rule')(null, { minAmount: -1, percent: 10 }) as {
      ok: boolean
      code: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza percent > 100', () => {
    const result = getHandler('ipc:set-cash-discount-rule')(null, { minAmount: 0, percent: 101 }) as {
      ok: boolean
      code: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza GET si no hay sesión', () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const result = getHandler('ipc:get-cash-discount-rule')(null) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SESSION')
  })

  it('rechaza SET si no hay sesión', () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const result = getHandler('ipc:set-cash-discount-rule')(null, { minAmount: 1000, percent: 5 }) as {
      ok: boolean
      code: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SESSION')
  })

  it('rechaza SET si el local de sesión no existe', () => {
    vi.mocked(getActiveSession).mockReturnValue({
      ...SESSION,
      storeId: 'store-missing',
    } as ReturnType<typeof getActiveSession>)
    const result = getHandler('ipc:set-cash-discount-rule')(null, { minAmount: 1000, percent: 5 }) as {
      ok: boolean
      code: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_FOUND')
  })

  it('SET guarda horario especial por días y turnos', () => {
    const set = getHandler('ipc:set-cash-discount-rule')
    const schedule = [{
      days: [0, 6],
      morning: { minAmount: 0, percent: 15 },
      afternoon: { minAmount: 0, percent: 20 },
    }]
    const result = set(null, { minAmount: 50000, percent: 10, schedule }) as {
      ok: boolean
      data: { schedule: Array<{ days: number[]; afternoon: { percent: number } }> }
    }
    expect(result.ok).toBe(true)
    expect(result.data.schedule).toHaveLength(1)
    expect(result.data.schedule[0]?.days).toEqual([0, 6])
    expect(result.data.schedule[0]?.afternoon.percent).toBe(20)
    const store = db.select().from(stores).all()[0]
    expect(store?.cashDiscountSchedule).toContain('"percent":20')
  })
})
