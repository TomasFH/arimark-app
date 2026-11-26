import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
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

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-key' })),
}))

vi.mock('../../licensing/customerDebtSync', () => ({
  pushUnsyncedCustomerDebtOps: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedCustomers: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
}))

vi.mock('../../licensing/debtBalanceLive', () => ({
  getLiveCustomerPairs: vi.fn(() => []),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerDebtHandlers } from '../debts.handler'
import { pushUnsyncedCustomerDebtOps } from '../../licensing/customerDebtSync'
import { isFirebaseAvailable } from '../../licensing/firebase'
import { getLiveCustomerPairs } from '../../licensing/debtBalanceLive'
import { liveSaldoFromCheckpoint, storeLiveFiadoBalance } from '@carniceria/shared'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001' }

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
    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
    vi.mocked(getLiveCustomerPairs).mockReturnValue([])

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
      const row = db.select().from(debtEvents).all()[0]
      expect(row?.shiftId).toBe('shift-001')
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

    it('registra una venta de fiado y rechaza un segundo evento para la misma venta', () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_DUP_ID, storeId: 'store-001', name: 'Cliente Dup',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      // La venta de fiado se crea primero con isDebt=true y sin evento aún.
      db.insert(sales).values({
        id: SALE_DEBT_ID, storeId: 'store-001', shiftId: 'shift-001',
        total: 5000, status: 'confirmed', isDebt: true, customerId: CUST_DUP_ID,
        manualEntry: false, createdAt: now, createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:create-debt')
      const firstResult = handler(null, { saleId: SALE_DEBT_ID, customerId: CUST_DUP_ID }) as { ok: boolean }
      expect(firstResult.ok).toBe(true)

      const duplicateResult = handler(null, { saleId: SALE_DEBT_ID, customerId: CUST_DUP_ID }) as { ok: boolean; code: string }
      expect(duplicateResult.ok).toBe(false)
      expect(duplicateResult.code).toBe('ALREADY_DEBT')
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
  // CREATE_CUSTOMER_WITH_INITIAL_DEBT
  // ---------------------------------------------------------------------------

  describe('CREATE_CUSTOMER_WITH_INITIAL_DEBT (ipc:create-customer-with-initial-debt)', () => {
    const channel = 'ipc:create-customer-with-initial-debt'

    it('la cajera crea el cliente y la deuda inicial en el local de la sesión', () => {
      const handler = getHandler(channel)
      const result = handler(null, {
        name: '  Juan García  ',
        phone: '11-1234-5678',
        dni: '12345678',
        initialDebt: 15000,
        storeId: 'store-002',
      }) as {
        ok: boolean
        data: {
          customer: { id: string; name: string; storeId: string; phone: string | null; dni: string | null }
          debtEvent: { eventType: string; amount: number; saleId: string | null; storeId: string } | null
        }
      }

      expect(result.ok).toBe(true)
      expect(result.data.customer.name).toBe('Juan García')
      expect(result.data.customer.storeId).toBe('store-001')
      expect(result.data.customer.phone).toBe('11-1234-5678')
      expect(result.data.customer.dni).toBe('12345678')
      expect(result.data.debtEvent?.eventType).toBe('created')
      expect(result.data.debtEvent?.amount).toBe(15000)
      expect(result.data.debtEvent?.saleId).toBeNull()
      expect(result.data.debtEvent?.storeId).toBe('store-001')

      const events = db.select().from(debtEvents).all()
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        customerId: result.data.customer.id,
        saleId: null,
        storeId: 'store-001',
        eventType: 'created',
        amount: 15000,
        shiftId: null,
        syncedAt: null,
        createdBy: 'user-001',
      })
      expect(db.select().from(sales).all()).toHaveLength(1)
      expect(pushUnsyncedCustomerDebtOps).toHaveBeenCalled()
    })

    it('rechaza payload malformado', () => {
      const handler = getHandler(channel)
      const missingName = handler(null, { initialDebt: 1000 }) as { ok: boolean; code: string }
      expect(missingName.ok).toBe(false)
      expect(missingName.code).toBe('VALIDATION_ERROR')

      const existingCustomer = handler(null, {
        name: 'Ana',
        customerId: CUST_ID,
        initialDebt: 1000,
      }) as { ok: boolean; code: string }
      expect(existingCustomer.ok).toBe(false)
      expect(existingCustomer.code).toBe('VALIDATION_ERROR')
      expect(db.select().from(customers).all()).toHaveLength(0)
      expect(db.select().from(debtEvents).all()).toHaveLength(0)
    })

    it('deuda 0 no escribe evento', () => {
      const handler = getHandler(channel)
      const zero = handler(null, { name: 'Sin saldo', initialDebt: 0 }) as { ok: boolean }
      expect(zero.ok).toBe(true)
      expect(db.select().from(customers).all()).toHaveLength(1)
      expect(db.select().from(debtEvents).all()).toHaveLength(0)

      const omitted = handler(null, { name: 'Tampoco' }) as { ok: boolean; data: { debtEvent: unknown } }
      expect(omitted.ok).toBe(true)
      expect(omitted.data.debtEvent).toBeNull()
      expect(db.select().from(debtEvents).all()).toHaveLength(0)
      expect(db.select().from(customers).all()).toHaveLength(2)
    })

    it('sin sesión falla', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler(channel)
      const result = handler(null, { name: 'Ana', initialDebt: 500 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
      expect(db.select().from(customers).all()).toHaveLength(0)
      expect(db.select().from(debtEvents).all()).toHaveLength(0)
    })

    it('rechaza monto no entero o negativo', () => {
      const handler = getHandler(channel)
      const fraction = handler(null, { name: 'Ana', initialDebt: 10.5 }) as { ok: boolean; code: string }
      expect(fraction.ok).toBe(false)
      expect(fraction.code).toBe('VALIDATION_ERROR')

      const negative = handler(null, { name: 'Ana', initialDebt: -100 }) as { ok: boolean; code: string }
      expect(negative.ok).toBe(false)
      expect(negative.code).toBe('VALIDATION_ERROR')
      expect(db.select().from(customers).all()).toHaveLength(0)
      expect(db.select().from(debtEvents).all()).toHaveLength(0)
    })

    it('el admin imputa el alta en el local que está viendo', () => {
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'store-002', name: 'Otro local', createdAt: now }).run()
      vi.mocked(getActiveSession).mockReturnValue({
        userId: 'user-001',
        storeId: 'store-001',
        role: 'admin',
        shiftId: null,
      })

      const handler = getHandler(channel)
      const result = handler(null, {
        name: 'Cliente del otro local',
        initialDebt: 800,
        storeId: 'store-002',
      }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const customer = db.select().from(customers).all()[0]
      const event = db.select().from(debtEvents).all()[0]
      expect(customer?.storeId).toBe('store-002')
      expect(event?.storeId).toBe('store-002')
      expect(event?.saleId).toBeNull()
      expect(event?.amount).toBe(800)
    })
  })

  // ---------------------------------------------------------------------------
  // GET_DEBTS
  // ---------------------------------------------------------------------------

  describe('GET_DEBTS (ipc:get-debts)', () => {
    it('retorna lista vacía si no hay deudas', async () => {
      const handler = getHandler('ipc:get-debts')
      const result = await handler(null) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('retorna deuda activa con saldo correcto', async () => {
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
      const result = await handler(null) as { ok: boolean; data: Array<{ balance: number; customerName: string }> }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].balance).toBe(15000)
      expect(result.data[0].customerName).toBe('Cliente Saldo')
    })

    it('no incluye clientes con saldo saldado', async () => {
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
      const result = await handler(null) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('muestra el saldo a favor y no lo netea con otro local', async () => {
      const now = new Date().toISOString()
      const STORE_2 = 'store-002'
      db.insert(stores).values({ id: STORE_2, name: 'Local 2', createdAt: now }).run()
      db.insert(customers).values({
        id: CUST_ID, storeId: STORE_2, name: 'Tomas Holgado',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values([
        { id: 'de-g-001', customerId: CUST_ID, saleId: SALE_ID, storeId: STORE_2, eventType: 'created', amount: 28000, createdAt: now, createdBy: 'user-001' },
        { id: 'de-g-002', customerId: CUST_ID, saleId: null, storeId: 'store-001', eventType: 'cancelled', amount: -28000, createdAt: now, createdBy: 'user-001' },
      ]).run()

      vi.mocked(getActiveSession).mockReturnValue({
        userId: 'user-001', storeId: 'store-001', role: 'admin', shiftId: undefined,
      } as unknown as ReturnType<typeof getActiveSession>)

      const handler = getHandler('ipc:get-debts')
      const allTab = await handler(null, { storeIdFilter: 'all' }) as { ok: boolean; data: Array<{ storeId: string; balance: number }> }
      const store2Tab = await handler(null, { storeIdFilter: STORE_2 }) as { ok: boolean; data: Array<{ balance: number }> }
      const store1Tab = await handler(null, { storeIdFilter: 'store-001' }) as { ok: boolean; data: Array<{ balance: number }> }
      expect(allTab.data).toHaveLength(2)
      expect(store2Tab.data).toEqual([expect.objectContaining({ balance: 28000 })])
      expect(store1Tab.data).toEqual([expect.objectContaining({ balance: -28000 })])
    })

    it('usa el corte y no vuelve a sumar los cargos que ya plegó', async () => {
      const customerId = 'fb368d55-2126-450b-8ec4-5a2438e6bee7'
      const checkpointAt = {
        seconds: Math.floor(Date.parse('2026-11-20T00:00:00.000Z') / 1000),
        nanos: 0,
      }
      const foldedAt = '2026-11-01T12:00:00.000Z'
      const cancelAt = '2026-11-25T17:30:42.467Z'
      const firstChargeAt = '2026-11-26T15:09:30.832Z'
      const secondChargeAt = '2026-11-26T15:14:57.859Z'
      db.insert(customers).values({
        id: customerId, storeId: 'store-001', name: 'Tomas Deudor',
        active: true, createdAt: foldedAt, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values([
        {
          id: 'plegado-local', customerId, saleId: null, storeId: 'store-001',
          eventType: 'created', amount: 99_999, createdAt: foldedAt, createdBy: 'user-001',
          syncedAt: foldedAt,
        },
        {
          id: 'd4f227c7-c333-4b29-8ecd-dcbf3be0b39b', customerId, saleId: null, storeId: 'store-001',
          eventType: 'cancelled', amount: -99_999, createdAt: cancelAt, createdBy: 'user-001',
          syncedAt: cancelAt,
        },
        {
          id: '7a7dbd75-4bef-405f-9637-3c45e96885af', customerId, saleId: SALE_ID, storeId: 'store-001',
          eventType: 'created', amount: 22_419, createdAt: firstChargeAt, createdBy: 'user-001',
          syncedAt: firstChargeAt,
        },
        {
          id: '878fe8f9-5781-4313-9b56-265b92877329', customerId, saleId: null, storeId: 'store-001',
          eventType: 'created', amount: 50_000, createdAt: secondChargeAt, createdBy: 'user-001',
          syncedAt: secondChargeAt,
        },
      ]).run()

      const pair = {
        customerId,
        storeId: 'store-001',
        checkpoint: {
          kind: 'customer' as const,
          entityId: customerId,
          storeId: 'store-001',
          saldoAcumulado: 99_999,
          checkpointAt,
          foldedCount: 1,
        },
        events: [
          { id: 'd4f227c7-c333-4b29-8ecd-dcbf3be0b39b', serverAt: { seconds: checkpointAt.seconds + 10, nanos: 0 }, customerEventType: 'cancelled', amount: -99_999 },
          { id: '7a7dbd75-4bef-405f-9637-3c45e96885af', serverAt: { seconds: checkpointAt.seconds + 20, nanos: 0 }, customerEventType: 'created', amount: 22_419 },
          { id: '878fe8f9-5781-4313-9b56-265b92877329', serverAt: { seconds: checkpointAt.seconds + 30, nanos: 0 }, customerEventType: 'created', amount: 50_000 },
        ],
      }
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getLiveCustomerPairs).mockReturnValue([pair])

      const result = await getHandler('ipc:get-debts')(null) as {
        ok: boolean
        data: Array<{ balance: number; openingBalance: number; events: Array<{ id: string }> }>
      }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]?.balance).toBe(72_419)
      expect(result.data[0]?.openingBalance).toBe(99_999)
      expect(result.data[0]?.events.map(event => event.id)).not.toContain('plegado-local')
      expect(result.data[0]?.balance).toBe(liveSaldoFromCheckpoint('customer', pair.checkpoint, pair.events))
      expect(storeLiveFiadoBalance('store-001', [pair])).toBe(result.data[0]?.balance)
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

    it('registra pago parcial', async () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = await handler(null, { customerId: CUST_PAY_ID, amount: 5000, paymentMethod: 'cash' }) as {
        ok: boolean; data: { eventType: string; amount: number; paymentMethod: string }
      }
      expect(result.ok).toBe(true)
      expect(result.data.eventType).toBe('partial_payment')
      expect(result.data.amount).toBe(-5000)
      expect(result.data.paymentMethod).toBe('cash')
    })

    it('registra pago total y devuelve eventType=paid', async () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = await handler(null, { customerId: CUST_PAY_ID, amount: 20000, paymentMethod: 'debit' }) as {
        ok: boolean; data: { eventType: string; paymentMethod: string }
      }
      expect(result.ok).toBe(true)
      expect(result.data.eventType).toBe('paid')
      expect(result.data.paymentMethod).toBe('debit')
    })

    it('rechaza pago mayor al saldo', async () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = await handler(null, { customerId: CUST_PAY_ID, amount: 99999, paymentMethod: 'cash' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('OVERPAYMENT')
    })

    it('rechaza si no hay deuda activa', async () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_NO_DEBT_ID, storeId: 'store-001', name: 'Sin Deuda',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      const handler = getHandler('ipc:add-debt-payment')
      const result = await handler(null, { customerId: CUST_NO_DEBT_ID, amount: 5000, paymentMethod: 'cash' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_DEBT')
    })

    it('rechaza payload sin medio de pago', async () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = await handler(null, { customerId: CUST_PAY_ID, amount: 5000 }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('asocia el cobro en efectivo al turno activo', async () => {
      const handler = getHandler('ipc:add-debt-payment')
      const result = await handler(null, { customerId: CUST_PAY_ID, amount: 5000, paymentMethod: 'cash' }) as { ok: boolean }
      expect(result.ok).toBe(true)
      const row = db.select().from(debtEvents).where(eq(debtEvents.eventType, 'partial_payment')).all()[0]
      expect(row?.paymentMethod).toBe('cash')
      expect(row?.shiftId).toBe('shift-001')
    })

    it('cajera sin turno no puede cobrar en efectivo', async () => {
      vi.mocked(getActiveSession).mockReturnValue({
        userId: 'user-001', storeId: 'store-001', role: 'cashier', shiftId: null,
      } as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:add-debt-payment')
      const result = await handler(null, { customerId: CUST_PAY_ID, amount: 5000, paymentMethod: 'cash' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SHIFT')
    })
  })

  // ---------------------------------------------------------------------------
  // GET_CUSTOMER_BALANCE
  // ---------------------------------------------------------------------------

  describe('GET_CUSTOMER_BALANCE (ipc:get-customer-balance)', () => {
    it('retorna saldo y ledger completo', async () => {
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
      const result = await handler(null, { customerId: CUST_LEDGER_ID }) as {
        ok: boolean; data: { balance: number; events: unknown[] }
      }
      expect(result.ok).toBe(true)
      expect(result.data.balance).toBe(7000)
      expect(result.data.events).toHaveLength(2)
    })

    it('retorna NOT_FOUND para cliente inexistente', async () => {
      const handler = getHandler('ipc:get-customer-balance')
      const result = await handler(null, { customerId: '00000000-0000-0000-0000-000000000099' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })
  })

  // ---------------------------------------------------------------------------
  // CANCEL_DEBT
  // ---------------------------------------------------------------------------

  describe('CANCEL_DEBT (ipc:cancel-debt)', () => {
    it('registra un evento negativo que cancela el saldo vigente', async () => {
      const now = new Date().toISOString()
      db.insert(customers).values({
        id: CUST_ID, storeId: 'store-001', name: 'Cliente a cancelar',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values({
        id: 'de-c-001', customerId: CUST_ID, saleId: SALE_ID, storeId: 'store-001',
        eventType: 'created', amount: 15000, createdAt: now, createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:cancel-debt')
      const result = await handler(null, { customerId: CUST_ID, notes: 'Venta anulada' }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const amounts = db.select({ amount: debtEvents.amount }).from(debtEvents)
        .where(eq(debtEvents.customerId, CUST_ID)).all()
      expect(amounts.map(event => event.amount)).toEqual([15000, -15000])
    })

    it('admin desde Todos cancela el saldo en el local donde vive la deuda', async () => {
      const now = new Date().toISOString()
      const STORE_2 = 'store-002'
      db.insert(stores).values({ id: STORE_2, name: 'Local 2', createdAt: now }).run()
      db.insert(customers).values({
        id: CUST_ID, storeId: STORE_2, name: 'Tomas Holgado',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values({
        id: 'de-cross-001', customerId: CUST_ID, saleId: SALE_ID, storeId: STORE_2,
        eventType: 'created', amount: 28000, createdAt: now, createdBy: 'user-001',
      }).run()

      vi.mocked(getActiveSession).mockReturnValue({
        userId: 'user-001', storeId: 'store-001', role: 'admin', shiftId: undefined,
      } as unknown as ReturnType<typeof getActiveSession>)

      const cancel = getHandler('ipc:cancel-debt')
      const cancelled = await cancel(null, { customerId: CUST_ID, storeId: 'all' }) as { ok: boolean }
      expect(cancelled.ok).toBe(true)

      const list = getHandler('ipc:get-debts')
      const allTab = await list(null, { storeIdFilter: 'all' }) as { ok: boolean; data: unknown[] }
      const store2Tab = await list(null, { storeIdFilter: STORE_2 }) as { ok: boolean; data: unknown[] }
      expect(allTab.data).toHaveLength(0)
      expect(store2Tab.data).toHaveLength(0)
    })

    it('cancela el saldo del corte, no la suma de los eventos que quedaron en la PC', async () => {
      const customerId = 'ab0f51f2-824a-4828-ad71-f58e874a2259'
      const now = '2026-11-26T15:14:57.859Z'
      db.insert(customers).values({
        id: customerId, storeId: 'store-001', name: 'Fede Bugarini',
        active: true, createdAt: now, createdBy: 'user-001',
      }).run()
      db.insert(debtEvents).values([
        {
          id: 'cancel-vieja', customerId, saleId: null, storeId: 'store-001',
          eventType: 'cancelled', amount: -221_203, createdAt: '2026-11-25T17:30:42.467Z',
          createdBy: 'user-001', syncedAt: '2026-11-26T12:05:56.450Z',
        },
        {
          id: 'cargo-nuevo', customerId, saleId: SALE_ID, storeId: 'store-001',
          eventType: 'created', amount: 22_419, createdAt: now, createdBy: 'user-001',
          syncedAt: now,
        },
      ]).run()
      const pair = {
        customerId,
        storeId: 'store-001',
        checkpoint: {
          kind: 'customer' as const,
          entityId: customerId,
          storeId: 'store-001',
          saldoAcumulado: 221_203,
          checkpointAt: { seconds: Math.floor(Date.parse('2026-11-20T00:00:00.000Z') / 1000), nanos: 0 },
          foldedCount: 2,
        },
        events: [
          { id: 'cancel-vieja', serverAt: { seconds: Math.floor(Date.parse('2026-11-25T17:30:42.467Z') / 1000), nanos: 0 }, customerEventType: 'cancelled', amount: -221_203 },
          { id: 'cargo-nuevo', serverAt: { seconds: Math.floor(Date.parse(now) / 1000), nanos: 0 }, customerEventType: 'created', amount: 22_419 },
        ],
      }
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(getLiveCustomerPairs).mockReturnValue([pair])

      const cancelled = await getHandler('ipc:cancel-debt')(null, { customerId }) as { ok: boolean }
      expect(cancelled.ok).toBe(true)
      const amounts = db.select({ amount: debtEvents.amount, eventType: debtEvents.eventType }).from(debtEvents)
        .where(eq(debtEvents.customerId, customerId)).all()
      expect(amounts).toContainEqual({ amount: -22_419, eventType: 'cancelled' })
    })
  })

})
