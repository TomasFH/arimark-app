import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerHardwareConfigHandlers } from '../hardwareConfig.handler'

const { mockHandle, mockGetSecret, mockSetSecret } =
  vi.hoisted(() => ({
    mockHandle: vi.fn(),
    mockGetSecret: vi.fn(),
    mockSetSecret: vi.fn(),
  }))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('../../secureStorage', () => ({
  getSecret: mockGetSecret,
  setSecret: mockSetSecret,
  SECRET_KEYS: { KRETZ_PORT: 'kretz-port' },
}))

function getHandler(channel: string) {
  const call = mockHandle.mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as (_event: unknown, payload: unknown) => unknown
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getHardwareConfig', () => {
  it('retorna configuración desde secureStorage', () => {
    mockGetSecret.mockImplementation((key: string) => {
      if (key === 'kretz-port') return 'COM3'
      return null
    })

    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:get-hardware-config')
    const result = handler(null, undefined) as { ok: boolean; data: unknown }

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      kretzPort: 'COM3',
    })
  })

  it('retorna campos undefined cuando no hay config guardada', () => {
    mockGetSecret.mockReturnValue(null)

    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:get-hardware-config')
    const result = handler(null, undefined) as { ok: boolean; data: Record<string, unknown> }

    expect(result.ok).toBe(true)
    expect(result.data.kretzPort).toBeUndefined()
  })

  it('rechaza payload no undefined', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:get-hardware-config')
    const result = handler(null, { extra: 'field' }) as { ok: boolean }
    expect(result.ok).toBe(false)
  })
})

describe('setHardwareConfig — zod validation', () => {
  it('rechaza payload vacío (objeto sin campos)', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    const result = handler(null, {}) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  it('rechaza payload undefined', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    const result = handler(null, undefined) as { ok: boolean }
    expect(result.ok).toBe(false)
  })
})

describe('setHardwareConfig — happy path', () => {
  it('guarda kretzPort en safeStorage', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    const result = handler(null, { kretzPort: 'COM4' }) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(mockSetSecret).toHaveBeenCalledWith('kretz-port', 'COM4')
  })
  it('solo guarda los campos que vienen en el payload', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    handler(null, { kretzPort: 'COM8' })

    expect(mockSetSecret).toHaveBeenCalledTimes(1)
    expect(mockSetSecret).toHaveBeenCalledWith('kretz-port', 'COM8')
  })
})

describe('setHardwareConfig — error de negocio', () => {
  it('retorna ok:false si setSecret lanza error', () => {
    mockSetSecret.mockImplementation(() => { throw new Error('safeStorage no disponible') })

    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    const result = handler(null, { kretzPort: 'COM3' }) as { ok: boolean; error: string }

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/safeStorage/i)
  })
})
