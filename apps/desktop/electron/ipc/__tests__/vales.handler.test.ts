import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, employees, shifts, expenses } from '../../db/schema'
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
  pushUnsyncedVales: vi.fn().mockResolvedValue(undefined),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerValesHandlers } from '../vales.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SHIFT_ID = 'shift-001'
const EMP_ID = 'emp-001'

const SESSION_WITH_SHIFT = {
  userId: 'user-001',
  storeId: 'store-001',
  role: 'cashier' as const,
  shiftId: SHIFT_ID,
}

const SESSION_NO_SHIFT = {
  userId: 'user-001',
  storeId: 'store-001',
  role: 'cashier' as const,
  shiftId: null,
}

describe('vales.handler', () => {
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
      name: 'Carnicero Vale',
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
      openingCash: 50000,
      source: 'desktop',
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT as ReturnType<typeof getActiveSession>)

    registerValesHandlers()
  })

  describe('REGISTER_VALE', () => {
    it('registra vale y crea gasto que reduce el efectivo del turno', () => {
      const res = getHandler('ipc:register-vale')(null, {
        employeeId: EMP_ID,
        amount: 15000,
        description: 'Adelanto',
      }) as { ok: boolean; data: { id: string; amount: number } }

      expect(res.ok).toBe(true)
      expect(res.data.amount).toBe(15000)

      const [exp] = db
        .select({ total: sum(expenses.amount) })
        .from(expenses)
        .where(eq(expenses.shiftId, SHIFT_ID))
        .all()
      expect(Number(exp?.total ?? 0)).toBe(15000)

      const expenseRow = db.select().from(expenses).where(eq(expenses.shiftId, SHIFT_ID)).all()[0]
      expect(expenseRow?.concept).toContain('Carnicero Vale')
    })

    it('rechaza sin turno abierto', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:register-vale')(null, {
        employeeId: EMP_ID,
        amount: 1000,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SHIFT')
    })

    it('rechaza monto inválido', () => {
      const res = getHandler('ipc:register-vale')(null, {
        employeeId: EMP_ID,
        amount: 0,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza empleado inexistente', () => {
      const res = getHandler('ipc:register-vale')(null, {
        employeeId: 'no-existe',
        amount: 1000,
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })
  })

  describe('LIST_VALES', () => {
    it('lista vales del empleado en el rango', () => {
      getHandler('ipc:register-vale')(null, { employeeId: EMP_ID, amount: 5000 })
      getHandler('ipc:register-vale')(null, { employeeId: EMP_ID, amount: 3000 })

      const today = new Date().toISOString().slice(0, 10)
      const res = getHandler('ipc:list-vales')(null, {
        employeeId: EMP_ID,
        weekStart: today,
        weekEnd: today,
      }) as { ok: boolean; data: { amount: number }[] }

      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(2)
      expect(res.data.reduce((a, v) => a + v.amount, 0)).toBe(8000)
    })
  })

  describe('GET_WEEKLY_VALE_SUMMARY', () => {
    it('calcula totalVales, weeklyWage y netToPay', () => {
      getHandler('ipc:register-vale')(null, { employeeId: EMP_ID, amount: 20000 })
      getHandler('ipc:register-vale')(null, { employeeId: EMP_ID, amount: 10000 })

      // Lunes de la semana actual (UTC aproximado con la fecha de hoy)
      const today = new Date()
      const day = today.getUTCDay() // 0=dom
      const mondayOffset = day === 0 ? -6 : 1 - day
      const monday = new Date(today)
      monday.setUTCDate(today.getUTCDate() + mondayOffset)
      const weekStart = monday.toISOString().slice(0, 10)

      const res = getHandler('ipc:get-weekly-vale-summary')(null, {
        employeeId: EMP_ID,
        weekStart,
      }) as {
        ok: boolean
        data: { totalVales: number; weeklyWage: number; netToPay: number }
      }

      expect(res.ok).toBe(true)
      expect(res.data.totalVales).toBe(30000)
      expect(res.data.weeklyWage).toBe(100000)
      expect(res.data.netToPay).toBe(70000)
    })
  })
})
