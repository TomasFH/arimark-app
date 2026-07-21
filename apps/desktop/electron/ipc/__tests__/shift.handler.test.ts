import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
  updateActiveShift: vi.fn(),
}))

vi.mock('../inactivityDaemon', () => ({
  startDaemon: vi.fn(),
  stopDaemon: vi.fn(),
  dismissWarning: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn().mockReturnValue({ inactivityThresholdHours: 2 }),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession, updateActiveShift } from '../../activeSession'
import { startDaemon, stopDaemon, dismissWarning } from '../inactivityDaemon'
import { registerShiftHandlers } from '../shift.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION_NO_SHIFT = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: null }
const SESSION_WITH_SHIFT = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001' }

describe('shift.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerShiftHandlers()
  })

  // ---------------------------------------------------------------------------
  // GET_ACTIVE_SHIFT
  // ---------------------------------------------------------------------------
  describe('GET_ACTIVE_SHIFT', () => {
    it('retorna error si no hay sesión activa', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:get-active-shift')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna null si no hay turno abierto', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockAll = vi.fn().mockReturnValue([])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({ all: mockAll }),
              }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-active-shift')({}) as { ok: boolean; data: unknown }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('retorna el turno activo si existe e inicia el daemon', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const shift = {
        id: 'shift-001',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: '2026-01-01T08:00:00.000Z',
        openingCash: 500,
        closedAt: null,
      }
      const mockAll = vi.fn().mockReturnValue([shift])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({ all: mockAll }),
              }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-active-shift')({}) as { ok: boolean; data: { id: string } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBe('shift-001')
      expect(startDaemon).toHaveBeenCalledWith(2)
    })
  })

  // ---------------------------------------------------------------------------
  // OPEN_SHIFT
  // ---------------------------------------------------------------------------
  describe('OPEN_SHIFT', () => {
    it('rechaza payload inválido', () => {
      const result = getHandler('ipc:open-shift')({}, { shiftType: 'invalid', openingCash: -10 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza si no hay sesión activa', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 })
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('rechaza si ya existe un turno abierto', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockAll = vi.fn().mockReturnValue([{ id: 'existing-shift' }])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 })
      expect(result).toMatchObject({ ok: false, code: 'SHIFT_ALREADY_OPEN' })
    })

    it('crea un turno, actualiza la sesión activa e inicia el daemon', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockAll = vi.fn().mockReturnValue([])
      const mockRun = vi.fn()
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({ run: mockRun }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 }) as { ok: boolean; data: { openingCash: number } }
      expect(result.ok).toBe(true)
      expect(result.data.openingCash).toBe(500)
      expect(mockRun).toHaveBeenCalledOnce()
      expect(updateActiveShift).toHaveBeenCalledWith(expect.any(String))
      expect(startDaemon).toHaveBeenCalledWith(2)
    })
  })

  // ---------------------------------------------------------------------------
  // GET_SHIFT_SUMMARY
  // ---------------------------------------------------------------------------
  describe('GET_SHIFT_SUMMARY', () => {
    it('retorna error si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:get-shift-summary')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna error si no hay turno activo en sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const result = getHandler('ipc:get-shift-summary')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SHIFT' })
    })

    it('retorna resumen con ventas', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      const shift = {
        id: 'shift-001',
        shiftType: 'morning',
        startedAt: '2026-01-01T08:00:00.000Z',
        openingCash: 1000,
      }
      const mockShiftAll = vi.fn().mockReturnValue([shift])
      const mockSalesAll = vi.fn().mockReturnValue([{ salesCount: 5, totalRevenue: 25000 }])
      const mockCashAll = vi.fn().mockReturnValue([{ totalCash: 15000 }])
      const mockExpensesAll = vi.fn().mockReturnValue([{ totalExpenses: 500 }])

      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({ all: mockShiftAll }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: mockSalesAll }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ all: mockCashAll }),
              }),
            }),
          })
          .mockReturnValueOnce({
            // desglose digital por tipo (groupBy)
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  groupBy: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: mockExpensesAll }),
            }),
          })
          .mockReturnValueOnce({
            // señas del turno (orders donde depositShiftId = shiftId)
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
            }),
          })
          .mockReturnValueOnce({
            // fiados del turno
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([{ debtsCount: 0, totalDebts: null }]) }),
              }),
            }),
          }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-shift-summary')({}) as { ok: boolean; data: { salesCount: number; totalRevenue: number; cashInHand: number } }
      expect(result.ok).toBe(true)
      expect(result.data.salesCount).toBe(5)
      expect(result.data.totalRevenue).toBe(25000)
      // cashInHand = openingCash(1000) + cashSales(15000) - expenses(500) = 15500
      expect(result.data.cashInHand).toBe(15500)
    })

    it('retorna salesCount 0 y totalRevenue 0 si no hay ventas', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      const shift = {
        id: 'shift-001',
        shiftType: 'evening',
        startedAt: '2026-01-01T16:00:00.000Z',
        openingCash: 500,
      }
      const mockShiftAll = vi.fn().mockReturnValue([shift])
      const mockSalesAll = vi.fn().mockReturnValue([{ salesCount: 0, totalRevenue: null }])
      const mockCashAll = vi.fn().mockReturnValue([{ totalCash: null }])
      const mockExpensesAll = vi.fn().mockReturnValue([{ totalExpenses: null }])

      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({ all: mockShiftAll }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: mockSalesAll }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ all: mockCashAll }),
              }),
            }),
          })
          .mockReturnValueOnce({
            // desglose digital por tipo (groupBy)
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  groupBy: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: mockExpensesAll }),
            }),
          })
          .mockReturnValueOnce({
            // señas del turno (orders donde depositShiftId = shiftId)
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
            }),
          })
          .mockReturnValueOnce({
            // fiados del turno
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([{ debtsCount: 0, totalDebts: null }]) }),
              }),
            }),
          }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-shift-summary')({}) as { ok: boolean; data: { salesCount: number; totalRevenue: number } }
      expect(result.ok).toBe(true)
      expect(result.data.salesCount).toBe(0)
      expect(result.data.totalRevenue).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // CLOSE_SHIFT
  // ---------------------------------------------------------------------------
  describe('CLOSE_SHIFT', () => {
    it('rechaza payload inválido', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      const result = getHandler('ipc:close-shift')({}, { closingCash: -1 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:close-shift')({}, {})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('rechaza si no hay turno activo en sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const result = getHandler('ipc:close-shift')({}, { closingCash: 500 })
      expect(result).toMatchObject({ ok: false, code: 'NO_SHIFT' })
    })

    it('cierra el turno con datos de arqueo y detiene el daemon', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      const mockTx = vi.fn(fn => fn({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ run: vi.fn() }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: vi.fn() }) }),
      }))
      vi.mocked(getDb).mockReturnValue({
        transaction: mockTx,
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:close-shift')({}, { closingCash: 1200, safeAmount: 800 })
      expect(result).toMatchObject({ ok: true })
      expect(mockTx).toHaveBeenCalledOnce()
      expect(updateActiveShift).toHaveBeenCalledWith(null)
      expect(stopDaemon).toHaveBeenCalledOnce()
    })

    it('cierra el turno automáticamente sin datos de caja (auto-close por inactividad)', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      const mockTx = vi.fn(fn => fn({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ run: vi.fn() }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: vi.fn() }) }),
      }))
      vi.mocked(getDb).mockReturnValue({
        transaction: mockTx,
      } as unknown as ReturnType<typeof getDb>)

      // Payload vacío = auto-close
      const result = getHandler('ipc:close-shift')({}, {})
      expect(result).toMatchObject({ ok: true })
      expect(mockTx).toHaveBeenCalledOnce()
      expect(stopDaemon).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // DISMISS_INACTIVITY_WARNING
  // ---------------------------------------------------------------------------
  describe('DISMISS_INACTIVITY_WARNING', () => {
    it('llama dismissWarning y retorna ok', () => {
      const result = getHandler('ipc:dismiss-inactivity-warning')({})
      expect(result).toMatchObject({ ok: true })
      expect(dismissWarning).toHaveBeenCalledOnce()
    })
  })
})
