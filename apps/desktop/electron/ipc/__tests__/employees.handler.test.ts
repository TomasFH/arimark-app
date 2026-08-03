import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, employees } from '../../db/schema'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-tenant' })),
}))

vi.mock('../../licensing/employeeSync', () => ({
  pushUnsyncedEmployees: vi.fn().mockResolvedValue(undefined),
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
import { registerEmployeesHandlers } from '../employees.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const ADMIN_SESSION = { userId: 'admin-001', storeId: 'store-001', role: 'admin' as const, shiftId: null }
const CASHIER_SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: null }

describe('employees.handler', () => {
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
    db.insert(users).values({
      id: 'admin-001',
      name: 'Admin',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)

    registerEmployeesHandlers()
  })

  describe('LIST_EMPLOYEES', () => {
    it('retorna lista vacía si no hay empleados', () => {
      const res = getHandler('ipc:list-employees')(null) as { ok: boolean; data: unknown[] }
      expect(res.ok).toBe(true)
      expect(res.data).toEqual([])
    })

    it('omite archivados por defecto e incluye con includeArchived', () => {
      db.insert(employees).values({
        id: 'e-active',
        name: 'Activo',
        weeklyWage: 1000,
        active: true,
        createdAt: new Date().toISOString(),
      }).run()
      db.insert(employees).values({
        id: 'e-arch',
        name: 'Archivado',
        weeklyWage: 500,
        active: false,
        createdAt: new Date().toISOString(),
      }).run()

      const active = getHandler('ipc:list-employees')(null) as { ok: boolean; data: { id: string }[] }
      expect(active.data.map(e => e.id)).toEqual(['e-active'])

      const all = getHandler('ipc:list-employees')(null, { includeArchived: true }) as {
        ok: boolean
        data: { id: string }[]
      }
      expect(all.data.map(e => e.id).sort()).toEqual(['e-active', 'e-arch'])
    })

    it('rechaza sin sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const res = getHandler('ipc:list-employees')(null) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SESSION')
    })
  })

  describe('CREATE_EMPLOYEE', () => {
    it('crea un empleado válido', () => {
      const res = getHandler('ipc:create-employee')(null, {
        name: '  Juan Pérez  ',
        weeklyWage: 150000,
      }) as { ok: boolean; data: { id: string; name: string; weeklyWage: number; active: boolean } }

      expect(res.ok).toBe(true)
      expect(res.data.name).toBe('Juan Pérez')
      expect(res.data.weeklyWage).toBe(150000)
      expect(res.data.active).toBe(true)
      expect(res.data.id).toBeTruthy()
    })

    it('rechaza payload inválido', () => {
      const res = getHandler('ipc:create-employee')(null, {
        name: '',
        weeklyWage: -1,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza nombre duplicado (case-insensitive)', () => {
      getHandler('ipc:create-employee')(null, { name: 'Ana', weeklyWage: 100 })
      const res = getHandler('ipc:create-employee')(null, { name: 'ana', weeklyWage: 200 }) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza a cajera', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:create-employee')(null, { name: 'X', weeklyWage: 1 }) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })
  })

  describe('UPDATE_EMPLOYEE', () => {
    it('actualiza nombre y sueldo', () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Pedro',
        weeklyWage: 100,
      }) as { ok: boolean; data: { id: string } }

      const res = getHandler('ipc:update-employee')(null, {
        id: created.data.id,
        name: 'Pedro Gómez',
        weeklyWage: 200,
      }) as { ok: boolean; data: { name: string; weeklyWage: number } }

      expect(res.ok).toBe(true)
      expect(res.data.name).toBe('Pedro Gómez')
      expect(res.data.weeklyWage).toBe(200)
    })

    it('retorna NOT_FOUND si no existe', () => {
      const res = getHandler('ipc:update-employee')(null, {
        id: 'no-existe',
        weeklyWage: 1,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })

    it('rechaza payload sin campos', () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'SoloId',
        weeklyWage: 10,
      }) as { ok: boolean; data: { id: string } }
      const res = getHandler('ipc:update-employee')(null, { id: created.data.id }) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('ARCHIVE_EMPLOYEE', () => {
    it('archiva un empleado activo', () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'A Archivar',
        weeklyWage: 50,
      }) as { ok: boolean; data: { id: string } }

      const res = getHandler('ipc:archive-employee')(null, { id: created.data.id }) as {
        ok: boolean
        data: { active: boolean }
      }
      expect(res.ok).toBe(true)
      expect(res.data.active).toBe(false)

      const list = getHandler('ipc:list-employees')(null) as { ok: boolean; data: { id: string }[] }
      expect(list.data.find(e => e.id === created.data.id)).toBeUndefined()
    })

    it('retorna CONFLICT si ya estaba archivado', () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Doble Archivo',
        weeklyWage: 50,
      }) as { ok: boolean; data: { id: string } }
      getHandler('ipc:archive-employee')(null, { id: created.data.id })
      const res = getHandler('ipc:archive-employee')(null, { id: created.data.id }) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })
  })

  describe('UNARCHIVE_EMPLOYEE', () => {
    it('restaura un empleado archivado', () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'A Restaurar',
        weeklyWage: 80,
      }) as { ok: boolean; data: { id: string } }
      getHandler('ipc:archive-employee')(null, { id: created.data.id })

      const res = getHandler('ipc:unarchive-employee')(null, { id: created.data.id }) as {
        ok: boolean
        data: { active: boolean; name: string }
      }
      expect(res.ok).toBe(true)
      expect(res.data.active).toBe(true)

      const list = getHandler('ipc:list-employees')(null) as { ok: boolean; data: { id: string }[] }
      expect(list.data.find(e => e.id === created.data.id)).toBeDefined()
    })

    it('CONFLICT si ya estaba activo', () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Ya Activo',
        weeklyWage: 10,
      }) as { ok: boolean; data: { id: string } }
      const res = getHandler('ipc:unarchive-employee')(null, { id: created.data.id }) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })
  })
})
