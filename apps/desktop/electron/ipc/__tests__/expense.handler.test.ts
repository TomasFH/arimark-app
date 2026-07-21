import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, expenses } from '../../db/schema'

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
import { registerExpenseHandlers } from '../expense.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001' }
const SESSION_NO_SHIFT = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: null }

describe('expense.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db

    // Seed base: store, user, shift
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: new Date().toISOString() }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera Test', storeId: 'store-001', role: 'cashier', active: true, createdAt: new Date().toISOString() }).run()
    db.insert(shifts).values({
      id: 'shift-001',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: new Date().toISOString(),
      openingCash: 5000,
      source: 'desktop',
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)

    registerExpenseHandlers()
  })

  describe('REGISTER_EXPENSE (ipc:register-expense)', () => {
    it('registra un gasto válido', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { category: 'Insumos', amount: 1500 }) as { ok: boolean; data: { id: string } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBeTruthy()

      const row = db.select().from(expenses).all()[0]
      expect(row.category).toBe('Insumos')
      expect(row.amount).toBe(1500)
      expect(row.shiftId).toBe('shift-001')
    })

    it('registra gasto con notas', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { category: 'Limpieza', amount: 800, notes: 'Compra de detergente' }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const row = db.select().from(expenses).all()[0]
      expect(row.notes).toBe('Compra de detergente')
    })

    it('rechaza payload inválido — sin categoría', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { amount: 500 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza payload inválido — monto cero', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { category: 'Otros', amount: 0 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza si no hay sesión activa', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { category: 'Insumos', amount: 500 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })

    it('rechaza si no hay turno activo', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { category: 'Insumos', amount: 500 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SHIFT')
    })
  })

  describe('GET_SHIFT_EXPENSES (ipc:get-shift-expenses)', () => {
    it('retorna lista vacía si no hay gastos', () => {
      const handler = getHandler('ipc:get-shift-expenses')
      const result = handler(null) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('retorna los gastos del turno activo', () => {
      // Insertar un gasto directamente
      db.insert(expenses).values({
        id: 'exp-001',
        storeId: 'store-001',
        shiftId: 'shift-001',
        category: 'Insumos',
        amount: 2000,
        notes: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-shift-expenses')
      const result = handler(null) as { ok: boolean; data: Array<{ category: string; amount: number }> }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].category).toBe('Insumos')
      expect(result.data[0].amount).toBe(2000)
    })

    it('retorna error si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:get-shift-expenses')
      const result = handler(null) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })
  })

  describe('GET_EXPENSE_CATEGORIES (ipc:get-expense-categories)', () => {
    it('retorna categorías predefinidas cuando no hay historial', () => {
      const handler = getHandler('ipc:get-expense-categories')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      // Debe incluir alguna categoría predefinida
      expect(result.data.some(c => ['Insumos', 'Limpieza', 'Servicios', 'Otros'].includes(c))).toBe(true)
    })

    it('retorna categorías usadas mezcladas con las predefinidas no usadas', () => {
      // Insertar gastos con categoría personalizada
      db.insert(expenses).values({
        id: 'exp-001',
        storeId: 'store-001',
        shiftId: 'shift-001',
        category: 'Reparaciones',
        amount: 5000,
        notes: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-expense-categories')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      // Reparaciones debe aparecer primero (es del historial)
      expect(result.data[0]).toBe('Reparaciones')
      // Y las predefinidas no usadas también deben estar
      expect(result.data.includes('Limpieza')).toBe(true)
    })

    it('retorna error si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:get-expense-categories')
      const result = handler(null) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })
  })

  describe('GET_PROVIDER_DEBT (ipc:get-provider-debt)', () => {
    it('devuelve null si no hay deuda registrada para el proveedor', () => {
      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { provider: 'Proveedor Inexistente' }) as { ok: boolean; data: null }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('devuelve saldo correcto tras registrar deuda', () => {
      const expenseHandler = getHandler('ipc:register-expense')
      expenseHandler(null, {
        category: 'Insumos',
        amount: 80000,
        provider: 'Proveedor X',
        newDebtAmount: 20000,
      })

      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { provider: 'Proveedor X' }) as { ok: boolean; data: { provider: string; balance: number } }
      expect(result.ok).toBe(true)
      expect(result.data?.balance).toBe(20000)
    })

    it('reduce el saldo al registrar pago de deuda', () => {
      const expenseHandler = getHandler('ipc:register-expense')
      expenseHandler(null, { category: 'Insumos', amount: 80000, provider: 'Prov Y', newDebtAmount: 20000 })
      expenseHandler(null, { category: 'Insumos', amount: 140000, provider: 'Prov Y', paysOldDebt: 20000 })

      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { provider: 'Prov Y' }) as { ok: boolean; data: { balance: number } }
      expect(result.ok).toBe(true)
      expect(result.data?.balance).toBe(0)
    })

    it('rechaza payload inválido', () => {
      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { provider: '' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('GET_PROVIDER_NAMES (ipc:get-provider-names)', () => {
    it('devuelve lista vacía si no hay proveedores registrados', () => {
      const handler = getHandler('ipc:get-provider-names')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('devuelve los proveedores usados en el local', () => {
      const expenseHandler = getHandler('ipc:register-expense')
      expenseHandler(null, { category: 'Insumos', amount: 5000, provider: 'Carnicero Pedro' })

      const handler = getHandler('ipc:get-provider-names')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      expect(result.data).toContain('Carnicero Pedro')
    })
  })
})
