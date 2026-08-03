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
const WEEK = '2026-07-28'

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
})
