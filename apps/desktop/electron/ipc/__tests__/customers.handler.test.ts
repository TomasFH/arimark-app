import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, customers } from '../../db/schema'

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

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerCustomerHandlers } from '../customers.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', shiftId: 'shift-001' }

describe('customers.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    const now = new Date().toISOString()

    db.insert(stores).values({ id: 'store-001', name: 'Local Test', createdAt: now }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera Test', storeId: 'store-001', role: 'cashier', active: true, createdAt: now }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)

    registerCustomerHandlers()
  })

  // ---------------------------------------------------------------------------
  // CREATE_CUSTOMER
  // ---------------------------------------------------------------------------

  describe('CREATE_CUSTOMER (ipc:create-customer)', () => {
    it('crea un cliente con campos mínimos', () => {
      const handler = getHandler('ipc:create-customer')
      const result = handler(null, { name: 'Restaurante Pepito' }) as { ok: boolean; data: { name: string } }
      expect(result.ok).toBe(true)
      expect(result.data.name).toBe('Restaurante Pepito')
    })

    it('crea un cliente con todos los campos', () => {
      const handler = getHandler('ipc:create-customer')
      const result = handler(null, {
        name: 'Mayorista Gómez',
        dni: '12345678',
        phone: '11-2233-4455',
        type: 'wholesale',
        notes: 'Cliente frecuente',
      }) as { ok: boolean; data: { dni: string; type: string } }
      expect(result.ok).toBe(true)
      expect(result.data.dni).toBe('12345678')
      expect(result.data.type).toBe('wholesale')
    })

    it('rechaza nombre vacío', () => {
      const handler = getHandler('ipc:create-customer')
      const result = handler(null, { name: '' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('rechaza payload malformado', () => {
      const handler = getHandler('ipc:create-customer')
      const result = handler(null, null) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna NO_SESSION si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:create-customer')
      const result = handler(null, { name: 'Test' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })
  })

  // ---------------------------------------------------------------------------
  // GET_CUSTOMERS
  // ---------------------------------------------------------------------------

  describe('GET_CUSTOMERS (ipc:get-customers)', () => {
    beforeEach(() => {
      const now = new Date().toISOString()
      db.insert(customers).values([
        { id: '11111111-0000-0000-0000-000000000001', storeId: 'store-001', name: 'Álvarez Restaurant', dni: '11111111', active: true, createdAt: now, createdBy: 'user-001' },
        { id: '22222222-0000-0000-0000-000000000002', storeId: 'store-001', name: 'Bodega Perez', dni: '22222222', active: true, createdAt: now, createdBy: 'user-001' },
        { id: '33333333-0000-0000-0000-000000000003', storeId: 'store-001', name: 'Carnicería Inactiva', active: false, createdAt: now, createdBy: 'user-001' },
      ]).run()
    })

    it('retorna solo clientes activos por defecto', () => {
      const handler = getHandler('ipc:get-customers')
      const result = handler(null, {}) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
    })

    it('retorna todos los clientes cuando activeOnly=false', () => {
      const handler = getHandler('ipc:get-customers')
      const result = handler(null, { activeOnly: false }) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(3)
    })

    it('filtra por búsqueda de nombre', () => {
      const handler = getHandler('ipc:get-customers')
      const result = handler(null, { search: 'alvarez' }) as { ok: boolean; data: Array<{ name: string }> }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Álvarez Restaurant')
    })

    it('filtra por DNI', () => {
      const handler = getHandler('ipc:get-customers')
      const result = handler(null, { search: '22222' }) as { ok: boolean; data: Array<{ name: string }> }
      expect(result.ok).toBe(true)
      expect(result.data[0].name).toBe('Bodega Perez')
    })
  })

  // ---------------------------------------------------------------------------
  // UPDATE_CUSTOMER
  // ---------------------------------------------------------------------------

  describe('UPDATE_CUSTOMER (ipc:update-customer)', () => {
    beforeEach(() => {
      db.insert(customers).values({
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        storeId: 'store-001',
        name: 'Original Name',
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: 'user-001',
      }).run()
    })

    it('actualiza el nombre', () => {
      const handler = getHandler('ipc:update-customer')
      const result = handler(null, { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Nuevo Nombre' }) as { ok: boolean; data: { name: string } }
      expect(result.ok).toBe(true)
      expect(result.data.name).toBe('Nuevo Nombre')
    })

    it('desactiva un cliente', () => {
      const handler = getHandler('ipc:update-customer')
      const result = handler(null, { id: 'aaaaaaaa-0000-0000-0000-000000000001', active: false }) as { ok: boolean; data: { active: boolean } }
      expect(result.ok).toBe(true)
      expect(result.data.active).toBe(false)
    })

    it('retorna NOT_FOUND para ID inexistente', () => {
      const handler = getHandler('ipc:update-customer')
      const result = handler(null, { id: '00000000-0000-0000-0000-000000000099', name: 'X' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })

    it('rechaza ID inválido', () => {
      const handler = getHandler('ipc:update-customer')
      const result = handler(null, { id: 'not-a-uuid', name: 'X' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })
  })
})
