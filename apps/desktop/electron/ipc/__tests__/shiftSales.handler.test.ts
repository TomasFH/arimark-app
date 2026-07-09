import { describe, it, expect, vi, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, products, sales, saleItems, salePayments } from '../../db/schema'

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

vi.mock('../inactivityDaemon', () => ({
  notifySaleOccurred: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerSaleHandlers } from '../sale.handler'
import type { ShiftSaleRow } from '../../../src/types/hw-api'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', shiftId: 'shift-001' }
const now = new Date().toISOString()

describe('sale.handler — GET_SHIFT_SALES', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  function insertSale(opts: {
    id: string
    total: number
    status?: 'confirmed' | 'in_progress'
    payments: Array<{ method: 'cash' | 'debit' | 'wallet' | 'credit'; amount: number }>
    items?: Array<{ productId: string; qty: number; unitPrice: number; subtotal: number }>
    createdAt?: string
  }) {
    db.insert(sales).values({
      id: opts.id, storeId: 'store-001', shiftId: 'shift-001', customerId: null,
      total: opts.total, isDebt: false, status: opts.status ?? 'confirmed',
      manualEntry: false, manualApprovedBy: null, manualApprovedAt: null,
      notes: null, createdAt: opts.createdAt ?? now, createdBy: 'user-001',
    }).run()
    for (const it of opts.items ?? [{ productId: 'prod-1', qty: 1, unitPrice: opts.total, subtotal: opts.total }]) {
      db.insert(saleItems).values({
        id: uuidv4(), saleId: opts.id, productId: it.productId,
        quantity: it.qty, unitPrice: it.unitPrice, subtotal: it.subtotal, notes: null,
      }).run()
    }
    for (const p of opts.payments) {
      db.insert(salePayments).values({
        id: uuidv4(), saleId: opts.id, paymentMethod: p.method, amount: p.amount,
        createdAt: now, createdBy: 'user-001',
      }).run()
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db

    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera', storeId: 'store-001', role: 'cashier', active: true, createdAt: now }).run()
    db.insert(shifts).values({
      id: 'shift-001', storeId: 'store-001', userId: 'user-001',
      shiftType: 'morning', startedAt: now, openingCash: 5000, source: 'desktop',
    }).run()
    db.insert(products).values({ id: 'prod-1', name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, active: true, createdAt: now }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)
    registerSaleHandlers()
  })

  it('retorna lista vacía si no hay ventas', () => {
    const result = getHandler('ipc:get-shift-sales')(null) as { ok: boolean; data: ShiftSaleRow[] }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(0)
  })

  it('separa efectivo de digital en venta combinada', () => {
    insertSale({
      id: 'sale-1', total: 10000,
      payments: [{ method: 'cash', amount: 6000 }, { method: 'debit', amount: 4000 }],
    })
    const result = getHandler('ipc:get-shift-sales')(null) as { ok: boolean; data: ShiftSaleRow[] }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.cashAmount).toBe(6000)
    expect(result.data[0]!.digitalAmount).toBe(4000)
    expect(result.data[0]!.paymentMethods.sort()).toEqual(['cash', 'debit'])
  })

  it('venta 100% digital no suma efectivo', () => {
    insertSale({ id: 'sale-2', total: 8000, payments: [{ method: 'wallet', amount: 8000 }] })
    const result = getHandler('ipc:get-shift-sales')(null) as { ok: boolean; data: ShiftSaleRow[] }
    expect(result.data[0]!.cashAmount).toBe(0)
    expect(result.data[0]!.digitalAmount).toBe(8000)
  })

  it('venta 100% efectivo no suma digital', () => {
    insertSale({ id: 'sale-3', total: 7000, payments: [{ method: 'cash', amount: 7000 }] })
    const result = getHandler('ipc:get-shift-sales')(null) as { ok: boolean; data: ShiftSaleRow[] }
    expect(result.data[0]!.cashAmount).toBe(7000)
    expect(result.data[0]!.digitalAmount).toBe(0)
  })

  it('excluye ventas no confirmadas', () => {
    insertSale({ id: 'sale-ok', total: 6000, payments: [{ method: 'cash', amount: 6000 }] })
    insertSale({ id: 'sale-wip', total: 9000, status: 'in_progress', payments: [{ method: 'cash', amount: 9000 }] })
    const result = getHandler('ipc:get-shift-sales')(null) as { ok: boolean; data: ShiftSaleRow[] }
    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.id).toBe('sale-ok')
  })

  it('incluye los ítems con nombre de producto', () => {
    insertSale({
      id: 'sale-4', total: 16000,
      items: [{ productId: 'prod-1', qty: 1, unitPrice: 16000, subtotal: 16000 }],
      payments: [{ method: 'cash', amount: 16000 }],
    })
    const result = getHandler('ipc:get-shift-sales')(null) as { ok: boolean; data: ShiftSaleRow[] }
    expect(result.data[0]!.items).toHaveLength(1)
    expect(result.data[0]!.items[0]!.productName).toBe('Asado')
  })

  it('rechaza si no hay sesión activa', () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const result = getHandler('ipc:get-shift-sales')(null) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SESSION')
  })
})
