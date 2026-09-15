import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  net: { isOnline: vi.fn(() => true) },
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
  getBusinessConfig: vi.fn().mockReturnValue({ inactivityThresholdHours: 2, tenant_id: 'test-tenant' }),
}))

const { mockPushUnsyncedShifts, mockReconcileStoreShifts, mockLoadCashHandoverForStore } = vi.hoisted(() => ({
  mockPushUnsyncedShifts: vi.fn().mockResolvedValue(undefined),
  mockReconcileStoreShifts: vi.fn().mockResolvedValue(undefined),
  mockLoadCashHandoverForStore: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../licensing/shiftSync', () => ({
  pushUnsyncedShifts: mockPushUnsyncedShifts,
  reconcileStoreShifts: mockReconcileStoreShifts,
  loadCashHandoverForStore: mockLoadCashHandoverForStore,
}))

import { ipcMain, net } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession, updateActiveShift } from '../../activeSession'
import { startDaemon, stopDaemon, dismissWarning } from '../inactivityDaemon'
import { registerShiftHandlers } from '../shift.handler'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, shifts, expenses, sales, salePayments, billDenominations } from '../../db/schema'
import { eq } from 'drizzle-orm'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

function shiftQueryChain(allRows: unknown[], getRow: unknown = undefined) {
  return {
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(allRows) }),
    }),
    limit: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(allRows) }),
    get: vi.fn().mockReturnValue(getRow),
  }
}

/** Mock de DB para OPEN_SHIFT: el handler inserta el turno dentro de `transaction`. */
function mockOpenShiftInsertDb(mockRun: ReturnType<typeof vi.fn>) {
  const tx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ run: mockRun }),
    }),
  }
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(shiftQueryChain([])),
      }),
    }),
    transaction: vi.fn().mockImplementation((cb: (t: typeof tx) => void) => cb(tx)),
  }
}

const SESSION_NO_SHIFT = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: null }
const SESSION_WITH_SHIFT = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001' }
const SESSION_ADMIN = { userId: 'admin-001', storeId: 'store-001', role: 'admin' as const, shiftId: null }

