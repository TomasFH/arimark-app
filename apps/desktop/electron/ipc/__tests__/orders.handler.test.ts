import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, products, sales } from '../../db/schema'

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

vi.mock('../../licensing/saleSync', () => ({
  pushUnsyncedSales: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../inactivityDaemon', () => ({
  notifySaleOccurred: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerOrderHandlers } from '../orders.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const STORE_ID  = '00000000-0000-0000-0000-000000000010'
const USER_ID   = '00000000-0000-0000-0000-000000000020'
const SHIFT_ID  = '00000000-0000-0000-0000-000000000030'
const ADMIN_SESSION   = { userId: USER_ID, storeId: STORE_ID, role: 'admin',   shiftId: SHIFT_ID }
const CASHIER_SESSION = { userId: USER_ID, storeId: STORE_ID, role: 'cashier', shiftId: SHIFT_ID }
const SESSION_NO_SHIFT = { userId: USER_ID, storeId: STORE_ID, role: 'cashier', shiftId: undefined }

describe('orders.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const result = await createInMemoryDb()
    db = result.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
    registerOrderHandlers()

    const now = new Date().toISOString()
    db.insert(stores).values({ id: STORE_ID, name: 'Local 1', address: 'Calle 1', createdAt: now }).run()
    db.insert(users).values({ id: USER_ID, storeId: STORE_ID, name: 'Cajera', active: true, createdAt: now }).run()
    db.insert(shifts).values({
      id: SHIFT_ID,
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
      source: 'desktop',
    }).run()
    db.insert(products).values({
      id: '00000000-0000-0000-0000-000000000099',
      name: 'Pedido',
      category: 'other',
      unit: 'unit',
      pluNumber: 999,
      active: true,
      createdAt: now,
    }).run()
  })

  // --------------------------------------------------------------------------
  // CREATE_ORDER
  // --------------------------------------------------------------------------
  describe('CREATE_ORDER', () => {
    it('crea un pedido sin seña', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Juan Restaurante',
        items: '2 kg asado',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string; status: string; depositAmount: number } }
      expect(res.ok).toBe(true)
      expect(res.data.status).toBe('pending')
      expect(res.data.depositAmount).toBe(0)
    })

    it('crea un pedido con seña multimedios', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'María',
        items: '1 pollo',
        pickupDate: '2026-07-25',
        depositAmount: 5000,
        depositPayments: [{ method: 'cash', amount: 3000 }, { method: 'debit', amount: 2000 }],
      }) as { ok: boolean; data: { depositAmount: number; depositPayments: { method: string; amount: number }[] } }
      expect(res.ok).toBe(true)
      expect(res.data.depositAmount).toBe(5000)
      expect(res.data.depositPayments).toHaveLength(2)
    })

    it('crea un pedido prioritario con turno mañana', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'VIP Cliente',
        items: 'Media res',
        pickupDate: '2026-07-25',
        timeSlot: 'morning',
        priority: true,
      }) as { ok: boolean; data: { priority: boolean; timeSlot: string } }
      expect(res.ok).toBe(true)
      expect(res.data.priority).toBe(true)
      expect(res.data.timeSlot).toBe('morning')
    })

    it('rechaza payload inválido', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, { customerName: '', items: '', pickupDate: 'no-es-fecha' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('rechaza seña sin depositPayments', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Ana',
        items: 'Chorizos',
        pickupDate: '2026-07-25',
        depositAmount: 1000,
        // sin depositPayments
      }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('rechaza seña si cajera no tiene turno activo', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Pedro',
        items: 'Asado',
        pickupDate: '2026-07-25',
        depositAmount: 1000,
        depositPayments: [{ method: 'cash', amount: 1000 }],
      }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SHIFT')
    })

    it('admin puede registrar seña sin turno activo', () => {
      const ADMIN_NO_SHIFT = { userId: USER_ID, storeId: STORE_ID, role: 'admin', shiftId: undefined }
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_NO_SHIFT as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Cliente corporativo',
        items: 'Media res',
        pickupDate: '2026-07-25',
        depositAmount: 5000,
        depositPayments: [{ method: 'wallet', amount: 5000 }],
      }) as { ok: boolean; data: { depositAmount: number } }
      expect(res.ok).toBe(true)
      expect(res.data.depositAmount).toBe(5000)
    })

    it('admin puede crear pedido en un local diferente al de sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const STORE_ID_2 = '00000000-0000-0000-0000-000000000099'
      const now = new Date().toISOString()
      db.insert(stores).values({ id: STORE_ID_2, name: 'Local 2', createdAt: now }).run()
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Cliente B',
        items: 'Pollo',
        pickupDate: '2026-07-25',
        storeId: STORE_ID_2,
      }) as { ok: boolean; data: { storeId: string } }
      expect(res.ok).toBe(true)
      expect(res.data.storeId).toBe(STORE_ID_2)
    })

    it('acepta storeId que no es UUID RFC (ids reales de locales)', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'local1', name: 'Local Uno', createdAt: now }).run()
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Cliente C',
        items: 'Asado',
        pickupDate: '2026-07-25',
        storeId: 'local1',
      }) as { ok: boolean; data: { storeId: string } }
      expect(res.ok).toBe(true)
      expect(res.data.storeId).toBe('local1')
    })

    it('rechaza si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:create-order')
      const res = handler(null, { customerName: 'X', items: 'Y', pickupDate: '2026-07-25' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // LIST_ORDERS
  // --------------------------------------------------------------------------
  describe('LIST_ORDERS', () => {
    it('retorna lista vacía si no hay pedidos', () => {
      const handler = getHandler('ipc:list-orders')
      const res = handler(null) as { ok: boolean; data: unknown[] }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(0)
    })

    it('retorna los pedidos creados del local', () => {
      const createHandler = getHandler('ipc:create-order')
      createHandler(null, { customerName: 'A', items: 'Asado', pickupDate: '2026-07-25' })
      createHandler(null, { customerName: 'B', items: 'Pollo', pickupDate: '2026-07-26' })

      const listHandler = getHandler('ipc:list-orders')
      const res = listHandler(null) as { ok: boolean; data: { customerName: string }[] }
      expect(res.ok).toBe(true)
      expect(res.data.length).toBeGreaterThanOrEqual(2)
    })
  })

  // --------------------------------------------------------------------------
  // UPDATE_ORDER_STATUS
  // --------------------------------------------------------------------------
  describe('UPDATE_ORDER_STATUS', () => {
    it('actualiza el estado de pending a ready', () => {
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Carlos', items: 'Costillas', pickupDate: '2026-07-25' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const handler = getHandler('ipc:update-order-status')
      const res = handler(null, { id: created.data.id, status: 'ready' }) as { ok: boolean; data: { status: string } }
      expect(res.ok).toBe(true)
      expect(res.data.status).toBe('ready')
    })

    it('rechaza payload inválido', () => {
      const handler = getHandler('ipc:update-order-status')
      const res = handler(null, { id: 'no-es-uuid', status: 'ready' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('rechaza estado inválido', () => {
      const handler = getHandler('ipc:update-order-status')
      const res = handler(null, { id: '00000000-0000-0000-0000-000000000001', status: 'invalid' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // UPDATE_ORDER — cajera y admin pueden editar
  // --------------------------------------------------------------------------
  describe('UPDATE_ORDER', () => {
    it('cajera puede editar el pedido', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Original', items: 'Vacío', pickupDate: '2026-07-25' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const handler = getHandler('ipc:update-order')
      const res = handler(null, { id: created.data.id, customerName: 'Actualizado' }) as { ok: boolean; data: { customerName: string } }
      expect(res.ok).toBe(true)
      expect(res.data.customerName).toBe('Actualizado')
    })

    it('rechaza agregar seña sin turno activo', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Sin seña', items: 'Algo', pickupDate: '2026-07-25' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:update-order')
      const res = handler(null, { id: created.data.id, depositAmount: 5000, depositPayments: [{ method: 'cash', amount: 5000 }] }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SHIFT')
    })

    it('edita el pedido como admin', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Original', items: 'Vacío', pickupDate: '2026-07-25' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const handler = getHandler('ipc:update-order')
      const res = handler(null, { id: created.data.id, customerName: 'Actualizado Admin', priority: true }) as { ok: boolean; data: { customerName: string; priority: boolean } }
      expect(res.ok).toBe(true)
      expect(res.data.customerName).toBe('Actualizado Admin')
      expect(res.data.priority).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // DELETE_ORDER — cajera y admin (soft delete = cancelar)
  // --------------------------------------------------------------------------
  describe('DELETE_ORDER', () => {
    it('cajera puede cancelar el pedido', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Para cancelar', items: 'Algo', pickupDate: '2026-07-25' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const handler = getHandler('ipc:delete-order')
      const res = handler(null, { id: created.data.id }) as { ok: boolean }
      expect(res.ok).toBe(true)
    })

    it('cancela el pedido como admin (soft delete)', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Para cancelar', items: 'Algo', pickupDate: '2026-12-01' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const handler = getHandler('ipc:delete-order')
      const res = handler(null, { id: created.data.id }) as { ok: boolean }
      expect(res.ok).toBe(true)

      const list = getHandler('ipc:list-orders')
      const listRes = list(null, { status: 'cancelled' }) as { ok: boolean; data: { id: string; status: string }[] }
      expect(listRes.ok).toBe(true)
      const cancelled = listRes.data.find(o => o.id === created.data.id)
      expect(cancelled?.status).toBe('cancelled')
    })

    it('rechaza UUID inválido', () => {
      const handler = getHandler('ipc:delete-order')
      const res = handler(null, { id: 'no-es-uuid' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // HARD_DELETE_ORDER — solo admin
  // --------------------------------------------------------------------------
  describe('HARD_DELETE_ORDER', () => {
    it('cajera no puede eliminar permanentemente', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:hard-delete-order')
      const res = handler(null, { id: '00000000-0000-0000-0000-000000000001' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })

    it('admin puede eliminar permanentemente', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Eliminar', items: 'Algo', pickupDate: '2026-07-25' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const handler = getHandler('ipc:hard-delete-order')
      const res = handler(null, { id: created.data.id }) as { ok: boolean }
      expect(res.ok).toBe(true)

      // Verificar que no aparece más en la lista
      const list = getHandler('ipc:list-orders')
      const listRes = list(null) as { ok: boolean; data: { id: string }[] }
      expect(listRes.data.find(o => o.id === created.data.id)).toBeUndefined()
    })
  })

  describe('CHARGE_ORDER', () => {
    it('marca entregado sin venta si remaining es 0', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Ana',
        items: 'Asado',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      const res = getHandler('ipc:charge-order')(null, {
        orderId: created.data.id,
        remaining: 0,
        payments: [],
      }) as { ok: boolean; data: { status: string } }
      expect(res.ok).toBe(true)
      expect(res.data.status).toBe('delivered')
      expect(db.select().from(sales).all()).toHaveLength(0)
    })

    it('crea venta por el resto y marca entregado', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Luis',
        items: 'Vacío',
        pickupDate: '2026-07-25',
        depositAmount: 40000,
        depositPayments: [{ method: 'cash', amount: 40000 }],
      }) as { ok: boolean; data: { id: string } }
      const res = getHandler('ipc:charge-order')(null, {
        orderId: created.data.id,
        remaining: 20000,
        payments: [{ paymentMethod: 'cash', amount: 20000 }],
      }) as { ok: boolean; data: { status: string } }
      expect(res.ok).toBe(true)
      expect(res.data.status).toBe('delivered')
      expect(db.select().from(sales).all()).toHaveLength(1)
      expect(db.select().from(sales).all()[0].total).toBe(20000)
    })

    it('rechaza segundo cobro', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Eva',
        items: 'Pollo',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      getHandler('ipc:charge-order')(null, { orderId: created.data.id, remaining: 0, payments: [] })
      const res = getHandler('ipc:charge-order')(null, {
        orderId: created.data.id,
        remaining: 1000,
        payments: [{ paymentMethod: 'cash', amount: 1000 }],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_STATUS')
    })

    it('resto > 0 sin turno → NO_SHIFT', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT as unknown as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:charge-order')(null, {
        orderId: '00000000-0000-0000-0000-000000000001',
        remaining: 1000,
        payments: [{ paymentMethod: 'cash', amount: 1000 }],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SHIFT')
    })

    it('rechaza pagos que no cubren el resto', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Nora',
        items: 'Bondiola',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      const res = getHandler('ipc:charge-order')(null, {
        orderId: created.data.id,
        remaining: 5000,
        payments: [{ paymentMethod: 'cash', amount: 1000 }],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })
})
