import { describe, it, expect, vi, beforeEach } from 'vitest'
import { and, eq, sum } from 'drizzle-orm'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, ceboEntries, sales, saleItems, salePayments, products } from '../../db/schema'

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

vi.mock('../../licensing/saleSync', () => ({
  pushUnsyncedSales: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../inactivityDaemon', () => ({
  notifySaleOccurred: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { pullCeboForStoreWeek } from '../../licensing/ceboSync'
import { notifySaleOccurred } from '../inactivityDaemon'
import { registerCeboHandlers } from '../cebo.handler'
import { SEBO_PRODUCT_ID } from '../ceboSale'

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
    expect(row?.saleId).toBeNull()
    expect(db.select().from(sales).all()).toHaveLength(0)
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
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  function confirmedCashTotal(): number {
    const [row] = db
      .select({ totalCash: sum(salePayments.amount) })
      .from(salePayments)
      .innerJoin(sales, eq(salePayments.saleId, sales.id))
      .where(and(
        eq(sales.shiftId, 'shift-001'),
        eq(sales.status, 'confirmed'),
        eq(salePayments.paymentMethod, 'cash'),
      ))
      .all()
    return Number(row?.totalCash ?? 0)
  }

  it('sin importe no mueve caja', () => {
    const result = getHandler('ipc:register-cebo')(null, { quantityKg: 3 }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(confirmedCashTotal()).toBe(0)
    expect(notifySaleOccurred).not.toHaveBeenCalled()
  })

  it('con efectivo registra la venta y suma a la caja', async () => {
    db.update(stores).set({
      cashDiscountMinAmount: 1,
      cashDiscountPercent: 10,
    }).where(eq(stores.id, 'store-001')).run()

    const result = getHandler('ipc:register-cebo')(null, {
      quantityKg: 4,
      notes: 'entrega',
      amount: 10000,
      paymentMethod: 'cash',
    }) as { ok: boolean; data: { id: string } }
    expect(result.ok).toBe(true)

    const cebo = db.select().from(ceboEntries).all()[0]
    expect(cebo?.saleId).toBeTruthy()
    expect(cebo?.quantityKg).toBe(4)

    const sale = db.select().from(sales).where(eq(sales.id, cebo!.saleId!)).get()
    expect(sale?.status).toBe('confirmed')
    expect(sale?.total).toBe(10000)
    expect(sale?.discountAmount).toBe(0)
    expect(sale?.shiftId).toBe('shift-001')

    const payment = db.select().from(salePayments).where(eq(salePayments.saleId, sale!.id)).get()
    expect(payment?.paymentMethod).toBe('cash')
    expect(payment?.amount).toBe(10000)

    const item = db.select().from(saleItems).where(eq(saleItems.saleId, sale!.id)).get()
    expect(item?.productId).toBe(SEBO_PRODUCT_ID)
    expect(item?.quantity).toBe(4)
    expect(item?.subtotal).toBe(10000)

    const product = db.select().from(products).where(eq(products.id, SEBO_PRODUCT_ID)).get()
    expect(product?.name).toBe('Sebo')
    expect(product?.active).toBe(false)
    expect(product?.pluNumber).toBeNull()

    expect(confirmedCashTotal()).toBe(10000)
    expect(notifySaleOccurred).toHaveBeenCalledTimes(1)

    const list = await getHandler('ipc:list-shift-cebo')(null) as {
      ok: boolean
      data: Array<{ amount: number | null; paymentMethod: string | null }>
    }
    expect(list.ok).toBe(true)
    expect(list.data[0]?.amount).toBe(10000)
    expect(list.data[0]?.paymentMethod).toBe('cash')
  })

  it('un medio digital no suma a la caja y deja la entrega', () => {
    const result = getHandler('ipc:register-cebo')(null, {
      quantityKg: 2.25,
      amount: 5000,
      paymentMethod: 'debit',
    }) as { ok: boolean }
    expect(result.ok).toBe(true)

    const cebo = db.select().from(ceboEntries).all()[0]
    expect(cebo?.quantityKg).toBe(2.25)
    const payment = db.select().from(salePayments).all()[0]
    expect(payment?.paymentMethod).toBe('debit')
    expect(payment?.amount).toBe(5000)
    expect(confirmedCashTotal()).toBe(0)
    expect(db.select().from(sales).all()[0]?.status).toBe('confirmed')
  })

  it('rechaza importe sin medio de pago', () => {
    const result = getHandler('ipc:register-cebo')(null, {
      quantityKg: 1,
      amount: 1500,
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
    expect(db.select().from(sales).all()).toHaveLength(0)
  })

  it('rechaza medio de pago sin importe', () => {
    const result = getHandler('ipc:register-cebo')(null, {
      quantityKg: 1,
      paymentMethod: 'cash',
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza importe no entero o medio desconocido', () => {
    const fraction = getHandler('ipc:register-cebo')(null, {
      quantityKg: 1,
      amount: 10.5,
      paymentMethod: 'cash',
    }) as { ok: boolean; code: string }
    expect(fraction.ok).toBe(false)
    expect(fraction.code).toBe('INVALID_PAYLOAD')

    const unknown = getHandler('ipc:register-cebo')(null, {
      quantityKg: 1,
      amount: 100,
      paymentMethod: 'transferencia',
    }) as { ok: boolean; code: string }
    expect(unknown.ok).toBe(false)
    expect(unknown.code).toBe('INVALID_PAYLOAD')
    expect(db.select().from(ceboEntries).all()).toHaveLength(0)
  })

  it('no vuelve a cobrar un sebo que ya tiene venta', () => {
    const created = getHandler('ipc:register-cebo')(null, {
      quantityKg: 1,
      amount: 2000,
      paymentMethod: 'wallet',
    }) as { ok: boolean; data: { id: string } }
    expect(created.ok).toBe(true)
    const result = getHandler('ipc:update-cebo')(null, {
      id: created.data.id,
      quantityKg: 1.5,
      amount: 3000,
      paymentMethod: 'cash',
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ALREADY_PAID')
    expect(db.select().from(sales).all()).toHaveLength(1)
    expect(db.select().from(salePayments).all()[0]?.amount).toBe(2000)
    expect(db.select().from(ceboEntries).all()[0]?.quantityKg).toBe(1)
  })

  it('al editar kilos de un sebo cobrado no cambia el importe', () => {
    const created = getHandler('ipc:register-cebo')(null, {
      quantityKg: 2,
      amount: 8000,
      paymentMethod: 'cash',
    }) as { ok: boolean; data: { id: string } }
    const updated = getHandler('ipc:update-cebo')(null, {
      id: created.data.id,
      quantityKg: 3,
      notes: 'corregido',
    }) as { ok: boolean }
    expect(updated.ok).toBe(true)
    expect(db.select().from(ceboEntries).all()[0]?.quantityKg).toBe(3)
    expect(db.select().from(salePayments).all()[0]?.amount).toBe(8000)
    expect(db.select().from(saleItems).all()[0]?.quantity).toBe(3)
    expect(db.select().from(saleItems).all()[0]?.subtotal).toBe(8000)
    expect(confirmedCashTotal()).toBe(8000)
  })

  it('se puede cobrar después, al editar una entrega sin plata', () => {
    const created = getHandler('ipc:register-cebo')(null, { quantityKg: 1.5 }) as {
      ok: boolean
      data: { id: string }
    }
    const updated = getHandler('ipc:update-cebo')(null, {
      id: created.data.id,
      quantityKg: 1.5,
      amount: 4000,
      paymentMethod: 'credit',
    }) as { ok: boolean }
    expect(updated.ok).toBe(true)
    expect(db.select().from(sales).all()).toHaveLength(1)
    expect(db.select().from(salePayments).all()[0]?.paymentMethod).toBe('credit')
    expect(confirmedCashTotal()).toBe(0)
    expect(db.select().from(ceboEntries).all()[0]?.saleId).toBeTruthy()
  })

  it('si la venta se anuló, se puede cobrar de nuevo', async () => {
    const created = getHandler('ipc:register-cebo')(null, {
      quantityKg: 1,
      amount: 2000,
      paymentMethod: 'cash',
    }) as { ok: boolean; data: { id: string } }
    const first = db.select().from(ceboEntries).all()[0]
    db.update(sales).set({ status: 'cancelled' }).where(eq(sales.id, first!.saleId!)).run()

    const listed = await getHandler('ipc:list-shift-cebo')(null) as {
      ok: boolean
      data: Array<{ amount: number | null }>
    }
    expect(listed.data[0]?.amount).toBeNull()

    const again = getHandler('ipc:update-cebo')(null, {
      id: created.data.id,
      quantityKg: 1,
      amount: 2500,
      paymentMethod: 'cash',
    }) as { ok: boolean }
    expect(again.ok).toBe(true)
    expect(confirmedCashTotal()).toBe(2500)
    expect(db.select().from(sales).all()).toHaveLength(2)
  })

  it('con importe y sin turno no deja venta ni entrega', () => {
    vi.mocked(getActiveSession).mockReturnValue({ ...SESSION, shiftId: null } as ReturnType<typeof getActiveSession>)
    const result = getHandler('ipc:register-cebo')(null, {
      quantityKg: 1,
      amount: 1000,
      paymentMethod: 'cash',
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SHIFT')
    expect(db.select().from(sales).all()).toHaveLength(0)
    expect(db.select().from(ceboEntries).all()).toHaveLength(0)
  })
})
