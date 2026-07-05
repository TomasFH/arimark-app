import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
  updateActiveShift: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession, updateActiveShift } from '../../activeSession'
import { registerShiftHandlers } from '../shift.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', shiftId: null }

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
      vi.mocked(getActiveSession).mockReturnValue(SESSION)
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

    it('retorna el turno activo si existe', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION)
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
      vi.mocked(getActiveSession).mockReturnValue(SESSION)
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

    it('crea un turno y actualiza la sesión activa', () => {
      vi.mocked(getActiveSession).mockReturnValue(SESSION)
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
      expect(vi.mocked(updateActiveShift)).toHaveBeenCalledWith(expect.any(String))
    })
  })
})
