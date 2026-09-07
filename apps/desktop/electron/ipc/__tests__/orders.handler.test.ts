import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
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

vi.mock('../../licensing/orderSync', () => ({
  pushUnsyncedOrders: vi.fn().mockResolvedValue(undefined),
  markOrderDeletedInFirestore: vi.fn().mockResolvedValue(undefined),
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
    db.insert(stores).values({
      id: STORE_ID,
      name: 'Local 1',
      address: 'Calle 1',
      createdAt: now,
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }).run()
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

    it('acepta horario específico dentro de la franja, incluso cerca del cierre', () => {
      const handler = getHandler('ipc:create-order')
      const ok = handler(null, {
        customerName: 'Retiro 11',
        items: 'Asado',
        pickupDate: '2026-07-25',
        timeSlot: 'specific',
        pickupTime: '11:00',
      }) as { ok: boolean }
      expect(ok.ok).toBe(true)
      const near = handler(null, {
        customerName: 'Retiro 13',
        items: 'Asado',
        pickupDate: '2026-07-25',
        timeSlot: 'specific',
        pickupTime: '13:00',
      }) as { ok: boolean }
      expect(near.ok).toBe(true)
    })

    it('rechaza horario específico con el local cerrado', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Madrugada',
        items: 'Asado',
        pickupDate: '2026-07-25',
        timeSlot: 'specific',
        pickupTime: '15:00',
      }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('STORE_CLOSED')
    })

    it('usa el horario del día de retiro, no el de todos los días', () => {
      db.update(stores).set({
        hoursSchedule: JSON.stringify([
          {
            days: [1, 2, 3, 4, 5, 6],
            morningStart: '08:00',
            morningEnd: '14:00',
            afternoonStart: '16:00',
            afternoonEnd: '20:30',
          },
          {
            days: [0],
            morningStart: '08:00',
            morningEnd: '14:00',
            afternoonStart: null,
            afternoonEnd: null,
          },
        ]),
      }).where(eq(stores.id, STORE_ID)).run()
      const handler = getHandler('ipc:create-order')
      const sunday = handler(null, {
        customerName: 'Domingo',
        items: 'Asado',
        pickupDate: '2026-09-06',
        timeSlot: 'specific',
        pickupTime: '17:00',
      }) as { ok: boolean; code: string }
      expect(sunday.ok).toBe(false)
      expect(sunday.code).toBe('STORE_CLOSED')
      const monday = handler(null, {
        customerName: 'Lunes',
        items: 'Asado',
        pickupDate: '2026-09-07',
        timeSlot: 'specific',
        pickupTime: '17:00',
      }) as { ok: boolean }
      expect(monday.ok).toBe(true)
      const sundayAfternoon = handler(null, {
        customerName: 'Domingo tarde',
        items: 'Asado',
        pickupDate: '2026-09-06',
        timeSlot: 'afternoon',
      }) as { ok: boolean; error: string; code: string }
      expect(sundayAfternoon.ok).toBe(false)
      expect(sundayAfternoon.code).toBe('STORE_CLOSED')
      expect(sundayAfternoon.error).toMatch(/tarde/)
      const mondayAfternoon = handler(null, {
        customerName: 'Lunes tarde',
        items: 'Asado',
        pickupDate: '2026-09-07',
        timeSlot: 'afternoon',
      }) as { ok: boolean }
      expect(mondayAfternoon.ok).toBe(true)
    })

    it('rechaza horario específico sin hora', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Sin hora',
        items: 'Asado',
        pickupDate: '2026-07-25',
        timeSlot: 'specific',
      }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
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

    it('acepta línea de presupuesto solo con piezas (kg = 0)', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Morcilla piezas',
        items: 'Morcilla · 3 u',
        pickupDate: '2026-07-25',
        budgetItems: [{
          productId: 'p-morcilla',
          name: 'Morcilla',
          unit: 'kg',
          pluNumber: 12,
          estimatedQty: 0,
          unitPrice: 6000,
          requestedUnits: 3,
        }],
      }) as { ok: boolean; data: { budgetItems: Array<{ estimatedQty: number; requestedUnits?: number | null }> } }
      expect(res.ok).toBe(true)
      expect(res.data.budgetItems[0]?.estimatedQty).toBe(0)
      expect(res.data.budgetItems[0]?.requestedUnits).toBe(3)
    })

    it('rechaza línea de presupuesto sin kg ni piezas', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Vacío',
        items: 'Vacío',
        pickupDate: '2026-07-25',
        budgetItems: [{
          productId: 'p-vacio',
          name: 'Vacío',
          unit: 'kg',
          estimatedQty: 0,
          unitPrice: 21000,
        }],
      }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('acepta línea con kg y piezas', () => {
      const handler = getHandler('ipc:create-order')
      const res = handler(null, {
        customerName: 'Mix',
        items: 'Morcilla · 3 u (~1 kg)',
        pickupDate: '2026-07-25',
        budgetItems: [{
          productId: 'p-morcilla',
          name: 'Morcilla',
          unit: 'kg',
          estimatedQty: 1,
          unitPrice: 6000,
          requestedUnits: 3,
        }],
      }) as { ok: boolean; data: { budgetItems: Array<{ estimatedQty: number; requestedUnits?: number | null }> } }
      expect(res.ok).toBe(true)
      expect(res.data.budgetItems[0]?.estimatedQty).toBe(1)
      expect(res.data.budgetItems[0]?.requestedUnits).toBe(3)
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

    it('rechaza cambiar un pedido cobrado, incluso a pendiente', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Cobrado',
        items: 'Asado',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
      getHandler('ipc:charge-order')(null, { orderId: created.data.id, remaining: 0, payments: [] })

      const res = getHandler('ipc:update-order-status')(null, {
        id: created.data.id,
        status: 'pending',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_STATUS')
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

    it('rechaza pasar a horario específico con el local cerrado', () => {
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, {
        customerName: 'Original',
        items: 'Vacío',
        pickupDate: '2026-07-25',
        timeSlot: 'morning',
      }) as { ok: boolean; data: { id: string } }
      const handler = getHandler('ipc:update-order')
      const res = handler(null, {
        id: created.data.id,
        timeSlot: 'specific',
        pickupTime: '15:00',
      }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('STORE_CLOSED')
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

    it('rechaza editar un pedido cobrado', () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Original',
        items: 'Vacío',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
      getHandler('ipc:charge-order')(null, { orderId: created.data.id, remaining: 0, payments: [] })

      const res = getHandler('ipc:update-order')(null, {
        id: created.data.id,
        customerName: 'No debería',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_STATUS')
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

    it('rechaza cancelar un pedido cobrado', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Ya cobrado',
        items: 'Asado',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
      getHandler('ipc:charge-order')(null, { orderId: created.data.id, remaining: 0, payments: [] })

      const res = getHandler('ipc:delete-order')(null, { id: created.data.id }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_STATUS')
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

    it('admin puede eliminar un pedido cancelado', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const createHandler = getHandler('ipc:create-order')
      const created = createHandler(null, { customerName: 'Eliminar', items: 'Algo', pickupDate: '2026-07-25' }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const cancel = getHandler('ipc:delete-order')(null, { id: created.data.id }) as { ok: boolean }
      expect(cancel.ok).toBe(true)

      const handler = getHandler('ipc:hard-delete-order')
      const res = handler(null, { id: created.data.id }) as { ok: boolean }
      expect(res.ok).toBe(true)

      const list = getHandler('ipc:list-orders')
      const listRes = list(null) as { ok: boolean; data: { id: string }[] }
      expect(listRes.data.find(o => o.id === created.data.id)).toBeUndefined()
    })

    it('rechaza eliminar un pedido pendiente', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Pendiente',
        items: 'Algo',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)

      const res = getHandler('ipc:hard-delete-order')(null, { id: created.data.id }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_STATUS')
    })

    it('rechaza eliminar un pedido cobrado', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Cobrado',
        items: 'Algo',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
      getHandler('ipc:charge-order')(null, { orderId: created.data.id, remaining: 0, payments: [] })

      const res = getHandler('ipc:hard-delete-order')(null, { id: created.data.id }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_STATUS')
    })
  })

  describe('CHARGE_ORDER', () => {
    it('marca entregado sin venta si remaining es 0', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Ana',
        items: 'Asado',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
      const res = getHandler('ipc:charge-order')(null, {
        orderId: created.data.id,
        remaining: 0,
        payments: [],
      }) as { ok: boolean; data: { status: string } }
      expect(res.ok).toBe(true)
      expect(res.data.status).toBe('delivered')
      expect(db.select().from(sales).all()).toHaveLength(0)
    })

    it('resto > 0 rechaza con INVALID_PAYLOAD: usar flujo del POS', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Luis',
        items: 'Vacío',
        pickupDate: '2026-07-25',
        depositAmount: 40000,
        depositPayments: [{ method: 'cash', amount: 40000 }],
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
      const res = getHandler('ipc:charge-order')(null, {
        orderId: created.data.id,
        remaining: 20000,
        payments: [{ paymentMethod: 'cash', amount: 20000 }],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
      // El pedido no queda entregado — sigue en su estado original
      expect(db.select().from(sales).all()).toHaveLength(0)
    })

    it('rechaza segundo cobro (remaining=0 sobre pedido ya entregado)', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Eva',
        items: 'Pollo',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
      // Primer cobro: OK
      getHandler('ipc:charge-order')(null, { orderId: created.data.id, remaining: 0, payments: [] })
      // Segundo cobro: ya está entregado
      const res = getHandler('ipc:charge-order')(null, {
        orderId: created.data.id,
        remaining: 0,
        payments: [],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_STATUS')
    })

    it('resto > 0 sin turno → sigue siendo INVALID_PAYLOAD (flujo POS, no CHARGE_ORDER)', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT as unknown as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:charge-order')(null, {
        orderId: '00000000-0000-0000-0000-000000000001',
        remaining: 1000,
        payments: [{ paymentMethod: 'cash', amount: 1000 }],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza pagos que no cubren el resto', () => {
      const created = getHandler('ipc:create-order')(null, {
        customerName: 'Nora',
        items: 'Bondiola',
        pickupDate: '2026-07-25',
      }) as { ok: boolean; data: { id: string } }
      expect(created.ok).toBe(true)
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
