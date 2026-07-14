import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, sales, salePayments, customers, debtEvents } from '../../db/schema'

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
import { registerDebtHandlers } from '../debts.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', shiftId: 'shift-001' }

// UUIDs constantes para el seed base
const SALE_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const CUST_ID = 'bbbbbbbb-0000-0000-0000-000000000001'
const CUST_ID_2 = 'cccccccc-0000-0000-0000-000000000002'
const CUST_DUP_ID = 'dddddddd-0000-0000-0000-000000000003'
const CUST_PAY_ID = 'eeeeeeee-0000-0000-0000-000000000004'
const CUST_NO_DEBT_ID = 'ffffffff-0000-0000-0000-000000000005'
const CUST_LEDGER_ID = '11111111-1111-0000-0000-000000000006'
const SALE_DEBT_ID = '22222222-2222-0000-0000-000000000007'

describe('debts.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    const now = new Date().toISOString()

    db.insert(stores).values({ id: 'store-001', name: 'Local Test', createdAt: now }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera Test', storeId: 'store-001', role: 'cashier', active: true, createdAt: now }).run()
    db.insert(shifts).values({
      id: 'shift-001', storeId: 'store-001', userId: 'user-001',
      shiftType: 'morning', startedAt: now, openingCash: 5000, source: 'desktop',
    }).run()
    db.insert(sales).values({
      id: SALE_ID, storeId: 'store-001', shiftId: 'shift-001',
      total: 15000, status: 'confirmed', isDebt: false, manualEntry: false,
      createdAt: now, createdBy: 'user-001',
    }).run()
    db.insert(salePayments).values({
      id: 'pay-001', saleId: SALE_ID, paymentMethod: 'cash', amount: 15000,
      createdAt: now, createdBy: 'user-001',
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)

    registerDebtHandlers()
  })

  // ---------------------------------------------------------------------------
  // CREATE_DEBT
  // ---------------------------------------------------------------------------

  describe('CREATE_DEBT (ipc:create-debt)', () => {
    it('crea deuda con cliente existente', () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_ID, storeId: 'store-001', name: 'Restaurante Test',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:create-debt')
      const result = handler(null, { saleId: SALE_ID, customerId: CUST_ID }) as {
        ok: boolean; data: { eventType: string; amount: number; customerId: string }
      }
      expect(result.ok).toBe(true)
      expect(result.data.eventType).toBe('created')
      expect(result.data.amount).toBe(15000)
      expect(result.data.customerId).toBe(CUST_ID)
    })

    it('crea deuda con cliente nuevo inline', () => {
      const handler = getHandler('ipc:create-debt')
      const result = handler(null, {
        saleId: SALE_ID,
        newCustomer: { name: 'Cliente Nuevo', dni: '99887766', phone: '11-9999-8888' },
      }) as { ok: boolean; data: { customerName: string } }
      expect(result.ok).toBe(true)
      expect(result.data.customerName).toBe('Cliente Nuevo')
    })

    it('rechaza si ya tiene deuda registrada', () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_DUP_ID, storeId: 'store-001', name: 'Cliente Dup',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      // Insertar venta que ya es deuda
      db.insert(sales).values({
        id: SALE_DEBT_ID, storeId: 'store-001', shiftId: 'shift-001',
        total: 5000, status: 'confirmed', isDebt: true, customerId: CUST_DUP_ID,
        manualEntry: false, createdAt: now, createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:create-debt')
      const result = handler(null, { saleId: SALE_DEBT_ID, customerId: CUST_DUP_ID }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('ALREADY_DEBT')
    })

    it('rechaza venta no encontrada', () => {
      const handler = getHandler('ipc:create-debt')
      const result = handler(null, {
        saleId: '00000000-0000-0000-0000-000000000099',
        newCustomer: { name: 'Test' },
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })

    it('rechaza payload malformado', () => {
      const handler = getHandler('ipc:create-debt')
      const result = handler(null, { saleId: 'invalid-id' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })
  })

  // ---------------------------------------------------------------------------
  // GET_DEBTS
  // ---------------------------------------------------------------------------

  describe('GET_DEBTS (ipc:get-debts)', () => {
    it('retorna lista vacía si no hay deudas', () => {
      const handler = getHandler('ipc:get-debts')
      const result = handler(null) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('retorna deuda activa con saldo correcto', () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_ID, storeId: 'store-001', name: 'Cliente Saldo',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values({
        id: 'de-bal-001', customerId: CUST_ID, saleId: SALE_ID, storeId: 'store-001',
        eventType: 'created', amount: 15000, createdAt: now, createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-debts')
      const result = handler(null) as { ok: boolean; data: Array<{ balance: number; customerName: string }> }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].balance).toBe(15000)
      expect(result.data[0].customerName).toBe('Cliente Saldo')
    })

    it('no incluye clientes con saldo saldado', () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_ID_2, storeId: 'store-001', name: 'Cliente Pagado',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values([
        { id: 'de-p-001', customerId: CUST_ID_2, saleId: SALE_ID, storeId: 'store-001', eventType: 'created', amount: 10000, createdAt: now, createdBy: 'user-001' },
        { id: 'de-p-002', customerId: CUST_ID_2, saleId: null, storeId: 'store-001', eventType: 'paid', amount: -10000, createdAt: now, createdBy: 'user-001' },
      ]).run()

      const handler = getHandler('ipc:get-debts')
      const result = handler(null) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // ADD_DEBT_PAYMENT
  // ---------------------------------------------------------------------------

  describe('ADD_DEBT_PAYMENT (ipc:add-debt-payment)', () => {
    beforeEach(() => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_PAY_ID, storeId: 'store-001', name: 'Cliente Pago',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values({
        id: 'de-pay-001', customerId: CUST_PAY_ID, saleId: SALE_ID, storeId: 'store-001',
        eventType: 'created', amount: 20000, createdAt: now, createdBy: 'user-001',
      }).run()
    })

    it('registra pago parcial', () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = handler(null, { customerId: CUST_PAY_ID, amount: 5000 }) as {
        ok: boolean; data: { eventType: string; amount: number }
      }
      expect(result.ok).toBe(true)
      expect(result.data.eventType).toBe('partial_payment')
      expect(result.data.amount).toBe(-5000)
    })

    it('registra pago total y devuelve eventType=paid', () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = handler(null, { customerId: CUST_PAY_ID, amount: 20000 }) as {
        ok: boolean; data: { eventType: string }
      }
      expect(result.ok).toBe(true)
      expect(result.data.eventType).toBe('paid')
    })

    it('rechaza pago mayor al saldo', () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = handler(null, { customerId: CUST_PAY_ID, amount: 99999 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('OVERPAYMENT')
    })

    it('rechaza si no hay deuda activa', () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_NO_DEBT_ID, storeId: 'store-001', name: 'Sin Deuda',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      const handler = getHandler('ipc:add-debt-payment')
      const result = handler(null, { customerId: CUST_NO_DEBT_ID, amount: 5000 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_DEBT')
    })
  })

  // ---------------------------------------------------------------------------
  // GET_CUSTOMER_BALANCE
  // ---------------------------------------------------------------------------

  describe('GET_CUSTOMER_BALANCE (ipc:get-customer-balance)', () => {
    it('retorna saldo y ledger completo', () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_LEDGER_ID, storeId: 'store-001', name: 'Ledger Test',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values([
        { id: 'de-l-001', customerId: CUST_LEDGER_ID, saleId: SALE_ID, storeId: 'store-001', eventType: 'created', amount: 10000, createdAt: now, createdBy: 'user-001' },
        { id: 'de-l-002', customerId: CUST_LEDGER_ID, saleId: null, storeId: 'store-001', eventType: 'partial_payment', amount: -3000, createdAt: now, createdBy: 'user-001' },
      ]).run()

      const handler = getHandler('ipc:get-customer-balance')
      const result = handler(null, { customerId: CUST_LEDGER_ID }) as {
        ok: boolean; data: { balance: number; events: unknown[] }
      }
      expect(result.ok).toBe(true)
      expect(result.data.balance).toBe(7000)
      expect(result.data.events).toHaveLength(2)
    })

    it('retorna NOT_FOUND para cliente inexistente', () => {
      const handler = getHandler('ipc:get-customer-balance')
      const result = handler(null, { customerId: '00000000-0000-0000-0000-000000000099' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })
  })
})
