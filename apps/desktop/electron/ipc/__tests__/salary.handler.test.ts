import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, employees, shifts, expenses, salaryPayments } from '../../db/schema'
import { eq, sum } from 'drizzle-orm'

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
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-tenant' })),
}))

vi.mock('../../licensing/expenseSync', () => ({
  pushUnsyncedExpenses: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/employeeSync', () => ({
  pushUnsyncedSalaryPayments: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/salaryFirestore', () => ({
  fetchSalaryPaymentsByWeekStart: vi.fn().mockResolvedValue([]),
  fetchValesInPaidAtRange: vi.fn().mockResolvedValue([]),
  firestorePaidAtBounds: (weekStart: string, weekEnd: string) => ({
    from: `${weekStart}T00:00:00.000Z`,
    to: `${weekEnd}T23:59:59.999Z`,
  }),
}))

vi.mock('../../../src/lib/datetime', () => ({
  weekStartMondayLocalYmd: () => '2026-07-27',
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerSalaryHandlers } from '../salary.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SHIFT_ID = 'shift-001'
const EMP_ID = 'emp-001'
const WEEK = '2026-07-27'

const SESSION = {
  userId: 'user-001',
  storeId: 'store-001',
  role: 'cashier' as const,
  shiftId: SHIFT_ID,
}

describe('salary.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db

    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()
    db.insert(employees).values({
      id: EMP_ID,
      name: 'Carnicero Pago',
      weeklyWage: 100000,
      active: true,
      createdAt: now,
    }).run()
    db.insert(shifts).values({
      id: SHIFT_ID,
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 200000,
      source: 'desktop',
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)

    registerSalaryHandlers()
  })

  describe('PAY_WEEKLY_SALARY', () => {
    it('registra pago y gasto por el neto (amount - vales)', () => {
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 100000,
        valesDeducted: 25000,
      }) as {
        ok: boolean
        data: { netPaid: number; amount: number; valesDeducted: number }
      }

      expect(res.ok).toBe(true)
      expect(res.data.amount).toBe(100000)
      expect(res.data.valesDeducted).toBe(25000)
      expect(res.data.netPaid).toBe(75000)

      const [exp] = db
        .select({ total: sum(expenses.amount) })
        .from(expenses)
        .where(eq(expenses.shiftId, SHIFT_ID))
        .all()
      expect(Number(exp?.total ?? 0)).toBe(75000)

      const payments = db.select().from(salaryPayments).all()
      expect(payments).toHaveLength(1)
      expect(payments[0]?.weekStart).toBe(WEEK)
      expect(payments[0]?.notes).toBeNull()
    })

    it('guarda nota y snapshot de vales', () => {
      const snapshot = [
        { id: 'vale-1', amount: 25000, description: 'adelanto', paidAt: '2026-07-29T12:00:00.000Z' },
      ]
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 100000,
        valesDeducted: 25000,
        notes: '  Llegó tarde 2 veces  ',
        valesSnapshot: snapshot,
      }) as { ok: boolean; data: { notes: string | null; valesSnapshot: typeof snapshot } }

      expect(res.ok).toBe(true)
      expect(res.data.notes).toBe('Llegó tarde 2 veces')
      expect(res.data.valesSnapshot).toEqual([
        { id: 'vale-1', amount: 25000, description: 'adelanto', paidAt: '2026-07-29T12:00:00.000Z' },
      ])
      const [row] = db.select().from(salaryPayments).all()
      expect(row?.notes).toBe('Llegó tarde 2 veces')
      expect(JSON.parse(row?.valesSnapshot ?? 'null')).toEqual(res.data.valesSnapshot)
    })

    it('rechaza snapshot cuya suma no coincide', () => {
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 100000,
        valesDeducted: 25000,
        valesSnapshot: [
          { id: 'vale-1', amount: 1000, description: 'x', paidAt: '2026-07-29T12:00:00.000Z' },
        ],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('sin neto no crea gasto pero sí registra el pago', () => {
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 10000,
        valesDeducted: 10000,
      }) as { ok: boolean; data: { netPaid: number } }

      expect(res.ok).toBe(true)
      expect(res.data.netPaid).toBe(0)
      expect(db.select().from(expenses).all()).toHaveLength(0)
      expect(db.select().from(salaryPayments).all()).toHaveLength(1)
    })

    it('rechaza duplicado de la misma semana', () => {
      getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 100000,
        valesDeducted: 0,
      })
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 100000,
        valesDeducted: 0,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza pagar una semana que no es la en curso', () => {
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: '2026-07-20',
        amount: 100000,
        valesDeducted: 0,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('CONFLICT')
    })

    it('rechaza sin turno', () => {
      vi.mocked(getActiveSession).mockReturnValue({
        ...SESSION,
        shiftId: null,
      } as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 1000,
        valesDeducted: 0,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SHIFT')
    })

    it('rechaza vales mayores al monto', () => {
      const res = getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 1000,
        valesDeducted: 2000,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('LIST_SALARY_PAYMENTS', () => {
    it('lista pagos de la semana', () => {
      getHandler('ipc:pay-weekly-salary')(null, {
        employeeId: EMP_ID,
        weekStart: WEEK,
        amount: 100000,
        valesDeducted: 0,
      })
      const res = getHandler('ipc:list-salary-payments')(null, { weekStart: WEEK }) as {
        ok: boolean
        data: Array<{ employeeId: string; netPaid: number }>
      }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(1)
      expect(res.data[0]?.employeeId).toBe(EMP_ID)
      expect(res.data[0]?.netPaid).toBe(100000)
    })

    it('rechaza payload malformado', () => {
      const res = getHandler('ipc:list-salary-payments')(null, { weekStart: 'lunes' }) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('GET_REMOTE_SALARY_WEEK', () => {
    it('devuelve recorte remoto', async () => {
      const res = await getHandler('ipc:get-remote-salary-week')(null, { weekStart: WEEK }) as {
        ok: boolean
        data: { payments: unknown[]; vales: unknown[] }
      }
      expect(res.ok).toBe(true)
      expect(res.data.payments).toEqual([])
      expect(res.data.vales).toEqual([])
    })
  })
})
