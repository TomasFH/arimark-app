import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, ceboEntries } from '../../db/schema'

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

vi.mock('../../licensing/ceboSync', () => ({
  pushUnsyncedCebo: vi.fn().mockResolvedValue(undefined),
  pullCeboForStoreWeek: vi.fn().mockResolvedValue(0),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { pullCeboForStoreWeek } from '../../licensing/ceboSync'
import { registerCeboHandlers } from '../cebo.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls.filter(c => c[0] === channel)
  const call = calls[calls.length - 1]
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001', displayName: 'Ana' }
const ADMIN = { userId: 'admin-001', storeId: 'store-001', role: 'admin' as const, shiftId: 'shift-001', displayName: 'Admin' }

describe('cebo.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001', name: 'Ana', storeId: 'store-001', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(users).values({
      id: 'admin-001', name: 'Admin', storeId: 'store-001', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(users).values({
      id: 'user-002', name: 'Beto', storeId: 'store-001', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(shifts).values({
      id: 'shift-001', storeId: 'store-001', userId: 'user-001',
      shiftType: 'morning', startedAt: now, openingCash: 0, source: 'desktop',
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)
    registerCeboHandlers()
  })

  it('registra cebo del turno', () => {
    const result = getHandler('ipc:register-cebo')(null, { quantityKg: 12.5, notes: 'Balde' }) as {
      ok: boolean
      data: { id: string }
    }
    expect(result.ok).toBe(true)
    const row = db.select().from(ceboEntries).all()[0]
    expect(row?.quantityKg).toBe(12.5)
    expect(row?.notes).toBe('Balde')
    expect(row?.shiftId).toBe('shift-001')
    expect(row?.syncedAt).toBeNull()
  })

  it('rechaza kg <= 0', () => {
    const result = getHandler('ipc:register-cebo')(null, { quantityKg: 0 }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('lista el turno y marca canEdit del autor', async () => {
    getHandler('ipc:register-cebo')(null, { quantityKg: 1.2 })
    const list = await getHandler('ipc:list-shift-cebo')(null) as {
      ok: boolean
      data: Array<{ createdByName: string; canEdit: boolean; quantityKg: number }>
    }
    expect(list.ok).toBe(true)
    expect(list.data).toHaveLength(1)
    expect(list.data[0]?.createdByName).toBe('Ana')
    expect(list.data[0]?.canEdit).toBe(true)
    expect(list.data[0]?.quantityKg).toBe(1.2)
    expect(pullCeboForStoreWeek).not.toHaveBeenCalled()
  })

  it('si no hay cebo local pide Firestore de esa semana', async () => {
    await getHandler('ipc:list-shift-cebo')(null)
    expect(pullCeboForStoreWeek).toHaveBeenCalled()
  })

  it('cajera no edita el cebo de otra', () => {
    const now = new Date().toISOString()
    db.insert(ceboEntries).values({
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01',
      storeId: 'store-001',
      shiftId: 'shift-001',
      quantityKg: 3,
      notes: null,
      createdBy: 'user-002',
      createdAt: now,
    }).run()
    const result = getHandler('ipc:update-cebo')(null, { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01', quantityKg: 4 }) as {
      ok: boolean
      code: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('FORBIDDEN')
  })

  it('admin edita cualquier cebo del turno', () => {
    const now = new Date().toISOString()
    db.insert(ceboEntries).values({
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01',
      storeId: 'store-001',
      shiftId: 'shift-001',
      quantityKg: 3,
      notes: 'viejo',
      createdBy: 'user-002',
      createdAt: now,
    }).run()
    vi.mocked(getActiveSession).mockReturnValue(ADMIN as ReturnType<typeof getActiveSession>)
    const result = getHandler('ipc:update-cebo')(null, {
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01',
      quantityKg: 4.5,
      notes: 'corregido',
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const row = db.select().from(ceboEntries).all()[0]
    expect(row?.quantityKg).toBe(4.5)
    expect(row?.updatedBy).toBe('admin-001')
    expect(row?.notes).toBe('corregido')
  })

  it('cajera edita el cebo que cargó', () => {
    const created = getHandler('ipc:register-cebo')(null, { quantityKg: 2, notes: 'bolsa' }) as {
      ok: boolean
      data: { id: string }
    }
    expect(created.ok).toBe(true)
    const result = getHandler('ipc:update-cebo')(null, {
      id: created.data.id,
      quantityKg: 2.5,
      notes: 'bolsa corregida',
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const row = db.select().from(ceboEntries).all()[0]
    expect(row?.quantityKg).toBe(2.5)
    expect(row?.notes).toBe('bolsa corregida')
    expect(row?.updatedBy).toBe('user-001')
  })

  it('rechaza UUID malformado al editar', () => {
    const result = getHandler('ipc:update-cebo')(null, { id: 'no-es-uuid', quantityKg: 1 }) as {
      ok: boolean
      code: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza editar un cebo inexistente', () => {
    const result = getHandler('ipc:update-cebo')(null, {
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee99',
      quantityKg: 1,
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_FOUND')
  })

  it('rechaza si no hay sesión', () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const result = getHandler('ipc:register-cebo')(null, { quantityKg: 1 }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SESSION')
  })

  it('rechaza si no hay turno', () => {
    vi.mocked(getActiveSession).mockReturnValue({ ...SESSION, shiftId: null } as ReturnType<typeof getActiveSession>)
    const result = getHandler('ipc:register-cebo')(null, { quantityKg: 1 }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SHIFT')
  })
})
