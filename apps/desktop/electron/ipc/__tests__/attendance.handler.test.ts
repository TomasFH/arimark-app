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
  pushUnsyncedAttendance: vi.fn().mockResolvedValue(undefined),
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
import { registerAttendanceHandlers } from '../attendance.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const CASHIER_SESSION = {
  userId: 'user-001',
  storeId: 'store-001',
  role: 'cashier' as const,
  shiftId: 'shift-001',
}

describe('attendance.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']
  const employeeId = 'emp-001'

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db

    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: new Date().toISOString() }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()
    db.insert(employees).values({
      id: employeeId,
      name: 'Carnicero Uno',
      weeklyWage: 100000,
      active: true,
      createdAt: new Date().toISOString(),
    }).run()
    db.insert(employees).values({
      id: 'emp-archived',
      name: 'Archivado',
      weeklyWage: 0,
      active: false,
      createdAt: new Date().toISOString(),
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)

    registerAttendanceHandlers()
  })

  describe('RECORD_ATTENDANCE', () => {
    it('registra asistencia nueva', () => {
      const res = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-02',
        status: 'present',
      }) as { ok: boolean; data: { id: string; status: string; employeeName: string; storeId: string | null } }

      expect(res.ok).toBe(true)
      expect(res.data.status).toBe('present')
      expect(res.data.employeeName).toBe('Carnicero Uno')
      expect(res.data.storeId).toBe('store-001')
    })

    it('usa storeId del payload si viene (admin eligiendo local)', () => {
      const res = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-03',
        status: 'present',
        storeId: 'store-001',
      }) as { ok: boolean; data: { storeId: string | null } }
      expect(res.ok).toBe(true)
      expect(res.data.storeId).toBe('store-001')
    })

    it('hace upsert el mismo día (mismo id, nuevo status)', () => {
      const first = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-02',
        status: 'present',
      }) as { ok: boolean; data: { id: string } }

      const second = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-02',
        status: 'late',
        note: 'Llegó 10 min tarde',
      }) as { ok: boolean; data: { id: string; status: string; note: string | null } }

      expect(second.ok).toBe(true)
      expect(second.data.id).toBe(first.data.id)
      expect(second.data.status).toBe('late')
      expect(second.data.note).toBe('Llegó 10 min tarde')
    })

    it('no pisa storeId ya seteado al re-registrar el mismo día', () => {
      getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-04',
        status: 'present',
        storeId: 'store-001',
      })
      const second = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-04',
        status: 'late',
        storeId: 'store-otro',
      }) as { ok: boolean; data: { storeId: string | null } }
      expect(second.ok).toBe(true)
      expect(second.data.storeId).toBe('store-001')
    })

    it('rechaza payload inválido', () => {
      const res = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '02-08-2026',
        status: 'present',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza empleado archivado', () => {
      const res = getHandler('ipc:record-attendance')(null, {
        employeeId: 'emp-archived',
        date: '2026-08-02',
        status: 'absent',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza sin sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const res = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-02',
        status: 'present',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SESSION')
    })
  })

  describe('UPDATE_ATTENDANCE', () => {
    it('actualiza status y note', () => {
      const created = getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-02',
        status: 'present',
      }) as { ok: boolean; data: { id: string } }

      const res = getHandler('ipc:update-attendance')(null, {
        id: created.data.id,
        status: 'early_departure',
        note: 'Se fue a las 16',
      }) as { ok: boolean; data: { status: string; note: string | null } }

      expect(res.ok).toBe(true)
      expect(res.data.status).toBe('early_departure')
      expect(res.data.note).toBe('Se fue a las 16')
    })

    it('retorna NOT_FOUND', () => {
      const res = getHandler('ipc:update-attendance')(null, {
        id: 'no-existe',
        status: 'absent',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })
  })

  describe('LIST_ATTENDANCE', () => {
    it('lista filtrada por rango y empleado', () => {
      getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-01',
        status: 'present',
      })
      getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-02',
        status: 'absent',
        note: 'Médico',
      })
      getHandler('ipc:record-attendance')(null, {
        employeeId,
        date: '2026-08-05',
        status: 'present',
      })

      const res = getHandler('ipc:list-attendance')(null, {
        startDate: '2026-08-01',
        endDate: '2026-08-03',
        employeeId,
      }) as { ok: boolean; data: { date: string; status: string }[] }

      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(2)
      expect(res.data.map(r => r.date)).toEqual(['2026-08-01', '2026-08-02'])
    })

    it('rechaza rango invertido', () => {
      const res = getHandler('ipc:list-attendance')(null, {
        startDate: '2026-08-10',
        endDate: '2026-08-01',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })
})
