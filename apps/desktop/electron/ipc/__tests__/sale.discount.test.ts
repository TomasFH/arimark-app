import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, products, sales, orders } from '../../db/schema'
import { eq } from 'drizzle-orm'

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

vi.mock('../auth.handler', () => ({
  getStoredAdminSession: vi.fn().mockReturnValue(null),
  registerAuthHandlers: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn().mockReturnValue({ tenant_id: 'test-tenant' }),
}))

vi.mock('../../licensing/saleSync', () => ({
  pushUnsyncedSales: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/orderSync', () => ({
  pushUnsyncedOrders: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../inactivityDaemon', () => ({
  notifySaleOccurred: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerSaleHandlers } from '../sale.handler'

type HandlerFn = (_event: unknown, payload: unknown) => Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls.filter(c => c[0] === channel)
  const call = calls[calls.length - 1]
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001' }
const now = new Date().toISOString()

describe('sale.handler — descuento efectivo', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    db.insert(stores).values({
      id: 'store-001',
      name: 'Local 1',
      createdAt: now,
      cashDiscountMinAmount: 50000,
      cashDiscountPercent: 10,
    }).run()
    db.insert(users).values({
      id: 'user-001', name: 'Cajera', storeId: 'store-001', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(shifts).values({
      id: 'shift-001', storeId: 'store-001', userId: 'user-001',
      shiftType: 'morning', startedAt: now, openingCash: 0, source: 'desktop',
    }).run()
    db.insert(products).values({
      id: 'prod-001', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, active: true, createdAt: now,
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)
    registerSaleHandlers()
  })

  const items = [{ productId: 'prod-001', quantity: 1, unitPrice: 100000, subtotal: 100000 }]

  it('aplica 10% sobre 100000 y cobra 90000 en efectivo', async () => {
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 90000 }],
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(90000)
    const row = db.select().from(sales).all()[0]
    expect(row?.discountAmount).toBe(10000)
    expect(row?.discountPercent).toBe(10)
    expect(row?.discountException).toBe(false)
    expect(row?.total).toBe(90000)
    const listed = await getHandler('ipc:get-shift-sales')(null, undefined) as {
      ok: boolean
      data: Array<{ discountException?: boolean; discountPercent?: number }>
    }
    expect(listed.ok).toBe(true)
    expect(listed.data[0]?.discountException).toBe(false)
    expect(listed.data[0]?.discountPercent).toBe(10)
  })

  it('seña cash 20000: cobra 70000 y sale.total es 90000', async () => {
    db.insert(orders).values({
      id: '11111111-1111-4111-8111-111111111111',
      storeId: 'store-001',
      customerName: 'Juan',
      items: 'Asado',
      pickupDate: '2026-09-11',
      status: 'ready',
      depositAmount: 20000,
      depositMethod: 'cash',
      createdAt: now,
      createdBy: 'user-001',
    }).run()
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 70000 }],
      orderId: '11111111-1111-4111-8111-111111111111',
      depositCredit: 20000,
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(90000)
    const saved = db.select().from(sales).all()[0]
    expect(saved?.total).toBe(90000)
    expect(saved?.discountAmount).toBe(10000)
  })

  it('seña digital no aplica descuento: cobra 80000', async () => {
    db.insert(orders).values({
      id: '22222222-2222-4222-8222-222222222222',
      storeId: 'store-001',
      customerName: 'Juan',
      items: 'Asado',
      pickupDate: '2026-09-11',
      status: 'ready',
      depositAmount: 20000,
      depositMethod: 'debit',
      createdAt: now,
      createdBy: 'user-001',
    }).run()
    const handler = getHandler('ipc:create-sale')
    const discounted = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 70000 }],
      orderId: '22222222-2222-4222-8222-222222222222',
      depositCredit: 20000,
    }) as { ok: boolean; code?: string }
    expect(discounted.ok).toBe(false)
    expect(discounted.code).toBe('INVALID_PAYLOAD')

    const ok = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 80000 }],
      orderId: '22222222-2222-4222-8222-222222222222',
      depositCredit: 20000,
    }) as { ok: boolean; data: { total: number } }
    expect(ok.ok).toBe(true)
    expect(ok.data.total).toBe(80000)
    expect(db.select().from(sales).all()[0]?.discountAmount).toBe(0)
  })

  it('100% digital no aplica descuento', async () => {
    const handler = getHandler('ipc:create-sale')
    const withDiscount = await handler({}, {
      items,
      payments: [{ paymentMethod: 'debit', amount: 90000 }],
    }) as { ok: boolean }
    expect(withDiscount.ok).toBe(false)

    const ok = await handler({}, {
      items,
      payments: [{ paymentMethod: 'debit', amount: 100000 }],
    }) as { ok: boolean; data: { total: number } }
    expect(ok.ok).toBe(true)
    expect(ok.data.total).toBe(100000)
    expect(db.select().from(sales).all()[0]?.discountAmount).toBe(0)
  })

  it('fiado no aplica descuento', async () => {
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [],
      isDebt: true,
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(100000)
    expect(db.select().from(sales).all()[0]?.discountAmount).toBe(0)
  })

  it('debajo del mínimo no aplica descuento', async () => {
    const handler = getHandler('ipc:create-sale')
    const cheap = [{ productId: 'prod-001', quantity: 1, unitPrice: 49999, subtotal: 49999 }]
    const withDiscount = await handler({}, {
      items: cheap,
      payments: [{ paymentMethod: 'cash', amount: 44999 }],
    }) as { ok: boolean }
    expect(withDiscount.ok).toBe(false)

    const ok = await handler({}, {
      items: cheap,
      payments: [{ paymentMethod: 'cash', amount: 49999 }],
    }) as { ok: boolean; data: { total: number } }
    expect(ok.ok).toBe(true)
    expect(ok.data.total).toBe(49999)
    expect(db.select().from(sales).all()[0]?.discountAmount).toBe(0)
  })

  it('mixto con efectivo mantiene descuento (faltante digital)', async () => {
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [
        { paymentMethod: 'cash', amount: 80000 },
        { paymentMethod: 'debit', amount: 10000 },
      ],
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(90000)
    expect(db.select().from(sales).all()[0]?.discountAmount).toBe(10000)
  })

  it('un porcentaje de esta venta no cambia la regla del local', async () => {
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 100000 }],
      discountPercent: 0,
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(100000)
    const sale = db.select().from(sales).all().at(-1)
    expect(sale?.discountPercent).toBe(0)
    expect(sale?.discountAmount).toBe(0)
    expect(sale?.discountException).toBe(false)
    expect(db.select().from(stores).all()[0]?.cashDiscountPercent).toBe(10)
  })

  it('aplica otro porcentaje solo en esta venta', async () => {
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 95000 }],
      discountPercent: 5,
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(95000)
    expect(db.select().from(sales).all().at(-1)?.discountPercent).toBe(5)
    expect(db.select().from(sales).all().at(-1)?.discountException).toBe(false)
    expect(db.select().from(stores).all()[0]?.cashDiscountPercent).toBe(10)
  })

  it('la excepción descuenta sin mínimo ni efectivo y no cambia la regla', async () => {
    const handler = getHandler('ipc:create-sale')
    const cheap = [{ productId: 'prod-001', quantity: 1, unitPrice: 40000, subtotal: 40000 }]
    const result = await handler({}, {
      items: cheap,
      payments: [{ paymentMethod: 'debit', amount: 38000 }],
      discountPercent: 5,
      discountException: true,
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(38000)
    const sale = db.select().from(sales).all()[0]
    expect(sale?.discountAmount).toBe(2000)
    expect(sale?.discountPercent).toBe(5)
    expect(sale?.discountException).toBe(true)
    const store = db.select().from(stores).all()[0]
    expect(store?.cashDiscountPercent).toBe(10)
    expect(store?.cashDiscountMinAmount).toBe(50000)

    const listed = await getHandler('ipc:get-shift-sales')(null, undefined) as {
      ok: boolean
      data: Array<{ discountException?: boolean; discountPercent?: number }>
    }
    expect(listed.ok).toBe(true)
    expect(listed.data[0]?.discountException).toBe(true)
    expect(listed.data[0]?.discountPercent).toBe(5)
  })

  it('la excepción en 0 no bloquea el cobro y queda marcada', async () => {
    const handler = getHandler('ipc:create-sale')
    const cheap = [{ productId: 'prod-001', quantity: 1, unitPrice: 40000, subtotal: 40000 }]
    const result = await handler({}, {
      items: cheap,
      payments: [{ paymentMethod: 'wallet', amount: 40000 }],
      discountPercent: 0,
      discountException: true,
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(40000)
    const sale = db.select().from(sales).all()[0]
    expect(sale?.discountAmount).toBe(0)
    expect(sale?.discountPercent).toBe(0)
    expect(sale?.discountException).toBe(true)
  })

  it('rechaza discountException que no es booleano', async () => {
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 90000 }],
      discountException: 'si',
    }) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('rechaza un producto que no está en el catálogo', async () => {
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items: [{ productId: 'no-existe', quantity: 1, unitPrice: 1000, subtotal: 1000 }],
      payments: [{ paymentMethod: 'cash', amount: 1000 }],
    }) as { ok: boolean; code?: string }
    expect(result).toMatchObject({ ok: false, code: 'PRODUCT_NOT_FOUND' })
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('vende un producto sin precio de lista al precio del ticket', async () => {
    db.insert(products).values({
      id: 'prod-otros',
      name: 'Otros',
      category: 'other',
      unit: 'kg',
      pluNumber: 999,
      active: true,
      createdAt: now,
    }).run()
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items: [{ productId: 'prod-otros', quantity: 1, unitPrice: 17535, subtotal: 17535 }],
      payments: [{ paymentMethod: 'debit', amount: 17535 }],
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(17535)
  })

  it('turno tarde usa el % de la tarde del horario especial', async () => {
    db.update(stores).set({
      cashDiscountSchedule: JSON.stringify([{
        days: [0, 1, 2, 3, 4, 5, 6],
        morning: { minAmount: 0, percent: 10 },
        afternoon: { minAmount: 0, percent: 20 },
      }]),
    }).where(eq(stores.id, 'store-001')).run()
    db.update(shifts).set({ shiftType: 'evening' }).where(eq(shifts.id, 'shift-001')).run()

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items,
      payments: [{ paymentMethod: 'cash', amount: 80000 }],
    }) as { ok: boolean; data: { total: number } }
    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(80000)
    expect(db.select().from(sales).all()[0]?.discountPercent).toBe(20)
  })
})
