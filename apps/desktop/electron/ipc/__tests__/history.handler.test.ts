import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, sales, salePayments, expenses } from '../../db/schema'
import type { HistoryShiftRow, HistoryShiftDetail } from '../../../src/types/hw-api'

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

vi.mock('../../licensing/firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
}))

vi.mock('../../licensing/historyFirestore', () => ({
  fetchHistoryShiftsFromFirestore: vi.fn(async () => []),
  fetchHistoryShiftDetailFromFirestore: vi.fn(async () => null),
  fetchEmployeeValesFromFirestore: vi.fn(async () => []),
  mergeHistoryShiftRows: vi.fn((local: HistoryShiftRow[], remote: HistoryShiftRow[]) => {
    const byId = new Map<string, HistoryShiftRow>()
    for (const r of remote) byId.set(r.id, r)
    for (const l of local) byId.set(l.id, l)
    return Array.from(byId.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { isFirebaseAvailable } from '../../licensing/firebase'
import {
  fetchHistoryShiftsFromFirestore,
  fetchHistoryShiftDetailFromFirestore,
  fetchEmployeeValesFromFirestore,
} from '../../licensing/historyFirestore'
import { registerHistoryHandlers } from '../history.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const STORE_ID = 'store-001'
const USER_ID  = '00000000-0000-0000-0000-000000000001'
const SHIFT_ID = '00000000-0000-0000-0000-000000000002'
const ADMIN_SESSION   = { userId: USER_ID, storeId: STORE_ID, role: 'admin', shiftId: SHIFT_ID }
const CASHIER_SESSION = { userId: USER_ID, storeId: STORE_ID, role: 'cashier', shiftId: SHIFT_ID }

describe('history.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const result = await createInMemoryDb()
    db = result.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as unknown as ReturnType<typeof getActiveSession>)
    registerHistoryHandlers()

    const now = new Date().toISOString()
    db.insert(stores).values({ id: STORE_ID, name: 'Local 1', address: 'Calle 1', createdAt: now }).run()
    db.insert(users).values({ id: USER_ID, storeId: STORE_ID, name: 'Admin', active: true, createdAt: now }).run()
    // Turno cerrado
    db.insert(shifts).values({
      id: SHIFT_ID,
      storeId: STORE_ID,
      userId: USER_ID,
      shiftType: 'morning',
      startedAt: '2026-07-01T08:00:00.000Z',
      closedAt: '2026-07-01T16:00:00.000Z',
      openingCash: 1000,
      source: 'desktop',
    }).run()
  })

  // --------------------------------------------------------------------------
  // GET_HISTORY_SHIFTS
  // --------------------------------------------------------------------------
  describe('GET_HISTORY_SHIFTS', () => {
    it('retorna lista vacía si el admin no tiene turnos en ese período', async () => {
      const handler = getHandler('ipc:get-history-shifts')
      const res = await handler(null, { fromDate: '2030-01-01', toDate: '2030-01-31' }) as { ok: boolean; data: unknown[] }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(0)
    })

    it('rechaza si el rol es cajera', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:get-history-shifts')
      const res = await handler(null) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })

    it('rechaza si no hay sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:get-history-shifts')
      const res = await handler(null) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('retorna el turno cerrado del local', async () => {
      const handler = getHandler('ipc:get-history-shifts')
      const res = await handler(null) as { ok: boolean; data: { id: string; shiftType: string; cashierName: string }[] }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(1)
      expect(res.data[0].id).toBe(SHIFT_ID)
      expect(res.data[0].shiftType).toBe('morning')
      expect(res.data[0].cashierName).toBe('Admin')
    })

    it('rechaza payload inválido', async () => {
      const handler = getHandler('ipc:get-history-shifts')
      const res = await handler(null, { fromDate: 'no-es-fecha' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('fusiona turnos remotos cuando Firebase está disponible', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const remoteId = '00000000-0000-0000-0000-0000000000aa'
      vi.mocked(fetchHistoryShiftsFromFirestore).mockResolvedValue([
        {
          id: remoteId,
          shiftType: 'evening',
          startedAt: '2026-06-01T08:00:00.000Z',
          closedAt: '2026-06-01T16:00:00.000Z',
          cashierName: 'uid-remoto',
          salesCount: 2,
          totalRevenue: 9000,
          totalCashSales: 4000,
          totalExpenses: 100,
          cashInHand: 4900,
          totalDeposits: 0,
        },
      ])

      const handler = getHandler('ipc:get-history-shifts')
      const res = await handler(null) as { ok: boolean; data: { id: string }[] }
      expect(res.ok).toBe(true)
      expect(res.data.map(r => r.id)).toEqual([remoteId, SHIFT_ID])
      expect(fetchHistoryShiftsFromFirestore).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // GET_HISTORY_SHIFT_DETAIL
  // --------------------------------------------------------------------------
  describe('GET_HISTORY_SHIFT_DETAIL', () => {
    it('rechaza si el rol es cajera', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:get-history-shift-detail')
      const res = await handler(null, { shiftId: SHIFT_ID }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })

    it('rechaza payload inválido', async () => {
      const handler = getHandler('ipc:get-history-shift-detail')
      const res = await handler(null, { shiftId: 'no-es-uuid' }) as { ok: boolean }
      expect(res.ok).toBe(false)
    })

    it('retorna 404 para turno inexistente', async () => {
      const handler = getHandler('ipc:get-history-shift-detail')
      const res = await handler(null, { shiftId: '00000000-0000-0000-0000-000000000099' }) as { ok: boolean; code: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })

    it('lee detalle desde Firestore si no está en SQLite', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const remoteShiftId = '00000000-0000-0000-0000-000000000099'
      const remoteDetail: HistoryShiftDetail = {
        shift: {
          id: remoteShiftId,
          shiftType: 'morning',
          startedAt: '2026-07-01T08:00:00.000Z',
          closedAt: '2026-07-01T16:00:00.000Z',
          cashierName: 'uid-remoto',
          openingCash: 500,
          closingCash: 800,
          deliveredAmount: 800,
          deliveredTo: 'Admin',
          notes: null,
        },
        sales: [],
        expenses: [],
        debts: [],
        deposits: [],
        summary: {
          salesCount: 0,
          totalRevenue: 0,
          totalCashSales: 0,
          totalDebitSales: 0,
          totalWalletSales: 0,
          totalCreditSales: 0,
          totalExpenses: 0,
          cashDeposits: 0,
          digitalDeposits: 0,
          cashInHand: 500,
          debtsCount: 0,
          totalDebts: 0,
        },
      }
      vi.mocked(fetchHistoryShiftDetailFromFirestore).mockResolvedValue(remoteDetail)

      const handler = getHandler('ipc:get-history-shift-detail')
      const res = await handler(null, { shiftId: remoteShiftId }) as {
        ok: boolean
        data: HistoryShiftDetail
      }
      expect(res.ok).toBe(true)
      expect(res.data.shift.id).toBe(remoteShiftId)
      expect(fetchHistoryShiftDetailFromFirestore).toHaveBeenCalledWith(remoteShiftId)
    })

    it('retorna el detalle de un turno de otro local (cross-store)', async () => {
      const OTHER_STORE_ID = 'store-002'
      const OTHER_SHIFT_ID = '00000000-0000-0000-0000-000000000003'
      const now = new Date().toISOString()
      db.insert(stores).values({ id: OTHER_STORE_ID, name: 'Local 2', address: 'Calle 2', createdAt: now }).run()
      db.insert(shifts).values({
        id: OTHER_SHIFT_ID,
        storeId: OTHER_STORE_ID,
        userId: USER_ID,
        shiftType: 'evening',
        startedAt: '2026-07-01T14:00:00.000Z',
        closedAt: '2026-07-01T22:00:00.000Z',
        openingCash: 500,
        source: 'desktop',
      }).run()

      const handler = getHandler('ipc:get-history-shift-detail')
      const res = await handler(null, { shiftId: OTHER_SHIFT_ID }) as {
        ok: boolean
        data: { shift: { id: string; shiftType: string } }
      }
      expect(res.ok).toBe(true)
      expect(res.data.shift.id).toBe(OTHER_SHIFT_ID)
      expect(res.data.shift.shiftType).toBe('evening')
    })

    it('retorna detalle completo del turno', async () => {
      const handler = getHandler('ipc:get-history-shift-detail')
      const res = await handler(null, { shiftId: SHIFT_ID }) as {
        ok: boolean
        data: {
          shift: { id: string; cashierName: string }
          sales: unknown[]
          expenses: unknown[]
          debts: unknown[]
          deposits: unknown[]
          summary: { salesCount: number; cashInHand: number }
        }
      }
      expect(res.ok).toBe(true)
      expect(res.data.shift.id).toBe(SHIFT_ID)
      expect(res.data.shift.cashierName).toBe('Admin')
      expect(res.data.sales).toHaveLength(0)
      expect(res.data.expenses).toHaveLength(0)
      expect(res.data.deposits).toHaveLength(0)
      expect(res.data.summary.salesCount).toBe(0)
      expect(res.data.summary.cashInHand).toBe(1000)
    })

    it('incluye ventas y gastos del turno en el detalle', async () => {
      const now = '2026-07-01T10:00:00.000Z'
      const saleId = '11111111-0000-0000-0000-000000000001'
      db.insert(sales).values({
        id: saleId,
        storeId: STORE_ID,
        shiftId: SHIFT_ID,
        total: 5000,
        isDebt: false,
        status: 'confirmed',
        manualEntry: false,
        createdAt: now,
        createdBy: USER_ID,
      }).run()
      db.insert(salePayments).values({
        id: '22222222-0000-0000-0000-000000000001',
        saleId,
        paymentMethod: 'cash',
        amount: 5000,
        createdAt: now,
        createdBy: USER_ID,
      }).run()
      db.insert(expenses).values({
        id: '33333333-0000-0000-0000-000000000001',
        storeId: STORE_ID,
        shiftId: SHIFT_ID,
        concept: 'Limpieza',
        amount: 200,
        createdAt: now,
        createdBy: USER_ID,
      }).run()

      const handler = getHandler('ipc:get-history-shift-detail')
      const res = await handler(null, { shiftId: SHIFT_ID }) as {
        ok: boolean
        data: {
          sales: { total: number }[]
          expenses: { amount: number }[]
          summary: { totalRevenue: number; totalExpenses: number; cashInHand: number }
        }
      }
      expect(res.ok).toBe(true)
      expect(res.data.sales).toHaveLength(1)
      expect(res.data.sales[0].total).toBe(5000)
      expect(res.data.expenses).toHaveLength(1)
      expect(res.data.expenses[0].amount).toBe(200)
      expect(res.data.summary.cashInHand).toBe(5800)
      expect(res.data.summary.totalRevenue).toBe(5000)
      expect(res.data.summary.totalExpenses).toBe(200)
    })
  })

  describe('GET_REMOTE_EMPLOYEE_VALES', () => {
    it('rechaza cajera con FORBIDDEN', async () => {
      vi.mocked(getActiveSession).mockReturnValue(
        CASHIER_SESSION as unknown as ReturnType<typeof getActiveSession>,
      )
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const handler = getHandler('ipc:get-remote-employee-vales')
      const res = await handler(null, {}) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('FORBIDDEN')
    })

    it('payload inválido → INVALID_PAYLOAD', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      const handler = getHandler('ipc:get-remote-employee-vales')
      const res = await handler(null, { storeIdFilter: 123 }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('sin Firebase → UNAVAILABLE', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(false)
      const handler = getHandler('ipc:get-remote-employee-vales')
      const res = await handler(null, {}) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('UNAVAILABLE')
    })

    it('admin con Firebase → lista de vales', async () => {
      vi.mocked(isFirebaseAvailable).mockReturnValue(true)
      vi.mocked(fetchEmployeeValesFromFirestore).mockResolvedValue([
        {
          id: 'vale-1',
          employeeId: 'emp-1',
          employeeName: 'Carnicero',
          storeId: STORE_ID,
          shiftId: SHIFT_ID,
          amount: 1500,
          description: 'adelanto',
          items: [],
          paidAt: '2026-08-03T12:00:00.000Z',
          createdAt: '2026-08-03T12:00:00.000Z',
        },
      ])
      const handler = getHandler('ipc:get-remote-employee-vales')
      const res = await handler(null, { storeIdFilter: STORE_ID }) as {
        ok: boolean
        data: { id: string; amount: number }[]
      }
      expect(res.ok).toBe(true)
      expect(res.data).toHaveLength(1)
      expect(res.data[0].amount).toBe(1500)
      expect(fetchEmployeeValesFromFirestore).toHaveBeenCalledWith(STORE_ID)
    })
  })
})
