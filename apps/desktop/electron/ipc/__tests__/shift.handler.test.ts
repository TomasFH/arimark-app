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

    it('retoma el turno propio (resumed=true) si el mismo usuario ya tenía uno abierto', () => {
      // Si la PC se reinició o la sesión se cerró sin cerrar turno, al volver a intentar
      // abrir, el handler detecta que es el mismo usuario y retoma sin error.
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT) // user-001
      const existingShift = {
        id: 'existing-shift',
        userId: 'user-001', // mismo que SESSION_NO_SHIFT
        storeId: 'store-001',
        shiftType: 'morning',
        startedAt: '2026-01-01T08:00:00.000Z',
        openingCash: 500,
      }
      const mockAll = vi.fn().mockReturnValue([existingShift])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 }) as { ok: boolean; data: { id: string; resumed?: boolean } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBe('existing-shift')
      expect(result.data.resumed).toBe(true)
      expect(updateActiveShift).toHaveBeenCalledWith('existing-shift')
      expect(startDaemon).toHaveBeenCalledWith(2)
    })

    it('rechaza con SHIFT_ALREADY_OPEN si el turno abierto pertenece a otro usuario', () => {
      // La regla es: un turno abierto de OTRA cajera bloquea la apertura.
      // El handler hace dos queries: una con .limit(1).all() para buscar el turno abierto
      // y otra con .get() para resolver el nombre del dueño del turno.
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT) // user-001
      const mockAll = vi.fn().mockReturnValue([{ id: 'other-shift', userId: 'user-002' }])
      const mockGet = vi.fn().mockReturnValue({ name: 'Cajera 2' })
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
              get: mockGet,
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 })
      expect(result).toMatchObject({ ok: false, code: 'SHIFT_ALREADY_OPEN' })
    })

    it('permite abrir turno cuando el turno anterior está cerrado (no hay turno abierto)', () => {
      // La query filtra por closedAt IS NULL; si todos los turnos anteriores
      // tienen closedAt != null, la DB no los devuelve y la apertura debe funcionar.
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockAll = vi.fn().mockReturnValue([]) // ningún turno abierto
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

      const result = getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 }) as { ok: boolean }
      expect(result.ok).toBe(true)
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

    it('abre turno cuando el turno anterior del local está cerrado (closedAt != null)', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      // El turno anterior existe pero tiene closedAt → la query filtra por isNull(closedAt)
      // → no hay turno abierto → se permite abrir uno nuevo.
      const mockAll = vi.fn().mockReturnValue([]) // query devuelve vacío (el cerrado no cumple el WHERE)
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

      const result = getHandler('ipc:open-shift')({}, { shiftType: 'evening', openingCash: 0 }) as { ok: boolean }
      expect(result.ok).toBe(true)
      expect(mockRun).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // GET_STORE_OPEN_SHIFT
  // ---------------------------------------------------------------------------
  describe('GET_STORE_OPEN_SHIFT', () => {
    it('retorna error si no hay sesión activa', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:get-store-open-shift')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna null si no hay turno abierto en el local', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockAll = vi.fn().mockReturnValue([])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-store-open-shift')({}) as { ok: boolean; data: null }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('retorna userId y shiftId del turno abierto', () => {
      // El handler hace dos queries: una con .limit(1).all() para el turno
      // y otra con .get() para resolver el nombre del usuario dueño.
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockAll = vi.fn().mockReturnValue([{ id: 'shift-abc', userId: 'user-002' }])
      const mockGet = vi.fn().mockReturnValue({ name: 'Cajera 2' })
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
              get: mockGet,
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-store-open-shift')({}) as { ok: boolean; data: { userId: string; shiftId: string; userName: string } }
      expect(result.ok).toBe(true)
      expect(result.data.userId).toBe('user-002')
      expect(result.data.shiftId).toBe('shift-abc')
      expect(result.data.userName).toBe('Cajera 2')
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

  // ---------------------------------------------------------------------------
  // GET_USER_OPEN_SHIFT
  // ---------------------------------------------------------------------------
  describe('GET_USER_OPEN_SHIFT', () => {
    it('retorna error si no hay sesión activa', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:get-user-open-shift')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna null si el usuario no tiene turno abierto', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockAll = vi.fn().mockReturnValue([])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-user-open-shift')({}) as { ok: boolean; data: null }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('retorna el turno abierto del usuario con shiftId, storeId, shiftType y openingCash', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT) // userId = user-001
      const shift = {
        id: 'shift-xyz',
        userId: 'user-001',
        storeId: 'store-002',
        shiftType: 'morning',
        startedAt: '2026-07-26T08:00:00.000Z',
        openingCash: 3000,
        closedAt: null,
        source: 'desktop',
      }
      const mockAll = vi.fn().mockReturnValue([shift])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-user-open-shift')({}) as {
        ok: boolean
        data: { shiftId: string; storeId: string; shiftType: string; openingCash: number }
      }
      expect(result.ok).toBe(true)
      expect(result.data.shiftId).toBe('shift-xyz')
      expect(result.data.storeId).toBe('store-002')
      expect(result.data.shiftType).toBe('morning')
      expect(result.data.openingCash).toBe(3000)
    })

    it('retorna el turno incluso si storeId difiere del de la sesión (cross-local)', () => {
      // session.storeId = store-001, pero el turno abierto puede estar en store-002
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const shift = {
        id: 'shift-abc',
        userId: 'user-001',
        storeId: 'store-002', // local diferente al de la sesión parcial
        shiftType: 'evening',
        startedAt: '2026-07-26T14:00:00.000Z',
        openingCash: 0,
        closedAt: null,
        source: 'desktop',
      }
      const mockAll = vi.fn().mockReturnValue([shift])
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ all: mockAll }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-user-open-shift')({}) as {
        ok: boolean
        data: { shiftId: string; storeId: string }
      }
      expect(result.ok).toBe(true)
      expect(result.data.storeId).toBe('store-002')
    })
  })
})
