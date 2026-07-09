import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, products, productPrices, sales, saleItems, salePayments } from '../../db/schema'
import { v4 as uuidv4 } from 'uuid'

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
import { registerDevSeedHandlers } from '../devSeed.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', shiftId: 'shift-001' }
const now = new Date().toISOString()

describe('devSeed.handler — DEV_GENERATE_SALES', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  async function seedBase(withPrices = true) {
    const instance = await createInMemoryDb()
    db = instance.db

    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera', storeId: 'store-001', role: 'cashier', active: true, createdAt: now }).run()
    db.insert(shifts).values({
      id: 'shift-001', storeId: 'store-001', userId: 'user-001',
      shiftType: 'morning', startedAt: now, openingCash: 5000, source: 'desktop',
    }).run()

    // Catálogo con productos + precios vigentes
    const catalog = [
      { id: 'prod-1', name: 'Asado', unit: 'kg' as const, plu: 1, price: 16000 },
      { id: 'prod-2', name: 'Pollo', unit: 'kg' as const, plu: 100, price: 4000 },
      { id: 'prod-3', name: 'Huevos', unit: 'unit' as const, plu: 250, price: 6000 },
    ]
    for (const p of catalog) {
      db.insert(products).values({
        id: p.id, name: p.name, category: 'beef_cut', unit: p.unit, pluNumber: p.plu, active: true, createdAt: now,
      }).run()
      if (withPrices) {
        db.insert(productPrices).values({
          id: uuidv4(), productId: p.id, storeId: 'store-001', price: p.price,
          validFrom: '2026-01-01T00:00:00.000Z', validTo: null, createdBy: 'user-001',
        }).run()
      }
    }

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)
  })

  it('genera la cantidad de ventas pedida con ítems y pagos válidos', async () => {
    await seedBase()
    registerDevSeedHandlers()

    const result = getHandler('ipc:dev-generate-sales')(null, { count: 15 }) as { ok: boolean; data: { created: number } }
    expect(result.ok).toBe(true)
    expect(result.data.created).toBe(15)

    const allSales = db.select().from(sales).all()
    expect(allSales).toHaveLength(15)
    // Todas confirmadas
    expect(allSales.every(s => s.status === 'confirmed')).toBe(true)
    // Cada venta tiene al menos un ítem y un pago
    for (const s of allSales) {
      const items = db.select().from(saleItems).where(eq(saleItems.saleId, s.id)).all()
      const pays = db.select().from(salePayments).where(eq(salePayments.saleId, s.id)).all()
      expect(items.length).toBeGreaterThan(0)
      expect(pays.length).toBeGreaterThan(0)
      // La suma de pagos coincide con el total
      const paySum = pays.reduce((sum, p) => sum + p.amount, 0)
      expect(paySum).toBe(s.total)
    }
  })

  it('respeta el rango de ticket (>= 6000)', async () => {
    await seedBase()
    registerDevSeedHandlers()

    getHandler('ipc:dev-generate-sales')(null, { count: 30 })
    const allSales = db.select().from(sales).all()
    for (const s of allSales) {
      expect(s.total).toBeGreaterThanOrEqual(6000)
    }
  })

  it('rechaza payload inválido', async () => {
    await seedBase()
    registerDevSeedHandlers()
    const result = getHandler('ipc:dev-generate-sales')(null, { count: 0 }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('falla si no hay catálogo con precio vigente', async () => {
    await seedBase(false)
    registerDevSeedHandlers()
    const result = getHandler('ipc:dev-generate-sales')(null, { count: 5 }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_CATALOG')
  })

  it('rechaza si no hay turno activo', async () => {
    await seedBase()
    vi.mocked(getActiveSession).mockReturnValue({ userId: 'user-001', storeId: 'store-001', shiftId: null } as ReturnType<typeof getActiveSession>)
    registerDevSeedHandlers()
    const result = getHandler('ipc:dev-generate-sales')(null, { count: 5 }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SHIFT')
  })
})
