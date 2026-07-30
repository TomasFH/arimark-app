import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts } from '../../db/schema'

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
  updateActiveStore: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-key', default_store_id: STORE_ID })),
}))

vi.mock('../../licensing/catalogPublish', () => ({
  publishCatalog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/mobileSync', () => ({
  startMobileSyncListener: vi.fn(),
  stopMobileSyncListener: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerStoresHandlers } from '../stores.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const STORE_ID  = '00000000-0000-0000-0000-000000000010'
const STORE2_ID = '00000000-0000-0000-0000-000000000011'
const USER_ID   = '00000000-0000-0000-0000-000000000020'
const SHIFT_ID  = '00000000-0000-0000-0000-000000000030'
const ADMIN_SESSION   = { userId: USER_ID, storeId: STORE_ID, role: 'admin',   shiftId: null }
const CASHIER_SESSION = { userId: USER_ID, storeId: STORE_ID, role: 'cashier', shiftId: SHIFT_ID }

describe('stores.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const result = await createInMemoryDb()
    db = result.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
    registerStoresHandlers()

    const now = new Date().toISOString()
    db.insert(stores).values({ id: STORE_ID, name: 'Local 1', address: 'Calle 1', createdAt: now }).run()
    db.insert(users).values({ id: USER_ID, storeId: STORE_ID, name: 'Admin', active: true, createdAt: now }).run()
    db.insert(shifts).values({ id: SHIFT_ID, storeId: STORE_ID, userId: USER_ID, shiftType: 'morning', startedAt: now, openingCash: 0, source: 'desktop' }).run()
  })

  // --------------------------------------------------------------------------
  // SELECT_STORE
  // --------------------------------------------------------------------------
  describe('SELECT_STORE', () => {
    it('selecciona un local existente y actualiza la sesión (admin)', async () => {
      const handler = getHandler('ipc:select-store')
      const res = await handler(null, { storeId: STORE_ID }) as { ok: boolean; data: { storeId: string; role: string } }
      expect(res.ok).toBe(true)
      expect(res.data.storeId).toBe(STORE_ID)
      expect(res.data.role).toBe('admin')
    })

    it('selecciona un local y hace upsert del usuario cajera', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', address: 'Calle 2', createdAt: now }).run()
      const handler = getHandler('ipc:select-store')
      const res = await handler(null, { storeId: STORE2_ID }) as { ok: boolean; data: { storeId: string; role: string } }
      expect(res.ok).toBe(true)
      expect(res.data.storeId).toBe(STORE2_ID)
      expect(res.data.role).toBe('cashier')
    })

    it('rechaza storeId inexistente', async () => {
      const handler = getHandler('ipc:select-store')
      const res = await handler(null, { storeId: '00000000-0000-0000-0000-000000000099' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })

    it('rechaza un local archivado', async () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', createdAt: now, archivedAt: now }).run()
      const handler = getHandler('ipc:select-store')
      const res = await handler(null, { storeId: STORE2_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('STORE_ARCHIVED')
    })

    it('rechaza payload inválido (storeId vacío)', async () => {
      const handler = getHandler('ipc:select-store')
      const res = await handler(null, { storeId: '' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza si no hay sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:select-store')
      const res = await handler(null, { storeId: STORE_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SESSION')
    })
  })

  // --------------------------------------------------------------------------
  // CREATE_STORE
  // --------------------------------------------------------------------------
  describe('CREATE_STORE', () => {
    it('crea un nuevo local como admin', () => {
      const handler = getHandler('ipc:create-store')
      const res = handler(null, { name: 'Nuevo Local', address: 'Av. Test 123' }) as { ok: boolean; data: { id: string; name: string } }
      expect(res.ok).toBe(true)
      expect(res.data.name).toBe('Nuevo Local')
      expect(res.data.id).toBeDefined()
    })

    it('rechaza nombre duplicado entre activos', () => {
      const handler = getHandler('ipc:create-store')
      const res = handler(null, { name: 'Local 1' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza si no es admin', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-store')
      const res = handler(null, { name: 'Local Cajera' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })

    it('rechaza payload inválido', () => {
      const handler = getHandler('ipc:create-store')
      const res = handler(null, { name: '' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })

  // --------------------------------------------------------------------------
  // UPDATE_STORE
  // --------------------------------------------------------------------------
  describe('UPDATE_STORE', () => {
    it('actualiza nombre y dirección de un local', () => {
      const handler = getHandler('ipc:update-store')
      const res = handler(null, { id: STORE_ID, name: 'Local Renombrado', address: 'Nueva dirección 456' }) as { ok: boolean; data: { name: string; address: string } }
      expect(res.ok).toBe(true)
      expect(res.data.name).toBe('Local Renombrado')
      expect(res.data.address).toBe('Nueva dirección 456')
    })

    it('limpia la dirección si se pasa string vacío', () => {
      const handler = getHandler('ipc:update-store')
      const res = handler(null, { id: STORE_ID, address: '' }) as { ok: boolean; data: { address: string | null } }
      expect(res.ok).toBe(true)
      expect(res.data.address).toBeNull()
    })

    it('rechaza nombre duplicado de otro local activo', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', createdAt: now }).run()
      const handler = getHandler('ipc:update-store')
      const res = handler(null, { id: STORE_ID, name: 'Local 2' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza si no es admin', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:update-store')
      const res = handler(null, { id: STORE_ID, name: 'Intento cajera' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })

    it('rechaza local inexistente', () => {
      const handler = getHandler('ipc:update-store')
      const res = handler(null, { id: '00000000-0000-0000-0000-000000000099', name: 'X' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })
  })

  // --------------------------------------------------------------------------
  // DELETE_STORE
  // --------------------------------------------------------------------------
  describe('DELETE_STORE', () => {
    it('elimina un local vacío cuando hay más de uno activo', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', createdAt: now }).run()
      const handler = getHandler('ipc:delete-store')
      const res = handler(null, { id: STORE2_ID }) as { ok: boolean }
      expect(res.ok).toBe(true)
    })

    it('devuelve STORE_HAS_DATA si el local tiene turnos', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', createdAt: now }).run()
      const handler = getHandler('ipc:delete-store')
      // STORE_ID tiene el SHIFT_ID de beforeEach
      const res = handler(null, { id: STORE_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('STORE_HAS_DATA')
    })

    it('rechaza eliminar el único local activo', () => {
      const handler = getHandler('ipc:delete-store')
      const res = handler(null, { id: STORE_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza si no es admin', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:delete-store')
      const res = handler(null, { id: STORE_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })
  })

  // --------------------------------------------------------------------------
  // ARCHIVE_STORE / UNARCHIVE_STORE
  // --------------------------------------------------------------------------
  describe('ARCHIVE_STORE', () => {
    it('archiva un local activo cuando hay más de uno', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', createdAt: now }).run()
      const handler = getHandler('ipc:archive-store')
      const res = handler(null, { id: STORE2_ID }) as { ok: boolean; data: { archivedAt: string } }
      expect(res.ok).toBe(true)
      expect(res.data.archivedAt).toBeTruthy()
    })

    it('rechaza archivar el único local activo', () => {
      const handler = getHandler('ipc:archive-store')
      const res = handler(null, { id: STORE_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza archivar un local ya archivado', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', createdAt: now, archivedAt: now }).run()
      const handler = getHandler('ipc:archive-store')
      const res = handler(null, { id: STORE2_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza si no es admin', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:archive-store')
      const res = handler(null, { id: STORE_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })
  })

  describe('UNARCHIVE_STORE', () => {
    it('desarchiva un local archivado', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE2_ID, name: 'Local 2', createdAt: now, archivedAt: now }).run()
      const handler = getHandler('ipc:unarchive-store')
      const res = handler(null, { id: STORE2_ID }) as { ok: boolean; data: { archivedAt: null } }
      expect(res.ok).toBe(true)
      expect(res.data.archivedAt).toBeNull()
    })

    it('rechaza desarchivar un local ya activo', () => {
      const handler = getHandler('ipc:unarchive-store')
      const res = handler(null, { id: STORE_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })
  })
})
