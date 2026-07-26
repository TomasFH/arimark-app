import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, expenses, providers, providerDebtEvents } from '../../db/schema'

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
  getBusinessConfig: vi.fn(() => ({ license_key: 'test-license', default_store_id: 'store-001' })),
}))

vi.mock('../../licensing/providerSync', () => ({
  pushUnsyncedProviders: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedDebtEvents: vi.fn().mockResolvedValue(undefined),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerExpenseHandlers } from '../expense.handler'
import { providerIdFromName } from '../providerUtils'

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
    it('registra un gasto con concepto libre', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { concept: 'Insumos', amount: 1500 }) as { ok: boolean; data: { id: string } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBeTruthy()

      const row = db.select().from(expenses).all()[0]
      expect(row.concept).toBe('Insumos')
      expect(row.amount).toBe(1500)
      expect(row.shiftId).toBe('shift-001')
    })

    it('registra gasto con proveedor nuevo por nombre — crea proveedor en cache', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { provider: 'Proveedor Nuevo', amount: 5000 }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const expRow = db.select().from(expenses).all()[0]
      const expectedId = providerIdFromName('Proveedor Nuevo')
      expect(expRow.providerId).toBe(expectedId)

      const prov = db.select().from(providers).all()[0]
      expect(prov.name).toBe('Proveedor Nuevo')
      expect(prov.id).toBe(expectedId)
    })

    it('dedup case-insensitive: "Oso" y "OSO" generan el mismo providerId', () => {
      const handler = getHandler('ipc:register-expense')
      handler(null, { provider: 'Oso', amount: 1000 })
      handler(null, { provider: 'OSO', amount: 2000 })

      // Solo debe haber un proveedor en cache (mismo id)
      const allProviders = db.select().from(providers).all()
      expect(allProviders).toHaveLength(1)
      expect(allProviders[0].id).toBe(providerIdFromName('oso'))
    })

    it('registra gasto con providerId del autocomplete', () => {
      // Pre-insertar proveedor en cache
      const pid = providerIdFromName('proveedor registrado')
      db.insert(providers).values({
        id: pid,
        name: 'Proveedor Registrado',
        nameKey: 'proveedor registrado',
        createdAt: new Date().toISOString(),
      }).run()

      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { providerId: pid, amount: 3000 }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const row = db.select().from(expenses).all()[0]
      expect(row.providerId).toBe(pid)
    })

    it('registra gasto con notas', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { concept: 'Limpieza', amount: 800, notes: 'Compra de detergente' }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const row = db.select().from(expenses).all()[0]
      expect(row.notes).toBe('Compra de detergente')
    })

    it('rechaza payload inválido — sin proveedor ni concepto', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { amount: 500 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza payload inválido — monto cero', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { concept: 'Otros', amount: 0 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza si no hay sesión activa', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { concept: 'Insumos', amount: 500 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })

    it('rechaza si no hay turno activo', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, { concept: 'Insumos', amount: 500 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SHIFT')
    })

    it('registra evento de deuda con storeId del debtStoreId cuando se provee uno válido', () => {
      // Pre-insertar segundo local
      db.insert(stores).values({ id: 'store-002', name: 'Local 2', createdAt: new Date().toISOString() }).run()

      const handler = getHandler('ipc:register-expense')
      const result = handler(null, {
        provider: 'Proveedor Cross',
        amount: 80000,
        newDebtAmount: 20000,
        debtStoreId: 'store-002',
      }) as { ok: boolean; data: { id: string } }

      expect(result.ok).toBe(true)

      // El gasto debe quedar en el local de la sesión (store-001)
      const expRow = db.select().from(expenses).all()[0]
      expect(expRow.storeId).toBe('store-001')

      // El evento de deuda debe quedar en el local especificado (store-002)
      const debtEvent = db.select().from(providerDebtEvents).all()[0]
      expect(debtEvent.storeId).toBe('store-002')
      expect(debtEvent.type).toBe('debt')
      expect(debtEvent.amount).toBe(20000)
    })

    it('rechaza debtStoreId inválido — local inexistente', () => {
      const handler = getHandler('ipc:register-expense')
      const result = handler(null, {
        provider: 'Proveedor Cross',
        amount: 80000,
        newDebtAmount: 20000,
        debtStoreId: 'store-inexistente',
      }) as { ok: boolean; code: string }

      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_DEBT_STORE')
    })
  })

  describe('GET_SHIFT_EXPENSES (ipc:get-shift-expenses)', () => {
    it('retorna lista vacía si no hay gastos', () => {
      const handler = getHandler('ipc:get-shift-expenses')
      const result = handler(null) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('retorna los gastos del turno activo con concepto', () => {
      db.insert(expenses).values({
        id: 'exp-001',
        storeId: 'store-001',
        shiftId: 'shift-001',
        concept: 'Insumos',
        amount: 2000,
        createdAt: new Date().toISOString(),
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-shift-expenses')
      const result = handler(null) as { ok: boolean; data: Array<{ concept?: string; amount: number }> }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].concept).toBe('Insumos')
      expect(result.data[0].amount).toBe(2000)
    })

    it('retorna el nombre del proveedor cuando hay providerId', () => {
      const pid = providerIdFromName('oso')
      db.insert(providers).values({ id: pid, name: 'Oso', nameKey: 'oso', createdAt: new Date().toISOString() }).run()
      db.insert(expenses).values({
        id: 'exp-001',
        storeId: 'store-001',
        shiftId: 'shift-001',
        providerId: pid,
        amount: 15000,
        createdAt: new Date().toISOString(),
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-shift-expenses')
      const result = handler(null) as { ok: boolean; data: Array<{ provider?: string; providerId?: string }> }
      expect(result.ok).toBe(true)
      expect(result.data[0].provider).toBe('Oso')
      expect(result.data[0].providerId).toBe(pid)
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
    it('retorna conceptos predefinidos cuando no hay historial', () => {
      const handler = getHandler('ipc:get-expense-categories')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data.some(c => ['Insumos', 'Limpieza', 'Servicios', 'Otros'].includes(c))).toBe(true)
    })

    it('retorna conceptos usados mezclados con los predefinidos no usados', () => {
      db.insert(expenses).values({
        id: 'exp-001',
        storeId: 'store-001',
        shiftId: 'shift-001',
        concept: 'Reparaciones',
        amount: 5000,
        createdAt: new Date().toISOString(),
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-expense-categories')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      expect(result.data[0]).toBe('Reparaciones')
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
      const pid = providerIdFromName('proveedor inexistente')
      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { providerId: pid }) as { ok: boolean; data: null }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('devuelve saldo correcto tras registrar deuda', () => {
      const expenseHandler = getHandler('ipc:register-expense')
      expenseHandler(null, {
        provider: 'Proveedor X',
        amount: 80000,
        newDebtAmount: 20000,
      })

      const pid = providerIdFromName('Proveedor X')
      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { providerId: pid }) as { ok: boolean; data: { provider: string; balance: number } }
      expect(result.ok).toBe(true)
      expect(result.data?.balance).toBe(20000)
    })

    it('reduce el saldo al registrar pago de deuda', () => {
      const expenseHandler = getHandler('ipc:register-expense')
      expenseHandler(null, { provider: 'Prov Y', amount: 80000, newDebtAmount: 20000 })
      expenseHandler(null, { provider: 'Prov Y', amount: 140000, paysOldDebt: 20000 })

      const pid = providerIdFromName('Prov Y')
      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { providerId: pid }) as { ok: boolean; data: { balance: number } }
      expect(result.ok).toBe(true)
      expect(result.data?.balance).toBe(0)
    })

    it('rechaza payload inválido — providerId vacío', () => {
      const handler = getHandler('ipc:get-provider-debt')
      const result = handler(null, { providerId: '' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('GET_PROVIDER_NAMES (ipc:get-provider-names)', () => {
    it('devuelve lista vacía si no hay proveedores en cache', () => {
      const handler = getHandler('ipc:get-provider-names')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('devuelve los proveedores del cache local (creados al registrar gastos)', () => {
      const expenseHandler = getHandler('ipc:register-expense')
      expenseHandler(null, { provider: 'Carnicero Pedro', amount: 5000 })

      const handler = getHandler('ipc:get-provider-names')
      const result = handler(null) as { ok: boolean; data: string[] }
      expect(result.ok).toBe(true)
      expect(result.data).toContain('Carnicero Pedro')
    })
  })
})
