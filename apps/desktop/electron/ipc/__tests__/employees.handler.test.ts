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

vi.mock('../../licensing/firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
  getFirebaseApp: vi.fn(() => ({})),
}))

vi.mock('../../licensing/tenantAuth', () => ({
  createTenantAuthUser: vi.fn().mockResolvedValue({ ok: true, data: { uid: 'firebase-uid-butcher' } }),
  findTenantUserByEmployeeId: vi.fn().mockResolvedValue(null),
  findTenantUserByEmail: vi.fn().mockResolvedValue(null),
  reactivateTenantUser: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  updateDoc: vi.fn().mockResolvedValue(undefined),
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
import { isFirebaseAvailable } from '../../licensing/firebase'
import {
  findTenantUserByEmployeeId,
  findTenantUserByEmail,
  reactivateTenantUser,
} from '../../licensing/tenantAuth'
import { registerEmployeesHandlers } from '../employees.handler'
import { eq } from 'drizzle-orm'
import { updateDoc } from 'firebase/firestore'

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
    vi.mocked(findTenantUserByEmployeeId).mockResolvedValue(null)
    vi.mocked(findTenantUserByEmail).mockResolvedValue(null)
    vi.mocked(reactivateTenantUser).mockResolvedValue({ ok: true, data: undefined })

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

    it('si la cajera en sesión tiene ficha dada de baja, la restaura', () => {
      vi.mocked(getActiveSession).mockReturnValue({
        ...CASHIER_SESSION,
        displayName: 'Cajera Test',
      } as ReturnType<typeof getActiveSession>)
      db.insert(employees).values({
        id: 'e-own',
        name: 'Cajera Test',
        weeklyWage: 1600000,
        kind: 'cashier',
        active: false,
        createdAt: new Date().toISOString(),
      }).run()

      const res = getHandler('ipc:list-employees')(null) as {
        ok: boolean
        data: Array<{ id: string; active: boolean }>
      }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(1)
      expect(res.data[0]).toMatchObject({ id: 'e-own', active: true })
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
      }) as { ok: boolean; data: { id: string; name: string; weeklyWage: number; active: boolean; kind: string } }

      expect(res.ok).toBe(true)
      expect(res.data.name).toBe('Juan Pérez')
      expect(res.data.weeklyWage).toBe(150000)
      expect(res.data.active).toBe(true)
      expect(res.data.kind).toBe('butcher')
      expect(res.data.id).toBeTruthy()
    })

    it('crea ficha de cajera para sueldo y vales', () => {
      const res = getHandler('ipc:create-employee')(null, {
        name: 'Cajera María',
        weeklyWage: 120000,
        kind: 'cashier',
      }) as { ok: boolean; data: { kind: string; name: string } }
      expect(res.ok).toBe(true)
      expect(res.data.kind).toBe('cashier')
      expect(res.data.name).toBe('Cajera María')
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

    it('guarda local habitual y rechaza un local inexistente', () => {
      const ok = getHandler('ipc:create-employee')(null, {
        name: 'Habitual',
        weeklyWage: 10,
        homeStoreId: 'store-001',
      }) as { ok: boolean; data: { homeStoreId: string | null } }
      expect(ok.ok).toBe(true)
      expect(ok.data.homeStoreId).toBe('store-001')

      const bad = getHandler('ipc:create-employee')(null, {
        name: 'Mal local',
        weeklyWage: 10,
        homeStoreId: 'no-existe',
      }) as { ok: boolean; code?: string }
      expect(bad.ok).toBe(false)
      expect(bad.code).toBe('INVALID_PAYLOAD')
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

    it('permite poner y sacar local habitual', () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Con local',
        weeklyWage: 1,
      }) as { ok: boolean; data: { id: string } }

      const setHome = getHandler('ipc:update-employee')(null, {
        id: created.data.id,
        homeStoreId: 'store-001',
      }) as { ok: boolean; data: { homeStoreId: string | null } }
      expect(setHome.ok).toBe(true)
      expect(setHome.data.homeStoreId).toBe('store-001')

      const clearHome = getHandler('ipc:update-employee')(null, {
        id: created.data.id,
        homeStoreId: null,
      }) as { ok: boolean; data: { homeStoreId: string | null } }
      expect(clearHome.ok).toBe(true)
      expect(clearHome.data.homeStoreId).toBeNull()
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

  describe('GRANT_BUTCHER_ACCESS', () => {
    it('rechaza si Firebase no disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Carnicero Sin Firebase',
        weeklyWage: 100,
        kind: 'butcher',
      }) as { ok: boolean; data: { id: string } }
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: created.data.id,
        email: 'carn@test.com',
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('UNAVAILABLE')
    })

    it('rechaza email inválido', async () => {
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: 'some-id',
        email: 'no-es-email',
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza si el empleado no existe', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: 'no-existe',
        email: 'test@test.com',
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })

    it('rechaza si kind no es butcher', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Cajera Ficha',
        weeklyWage: 100,
        kind: 'cashier',
      }) as { ok: boolean; data: { id: string } }
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: created.data.id,
        email: 'cajera@test.com',
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza si ya tiene firebaseUid', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      // Insertamos un carnicero con firebaseUid ya asignado
      db.insert(employees).values({
        id: 'emp-ya-tiene',
        name: 'Ya Tiene Acceso',
        weeklyWage: 1,
        kind: 'butcher',
        active: true,
        firebaseUid: 'uid-existente',
        createdAt: new Date().toISOString(),
      }).run()
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: 'emp-ya-tiene',
        email: 'nuevo@test.com',
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('ALREADY_EXISTS')
    })

    it('rechaza si cajera en sesión no es admin', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: 'any',
        email: 'carn@test.com',
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })

    it('sin email pide EMAIL_REQUIRED si no hay cuenta previa', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Sin Cuenta Previa',
        weeklyWage: 1,
        kind: 'butcher',
      }) as { ok: boolean; data: { id: string } }
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: created.data.id,
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('EMAIL_REQUIRED')
      expect(reactivateTenantUser).not.toHaveBeenCalled()
    })

    it('restablece la cuenta existente por employeeId sin pedir email', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(findTenantUserByEmployeeId).mockResolvedValue({
        uid: 'uid-revocado',
        email: 'carn@test.com',
        role: 'butcher',
        employeeId: 'emp-restablecer',
        active: false,
      })
      db.insert(employees).values({
        id: 'emp-restablecer',
        name: 'Carnicero Revocado',
        weeklyWage: 1,
        kind: 'butcher',
        active: true,
        firebaseUid: null,
        createdAt: new Date().toISOString(),
      }).run()
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: 'emp-restablecer',
      }) as Promise<{ ok: boolean; data?: { uid: string } }>)
      expect(res.ok).toBe(true)
      expect(res.data?.uid).toBe('uid-revocado')
      expect(reactivateTenantUser).toHaveBeenCalledWith(expect.objectContaining({
        uid: 'uid-revocado',
        employeeId: 'emp-restablecer',
      }))
      const row = db.select().from(employees).where(eq(employees.id, 'emp-restablecer')).get()
      expect(row?.firebaseUid).toBe('uid-revocado')
    })

    it('restablece por email si el perfil no trae employeeId', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(findTenantUserByEmail).mockResolvedValue({
        uid: 'uid-mail',
        email: 'viejo@test.com',
        role: 'butcher',
        employeeId: null,
        active: false,
      })
      db.insert(employees).values({
        id: 'emp-por-mail',
        name: 'Por Mail',
        weeklyWage: 1,
        kind: 'butcher',
        active: true,
        firebaseUid: null,
        createdAt: new Date().toISOString(),
      }).run()
      const res = await (getHandler('ipc:grant-butcher-access')(null, {
        employeeId: 'emp-por-mail',
        email: 'viejo@test.com',
      }) as Promise<{ ok: boolean; data?: { uid: string } }>)
      expect(res.ok).toBe(true)
      expect(res.data?.uid).toBe('uid-mail')
      expect(reactivateTenantUser).toHaveBeenCalled()
    })
  })

  describe('REVOKE_BUTCHER_ACCESS', () => {
    it('limpia firebaseUid cuando Firebase no disponible (tolerante a offline)', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      db.insert(employees).values({
        id: 'emp-con-uid',
        name: 'Con Acceso',
        weeklyWage: 1,
        kind: 'butcher',
        active: true,
        firebaseUid: 'uid-existente',
        createdAt: new Date().toISOString(),
      }).run()
      const res = await (getHandler('ipc:revoke-butcher-access')(null, {
        employeeId: 'emp-con-uid',
      }) as Promise<{ ok: boolean }>)
      expect(res.ok).toBe(true)
      const row = db.select().from(employees).where(eq(employees.id, 'emp-con-uid')).get()
      expect(row?.firebaseUid).toBeNull()
    })

    it('rechaza si no tiene firebaseUid', async () => {
      const created = getHandler('ipc:create-employee')(null, {
        name: 'Sin Acceso',
        weeklyWage: 1,
      }) as { ok: boolean; data: { id: string } }
      const res = await (getHandler('ipc:revoke-butcher-access')(null, {
        employeeId: created.data.id,
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })

    it('con Firebase disponible marca active:false y limpia firebaseUid', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(updateDoc).mockResolvedValue(undefined as never)
      db.insert(employees).values({
        id: 'emp-revoke-ok',
        name: 'Revocar Ok',
        weeklyWage: 1,
        kind: 'butcher',
        active: true,
        firebaseUid: 'uid-revocar',
        createdAt: new Date().toISOString(),
      }).run()
      const res = await (getHandler('ipc:revoke-butcher-access')(null, {
        employeeId: 'emp-revoke-ok',
      }) as Promise<{ ok: boolean }>)
      expect(res.ok).toBe(true)
      expect(updateDoc).toHaveBeenCalled()
      const row = db.select().from(employees).where(eq(employees.id, 'emp-revoke-ok')).get()
      expect(row?.firebaseUid).toBeNull()
    })

    it('si Firestore falla no limpia firebaseUid', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(updateDoc).mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
      db.insert(employees).values({
        id: 'emp-revoke-fail',
        name: 'Revocar Fail',
        weeklyWage: 1,
        kind: 'butcher',
        active: true,
        firebaseUid: 'uid-sigue',
        createdAt: new Date().toISOString(),
      }).run()
      const res = await (getHandler('ipc:revoke-butcher-access')(null, {
        employeeId: 'emp-revoke-fail',
      }) as Promise<{ ok: boolean; code?: string }>)
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FIRESTORE_ERROR')
      const row = db.select().from(employees).where(eq(employees.id, 'emp-revoke-fail')).get()
      expect(row?.firebaseUid).toBe('uid-sigue')
    })
  })
})
