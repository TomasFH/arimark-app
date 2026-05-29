import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerHardwareConfigHandlers } from '../hardwareConfig.handler'

const { mockHandle, mockGetSecret, mockSetSecret, mockGetCredential, mockSetCredential } =
  vi.hoisted(() => ({
    mockHandle: vi.fn(),
    mockGetSecret: vi.fn(),
    mockSetSecret: vi.fn(),
    mockGetCredential: vi.fn(),
    mockSetCredential: vi.fn(),
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
  getCredential: mockGetCredential,
  setCredential: mockSetCredential,
  SECRET_KEYS: { KRETZ_PORT: 'kretz-port', SAM4S_IP: 'sam4s-ip' },
  CREDENTIAL_ACCOUNTS: { SAM4S_USER: 'sam4s-user', SAM4S_PASSWORD: 'sam4s-password' },
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
      if (key === 'sam4s-ip') return '192.168.1.1'
      return null
    })
    mockGetCredential.mockReturnValue('admin')

    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:get-hardware-config')
    const result = handler(null, undefined) as { ok: boolean; data: unknown }

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      kretzPort: 'COM3',
      sam4sIp: '192.168.1.1',
      sam4sUser: 'admin',
    })
    // La contraseña NUNCA se devuelve
    expect(result.data).not.toHaveProperty('sam4sPassword')
  })

  it('retorna campos undefined cuando no hay config guardada', () => {
    mockGetSecret.mockReturnValue(null)
    mockGetCredential.mockReturnValue(null)

    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:get-hardware-config')
    const result = handler(null, undefined) as { ok: boolean; data: Record<string, unknown> }

    expect(result.ok).toBe(true)
    expect(result.data.kretzPort).toBeUndefined()
    expect(result.data.sam4sIp).toBeUndefined()
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

  it('guarda sam4sIp en safeStorage', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    handler(null, { sam4sIp: '10.0.0.1' })

    expect(mockSetSecret).toHaveBeenCalledWith('sam4s-ip', '10.0.0.1')
  })

  it('guarda credenciales SAM4S en keyring', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    handler(null, { sam4sUser: 'admin', sam4sPassword: 'secret123' })

    expect(mockSetCredential).toHaveBeenCalledWith('sam4s-user', 'admin')
    expect(mockSetCredential).toHaveBeenCalledWith('sam4s-password', 'secret123')
  })

  it('solo guarda los campos que vienen en el payload', () => {
    registerHardwareConfigHandlers()
    const handler = getHandler('ipc:set-hardware-config')
    handler(null, { sam4sIp: '192.168.0.5' })

    expect(mockSetSecret).toHaveBeenCalledTimes(1)
    expect(mockSetSecret).toHaveBeenCalledWith('sam4s-ip', '192.168.0.5')
    expect(mockSetCredential).not.toHaveBeenCalled()
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