describe('shift.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(net.isOnline).mockReturnValue(true)
    registerShiftHandlers()
  })

  // ---------------------------------------------------------------------------
  // GET_ACTIVE_SHIFT
  // ---------------------------------------------------------------------------
  describe('GET_ACTIVE_SHIFT', () => {
    it('retorna error si no hay sesión activa', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:get-active-shift')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna null si no hay turno abierto', async () => {
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

      const result = await getHandler('ipc:get-active-shift')({}) as { ok: boolean; data: unknown }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('retorna el turno activo si existe e inicia el daemon', async () => {
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

      const result = await getHandler('ipc:get-active-shift')({}) as { ok: boolean; data: { id: string } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBe('shift-001')
      expect(startDaemon).toHaveBeenCalledWith(2)
      expect(updateActiveShift).toHaveBeenCalledWith('shift-001')
    })

    it('omite reconcileStoreShifts si no hay red', async () => {
      vi.mocked(net.isOnline).mockReturnValue(false)
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

      await getHandler('ipc:get-active-shift')({})
      expect(mockReconcileStoreShifts).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // OPEN_SHIFT
  // ---------------------------------------------------------------------------
  describe('OPEN_SHIFT', () => {
    it('rechaza payload inválido', async () => {
      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'invalid', openingCash: -10 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza si no hay sesión activa', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 })
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retoma el turno propio (resumed=true) si el mismo usuario ya tenía uno abierto', async () => {
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
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain([existingShift])),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 }) as { ok: boolean; data: { id: string; resumed?: boolean } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBe('existing-shift')
      expect(result.data.resumed).toBe(true)
      expect(updateActiveShift).toHaveBeenCalledWith('existing-shift')
      expect(startDaemon).toHaveBeenCalledWith(2)
    })

    it('en producción retoma el turno propio sin exigir conteo de billetes', async () => {
      const prev = process.env['APP_ENV']
      process.env['APP_ENV'] = 'production'
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const existingShift = {
        id: 'existing-shift',
        userId: 'user-001',
        storeId: 'store-001',
        shiftType: 'morning',
        startedAt: '2026-01-01T08:00:00.000Z',
        openingCash: 500,
      }
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain([existingShift])),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 0 }) as {
        ok: boolean
        data?: { resumed?: boolean }
        code?: string
      }
      process.env['APP_ENV'] = prev
      expect(result.ok).toBe(true)
      expect(result.data?.resumed).toBe(true)
      expect(result.code).not.toBe('BILLS_REQUIRED')
    })

    it('rechaza con SHIFT_ALREADY_OPEN si el turno abierto pertenece a otro usuario', async () => {
      // La regla es: un turno abierto de OTRA cajera bloquea la apertura.
      // El handler hace dos queries: una con .limit(1).all() para buscar el turno abierto
      // y otra con .get() para resolver el nombre del dueño del turno.
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT) // user-001
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain(
              [{ id: 'other-shift', userId: 'user-002' }],
              { name: 'Cajera 2' },
            )),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 })
      expect(result).toMatchObject({ ok: false, code: 'SHIFT_ALREADY_OPEN' })
    })

    it('permite abrir turno cuando el turno anterior está cerrado (no hay turno abierto)', async () => {
      // La query filtra por closedAt IS NULL; si todos los turnos anteriores
      // tienen closedAt != null, la DB no los devuelve y la apertura debe funcionar.
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockRun = vi.fn()
      vi.mocked(getDb).mockReturnValue(mockOpenShiftInsertDb(mockRun) as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 }) as { ok: boolean }
      expect(result.ok).toBe(true)
    })

    it('crea un turno, actualiza la sesión activa e inicia el daemon', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const mockRun = vi.fn()
      vi.mocked(getDb).mockReturnValue(mockOpenShiftInsertDb(mockRun) as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 500 }) as { ok: boolean; data: { openingCash: number } }
      expect(result.ok).toBe(true)
      expect(result.data.openingCash).toBe(500)
      expect(mockRun).toHaveBeenCalledOnce()
      expect(updateActiveShift).toHaveBeenCalledWith(expect.any(String))
      expect(startDaemon).toHaveBeenCalledWith(2)
      expect(mockPushUnsyncedShifts).toHaveBeenCalledWith('test-tenant')
    })

    it('abre turno cuando el turno anterior del local está cerrado (closedAt != null)', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      // El turno anterior existe pero tiene closedAt → la query filtra por isNull(closedAt)
      // → no hay turno abierto → se permite abrir uno nuevo.
      const mockRun = vi.fn()
      vi.mocked(getDb).mockReturnValue(mockOpenShiftInsertDb(mockRun) as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'evening', openingCash: 0 }) as { ok: boolean }
      expect(result.ok).toBe(true)
      expect(mockRun).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // GET_STORE_OPEN_SHIFT
  // ---------------------------------------------------------------------------
  describe('GET_STORE_OPEN_SHIFT', () => {
    it('retorna error si no hay sesión activa', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:get-store-open-shift')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna null si no hay turno abierto en el local', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain([])),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:get-store-open-shift')({}) as { ok: boolean; data: null }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('retorna userId y shiftId del turno abierto', async () => {
      // El handler hace dos queries: una con .limit(1).all() para el turno
      // y otra con .get() para resolver el nombre del usuario dueño.
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain(
              [{ id: 'shift-abc', userId: 'user-002' }],
              { name: 'Cajera 2' },
            )),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:get-store-open-shift')({}) as { ok: boolean; data: { userId: string; shiftId: string; userName: string } }
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
    it('retorna error si no hay sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:get-shift-summary')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna error si no hay turno activo en sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const result = getHandler('ipc:get-shift-summary')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SHIFT' })
    })

    it('retorna resumen con ventas', async () => {
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
            // cobranzas de fiado en efectivo
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
      // cashInHand = openingCash(1000) + cashSales(15000) + injects(0) - expenses(500) = 15500
      expect(result.data.cashInHand).toBe(15500)
    })

    it('retorna salesCount 0 y totalRevenue 0 si no hay ventas', async () => {
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
            // cobranzas de fiado en efectivo
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

    it('cashInHand suma aportes y resta solo gastos (DB real)', async () => {
      const instance = await createInMemoryDb()
      const db = instance.db
      const now = new Date().toISOString()

      db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
      db.insert(users).values({
        id: 'user-001',
        name: 'Cajera Test',
        storeId: 'store-001',
        role: 'cashier',
        active: true,
        createdAt: now,
      }).run()
      db.insert(shifts).values({
        id: 'shift-001',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 1000,
        source: 'desktop',
      }).run()
      db.insert(expenses).values([
        {
          id: 'exp-gasto',
          storeId: 'store-001',
          shiftId: 'shift-001',
          kind: 'expense',
          concept: 'Insumos',
          amount: 500,
          createdAt: now,
          createdBy: 'user-001',
        },
        {
          id: 'exp-aporte',
          storeId: 'store-001',
          shiftId: 'shift-001',
          kind: 'inject',
          concept: 'Aporte',
          amount: 2000,
          createdAt: now,
          createdBy: 'user-001',
        },
      ]).run()

      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-shift-summary')({}) as {
        ok: boolean
        data: { cashInHand: number; totalExpenses: number; totalCashInjects: number }
      }
      expect(result.ok).toBe(true)
      expect(result.data.totalExpenses).toBe(500)
      expect(result.data.totalCashInjects).toBe(2000)
      // opening(1000) + cash(0) + injects(2000) - expenses(500) = 2500
      expect(result.data.cashInHand).toBe(2500)
    })

    it('caja ignora ventas anuladas y suma aportes (DB real)', async () => {
      const instance = await createInMemoryDb()
      const db = instance.db
      const now = new Date().toISOString()

      db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
      db.insert(users).values({
        id: 'user-001',
        name: 'Cajera Test',
        storeId: 'store-001',
        role: 'cashier',
        active: true,
        createdAt: now,
      }).run()
      db.insert(shifts).values({
        id: 'shift-001',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 1000,
        source: 'desktop',
      }).run()
      db.insert(sales).values([
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          storeId: 'store-001',
          shiftId: 'shift-001',
          total: 5000,
          status: 'confirmed',
          isDebt: false,
          createdAt: now,
          createdBy: 'user-001',
        },
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
          storeId: 'store-001',
          shiftId: 'shift-001',
          total: 9000,
          status: 'cancelled',
          isDebt: false,
          createdAt: now,
          createdBy: 'user-001',
        },
      ]).run()
      db.insert(salePayments).values([
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          saleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          paymentMethod: 'cash',
          amount: 5000,
          createdAt: now,
          createdBy: 'user-001',
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
          saleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
          paymentMethod: 'cash',
          amount: 9000,
          createdAt: now,
          createdBy: 'user-001',
        },
      ]).run()
      db.insert(expenses).values({
        id: 'exp-inj-only',
        storeId: 'store-001',
        shiftId: 'shift-001',
        kind: 'inject',
        concept: 'Aporte',
        amount: 2000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()

      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

      const result = getHandler('ipc:get-shift-summary')({}) as {
        ok: boolean
        data: { salesCount: number; totalRevenue: number; cashInHand: number; totalCashInjects: number }
      }
      expect(result.ok).toBe(true)
      expect(Number(result.data.salesCount)).toBe(1)
      expect(Number(result.data.totalRevenue)).toBe(5000)
      expect(Number(result.data.totalCashInjects)).toBe(2000)
      // opening(1000) + cash confirmado(5000) + inject(2000) — la anulada no suma
      expect(result.data.cashInHand).toBe(8000)
    })
  })

  // ---------------------------------------------------------------------------
  // CLOSE_SHIFT
  // ---------------------------------------------------------------------------
  describe('CLOSE_SHIFT', () => {
    it('rechaza payload inválido', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      const result = getHandler('ipc:close-shift')({}, { closingCash: -1 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza si no hay sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:close-shift')({}, {})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('rechaza si no hay turno activo en sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const result = getHandler('ipc:close-shift')({}, { closingCash: 500 })
      expect(result).toMatchObject({ ok: false, code: 'NO_SHIFT' })
    })

    it('cierra el turno con datos de arqueo y detiene el daemon', async () => {
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
      expect(mockPushUnsyncedShifts).toHaveBeenCalledWith('test-tenant')
      expect(stopDaemon).toHaveBeenCalledOnce()
    })

    it('cierra el turno automáticamente sin datos de caja (auto-close por inactividad)', async () => {
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

  describe('CASH_HANDOVER', () => {
    const prevEnv = process.env['APP_ENV']

    afterEach(() => {
      if (prevEnv === undefined) delete process.env['APP_ENV']
      else process.env['APP_ENV'] = prevEnv
    })

    async function seedShiftDb() {
      const instance = await createInMemoryDb()
      const db = instance.db
      const now = new Date().toISOString()
      db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
      db.insert(users).values({
        id: 'user-001',
        name: 'Cajera Test',
        storeId: 'store-001',
        role: 'cashier',
        active: true,
        createdAt: now,
      }).run()
      db.insert(shifts).values({
        id: 'shift-001',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 1000,
        source: 'desktop',
      }).run()
      return db
    }

    it('persiste el desglose de cierre y no lo pisa al abrir el siguiente', async () => {
      const db = await seedShiftDb()
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

      const closed = getHandler('ipc:close-shift')({}, {
        closingCash: 5000,
        billDenominations: [{ denomination: 1000, quantity: 5 }],
      }) as { ok: boolean }
      expect(closed.ok).toBe(true)

      const closingRows = db.select().from(billDenominations).all()
      expect(closingRows).toHaveLength(1)
      expect(closingRows[0]?.kind).toBe('closing')
      expect(closingRows[0]?.quantity).toBe(5)
      expect(closingRows[0]?.shiftId).toBe('shift-001')

      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const opened = await getHandler('ipc:open-shift')({}, {
        shiftType: 'evening',
        openingCash: 4000,
        openingBillDenominations: [{ denomination: 1000, quantity: 4 }],
        handoverFromShiftId: 'shift-001',
        handoverFromCashierName: 'Cajera Test',
        handoverExpectedBills: [{ denomination: 1000, quantity: 5 }],
      }) as { ok: boolean; data: { id: string } }
      expect(opened.ok).toBe(true)

      const stillClosing = db.select().from(billDenominations).all()
        .filter(r => r.shiftId === 'shift-001')
      expect(stillClosing).toHaveLength(1)
      expect(stillClosing[0]?.quantity).toBe(5)
      expect(stillClosing[0]?.kind).toBe('closing')

      const newRows = db.select().from(billDenominations).all()
        .filter(r => r.shiftId === opened.data.id)
      expect(newRows.filter(r => r.kind === 'opening')[0]?.quantity).toBe(4)
      expect(newRows.filter(r => r.kind === 'expected')[0]?.quantity).toBe(5)

      mockLoadCashHandoverForStore.mockRejectedValueOnce(new Error('offline'))
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const handover = await getHandler('ipc:get-cash-handover')({}) as {
        ok: boolean
        data: { fromShiftId: string; bills: Array<{ quantity: number }> } | null
      }
      expect(handover.ok).toBe(true)
      expect(handover.data?.fromShiftId).toBe('shift-001')
      expect(handover.data?.bills).toEqual([{ denomination: 1000, quantity: 5 }])
    })

    it('en producción rechaza cierre de arqueo sin conteo', async () => {
      process.env['APP_ENV'] = 'production'
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      vi.mocked(getDb).mockReturnValue({
        transaction: vi.fn(),
      } as unknown as ReturnType<typeof getDb>)
      const result = getHandler('ipc:close-shift')({}, { closingCash: 1200 }) as { ok: boolean; code?: string }
      expect(result).toMatchObject({ ok: false, code: 'BILLS_REQUIRED' })
    })

    it('en producción rechaza apertura sin conteo', async () => {
      process.env['APP_ENV'] = 'production'
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      vi.mocked(getDb).mockReturnValue(mockOpenShiftInsertDb(vi.fn()) as unknown as ReturnType<typeof getDb>)
      const result = await getHandler('ipc:open-shift')({}, { shiftType: 'morning', openingCash: 0 }) as { ok: boolean; code?: string }
      expect(result).toMatchObject({ ok: false, code: 'BILLS_REQUIRED' })
    })

    it('en producción pide confirmación si todas las cantidades son 0', async () => {
      process.env['APP_ENV'] = 'production'
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      const result = getHandler('ipc:close-shift')({}, {
        billDenominations: [{ denomination: 1000, quantity: 0 }],
      }) as { ok: boolean; code?: string }
      expect(result).toMatchObject({ ok: false, code: 'EMPTY_BILLS_CONFIRM_REQUIRED' })
    })

    it('en producción cierra con todas en 0 si hay confirmación', async () => {
      process.env['APP_ENV'] = 'production'
      const db = await seedShiftDb()
      vi.mocked(getActiveSession).mockReturnValue(SESSION_WITH_SHIFT)
      vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
      const result = getHandler('ipc:close-shift')({}, {
        billDenominations: [{ denomination: 1000, quantity: 0 }],
        confirmEmptyRegister: true,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)
      const row = db.select().from(shifts).where(eq(shifts.id, 'shift-001')).get()
      expect(row?.closingCounted).toBe(true)
    })

    it('en producción el auto-cierre por inactividad no exige conteo', async () => {
      process.env['APP_ENV'] = 'production'
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
      const result = getHandler('ipc:close-shift')({}, {}) as { ok: boolean }
      expect(result.ok).toBe(true)
      expect(mockTx).toHaveBeenCalledOnce()
    })

    it('GET_CASH_HANDOVER retorna el último cierre del local', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      mockLoadCashHandoverForStore.mockResolvedValueOnce({
        fromShiftId: 'shift-prev',
        fromUserId: 'user-001',
        fromCashierName: 'Cajera Test',
        fromClosedAt: '2026-09-11T16:00:00.000Z',
        bills: [{ denomination: 1000, quantity: 2 }],
        counted: true,
      })
      const result = await getHandler('ipc:get-cash-handover')({}) as {
        ok: boolean
        data: { fromShiftId: string } | null
      }
      expect(result).toMatchObject({ ok: true, data: { fromShiftId: 'shift-prev' } })
    })
  })

  // ---------------------------------------------------------------------------
  // DISMISS_INACTIVITY_WARNING
  // ---------------------------------------------------------------------------
  describe('DISMISS_INACTIVITY_WARNING', () => {
    it('llama dismissWarning y retorna ok', async () => {
      const result = getHandler('ipc:dismiss-inactivity-warning')({})
      expect(result).toMatchObject({ ok: true })
      expect(dismissWarning).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // GET_USER_OPEN_SHIFT
  // ---------------------------------------------------------------------------
  describe('GET_USER_OPEN_SHIFT', () => {
    it('retorna error si no hay sesión activa', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:get-user-open-shift')({})
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('retorna null si el usuario no tiene turno abierto', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain([])),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:get-user-open-shift')({}) as { ok: boolean; data: null }
      expect(result.ok).toBe(true)
      expect(result.data).toBeNull()
    })

    it('retorna el turno abierto del usuario con shiftId, storeId, shiftType y openingCash', async () => {
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
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain([shift])),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:get-user-open-shift')({}) as {
        ok: boolean
        data: { shiftId: string; storeId: string; shiftType: string; openingCash: number }
      }
      expect(result.ok).toBe(true)
      expect(result.data.shiftId).toBe('shift-xyz')
      expect(result.data.storeId).toBe('store-002')
      expect(result.data.shiftType).toBe('morning')
      expect(result.data.openingCash).toBe(3000)
    })

    it('retorna el turno incluso si storeId difiere del de la sesión (cross-local)', async () => {
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
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(shiftQueryChain([shift])),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:get-user-open-shift')({}) as {
        ok: boolean
        data: { shiftId: string; storeId: string }
      }
      expect(result.ok).toBe(true)
      expect(result.data.storeId).toBe('store-002')
    })
  })

  // ---------------------------------------------------------------------------
  // FORCE_CLOSE_OPEN_SHIFT
  // ---------------------------------------------------------------------------
  describe('FORCE_CLOSE_OPEN_SHIFT', () => {
    it('rechaza payload inválido', async () => {
      const result = await getHandler('ipc:force-close-open-shift')({}, {})
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
    })

    it('rechaza si no hay sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:force-close-open-shift')({}, { shiftId: 'shift-1' })
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
    })

    it('rechaza si la sesión no es admin', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_NO_SHIFT)
      const result = await getHandler('ipc:force-close-open-shift')({}, { shiftId: 'shift-1' })
      expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    })

    it('cierra el turno abierto y dispara el push a Firestore', async () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION_ADMIN)
      const mockRun = vi.fn()
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue({
                id: 'shift-1',
                userId: 'user-002',
                closedAt: null,
                notes: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ run: mockRun }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>)

      const result = await getHandler('ipc:force-close-open-shift')({}, { shiftId: 'shift-1' })
      expect(result).toMatchObject({ ok: true })
      expect(mockRun).toHaveBeenCalledOnce()
      expect(mockPushUnsyncedShifts).toHaveBeenCalledWith('test-tenant')
    })
  })
})
