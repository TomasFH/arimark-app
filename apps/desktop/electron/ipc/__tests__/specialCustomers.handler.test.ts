import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, products, specialCustomers, specialCustomerPrices } from '../../db/schema'

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
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-key' })),
}))

vi.mock('../../licensing/specialCustomerSync', () => ({
  pushUnsyncedSpecialCustomerOps: vi.fn().mockResolvedValue(undefined),
  markSpecialCustomerDeletedInFirestore: vi.fn().mockResolvedValue(undefined),
  markSpecialCustomerPriceDeletedInFirestore: vi.fn().mockResolvedValue(undefined),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerSpecialCustomersHandlers } from '../specialCustomers.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const ADMIN_SESSION = { userId: 'user-001', storeId: 'store-001', role: 'admin' }
const CASHIER_SESSION = { userId: 'user-002', storeId: 'store-001', role: 'cashier' }

const SC_ID  = 'aaaaaaaa-0000-0000-0000-000000000001'
const SC_ID2 = 'bbbbbbbb-0000-0000-0000-000000000002'
const PROD_ID = 'cccccccc-0000-0000-0000-000000000003'

describe('specialCustomers.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const result = await createInMemoryDb()
    db = result.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
    registerSpecialCustomersHandlers()

    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', address: 'Calle 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-001', storeId: 'store-001', name: 'Admin', active: true, createdAt: now }).run()
    db.insert(users).values({ id: 'user-002', storeId: 'store-001', name: 'Cajera', active: true, createdAt: now }).run()
    db.insert(products).values({
      id: PROD_ID, name: 'Asado', category: 'beef_cut', unit: 'kg', active: true, createdAt: now,
    }).run()
  })

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------

  describe('CREATE_SPECIAL_CUSTOMER', () => {
    it('crea un cliente especial como admin', () => {
      const handler = getHandler('ipc:create-special-customer')
      const res = handler(null, { name: 'Carlos Especial' }) as { ok: boolean; data: { id: string; name: string; storeId: string | null } }
      expect(res.ok).toBe(true)
      expect(res.data.name).toBe('Carlos Especial')
      expect(res.data.id).toBeTruthy()
      // Sin storeId → null (todos los locales)
      expect(res.data.storeId).toBeNull()
    })

    it('crea un cliente especial asignado a un local específico', () => {
      const handler = getHandler('ipc:create-special-customer')
      const res = handler(null, { name: 'Local Uno', storeId: 'store-001' }) as { ok: boolean; data: { storeId: string | null } }
      expect(res.ok).toBe(true)
      // storeId del payload se ignora: el cliente es siempre global
      expect(res.data.storeId).toBeNull()
    })

    it('rechaza payload inválido', () => {
      const handler = getHandler('ipc:create-special-customer')
      const res = handler(null, { name: '' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('rechaza si el rol es cajera', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-special-customer')
      const res = handler(null, { name: 'X' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })
  })

  // --------------------------------------------------------------------------
  // LIST
  // --------------------------------------------------------------------------

  describe('LIST_SPECIAL_CUSTOMERS', () => {
    it('devuelve lista vacía si no hay clientes', () => {
      const handler = getHandler('ipc:list-special-customers')
      const res = handler(null) as { ok: boolean; data: unknown[] }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(0)
    })

    it('devuelve todos los clientes especiales, sin filtrar por local', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'store-999', name: 'Otro', address: 'x', createdAt: now }).run()
      db.insert(specialCustomers).values({
        id: SC_ID, storeId: 'store-001', name: 'Carlos', createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(specialCustomers).values({
        id: SC_ID2, storeId: 'store-999', name: 'Otro local', createdAt: now, createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:list-special-customers')
      const res = handler(null) as { ok: boolean; data: Array<{ name: string }> }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(2)
      expect(res.data.map(c => c.name).sort()).toEqual(['Carlos', 'Otro local'])
    })

    it('clientes sin local asignado (storeId null) aparecen en todos los locales', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'store-999', name: 'Otro', address: 'x', createdAt: now }).run()
      // Cliente universal (storeId null)
      db.insert(specialCustomers).values({
        id: SC_ID, storeId: null, name: 'Universal', createdAt: now, createdBy: 'user-001',
      }).run()
      // Cliente de otro local
      db.insert(specialCustomers).values({
        id: SC_ID2, storeId: 'store-999', name: 'Solo otro local', createdAt: now, createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:list-special-customers')
      const res = handler(null) as { ok: boolean; data: Array<{ name: string; storeId: string | null }> }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(2)
      expect(res.data.map(c => c.name).sort()).toEqual(['Solo otro local', 'Universal'])
    })

    it('cajeras también pueden listar (solo lectura)', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:list-special-customers')
      const res = handler(null) as { ok: boolean }
      expect(res.ok).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // UPDATE
  // --------------------------------------------------------------------------

  describe('UPDATE_SPECIAL_CUSTOMER', () => {
    it('actualiza nombre y notas', () => {
      const now = new Date().toISOString()
      db.insert(specialCustomers).values({ id: SC_ID, storeId: 'store-001', name: 'Antiguo', createdAt: now, createdBy: 'user-001' }).run()

      const handler = getHandler('ipc:update-special-customer')
      const res = handler(null, { id: SC_ID, name: 'Nuevo', notes: 'Compra mayoreo' }) as { ok: boolean }
      expect(res.ok).toBe(true)
    })

    it('puede cambiar el local asignado a null (todos)', () => {
      const now = new Date().toISOString()
      db.insert(specialCustomers).values({ id: SC_ID, storeId: 'store-001', name: 'Cliente', createdAt: now, createdBy: 'user-001' }).run()

      const handler = getHandler('ipc:update-special-customer')
      const res = handler(null, { id: SC_ID, storeId: null }) as { ok: boolean }
      expect(res.ok).toBe(true)
    })

    it('rechaza si cajera intenta editar', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:update-special-customer')
      const res = handler(null, { id: SC_ID, name: 'X' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })
  })

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  describe('DELETE_SPECIAL_CUSTOMER', () => {
    it('elimina cliente y sus precios en transacción', () => {
      const now = new Date().toISOString()
      db.insert(specialCustomers).values({ id: SC_ID, storeId: 'store-001', name: 'A borrar', createdAt: now, createdBy: 'user-001' }).run()
      db.insert(specialCustomerPrices).values({ id: 'price-001', specialCustomerId: SC_ID, productId: PROD_ID, price: 10000, updatedAt: now, updatedBy: 'user-001' }).run()

      const handler = getHandler('ipc:delete-special-customer')
      const res = handler(null, { id: SC_ID }) as { ok: boolean }
      expect(res.ok).toBe(true)

      const remaining = db.select().from(specialCustomerPrices).all()
      expect(remaining).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // PRECIOS
  // --------------------------------------------------------------------------

  describe('GET/SET/DELETE_SPECIAL_CUSTOMER_PRICE', () => {
    beforeEach(() => {
      const now = new Date().toISOString()
      db.insert(specialCustomers).values({ id: SC_ID, storeId: 'store-001', name: 'Carlos', createdAt: now, createdBy: 'user-001' }).run()
    })

    it('set: crea y luego actualiza el precio del mismo producto', () => {
      const setHandler = getHandler('ipc:set-special-customer-price')
      const getHandler_ = getHandler('ipc:get-special-customer-prices')

      const r1 = setHandler(null, { specialCustomerId: SC_ID, productId: PROD_ID, price: 12000 }) as { ok: boolean }
      expect(r1.ok).toBe(true)

      const r2 = setHandler(null, { specialCustomerId: SC_ID, productId: PROD_ID, price: 13000, notes: 'precio rebajado' }) as { ok: boolean }
      expect(r2.ok).toBe(true)

      const list = getHandler_(null, { specialCustomerId: SC_ID }) as { ok: boolean; data: Array<{ specialPrice: number; notes: string | null }> }
      expect(list.ok).toBe(true)
      expect(list.data).toHaveLength(1)
      expect(list.data[0].specialPrice).toBe(13000)
      expect(list.data[0].notes).toBe('precio rebajado')
    })

    it('delete: elimina precio de un producto específico', () => {
      const setHandler = getHandler('ipc:set-special-customer-price')
      const deleteHandler = getHandler('ipc:delete-special-customer-price')
      const getHandler_ = getHandler('ipc:get-special-customer-prices')

      setHandler(null, { specialCustomerId: SC_ID, productId: PROD_ID, price: 10000 })
      const del = deleteHandler(null, { specialCustomerId: SC_ID, productId: PROD_ID }) as { ok: boolean }
      expect(del.ok).toBe(true)

      const list = getHandler_(null, { specialCustomerId: SC_ID }) as { ok: boolean; data: unknown[] }
      expect(list.data).toHaveLength(0)
    })

    it('rechaza set si cajera intenta editar', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const setHandler = getHandler('ipc:set-special-customer-price')
      const res = setHandler(null, { specialCustomerId: SC_ID, productId: PROD_ID, price: 9000 }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })
  })
})
