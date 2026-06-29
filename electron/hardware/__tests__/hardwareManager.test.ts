import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HardwareManager } from '../hardwareManager'
import { KretzMockDriver } from '../kretz/__mocks__/kretzDriver'

// Mockear módulos de Electron que no están disponibles en tests
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../../ipc/hardwareStatus.handler', () => ({
  setHardwareStatus: vi.fn(),
}))

vi.mock('../../secureStorage', () => ({
  getSecret: vi.fn(() => null),
  SECRET_KEYS: { KRETZ_PORT: 'kretz-port' },
}))

import { setHardwareStatus } from '../../ipc/hardwareStatus.handler'

function makeMocks() {
  process.env['KRETZ_MOCK_MODE'] = 'normal'
  process.env['KRETZ_MOCK_INTERVAL_MS'] = '100'
  return {
    kretz: new KretzMockDriver(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  delete process.env['KRETZ_MOCK_MODE']
  delete process.env['KRETZ_MOCK_INTERVAL_MS']
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HardwareManager — start / stop', () => {
  it('llama setHardwareStatus con scale:connected al conectar KRETZ', async () => {
    const { kretz } = makeMocks()
    const manager = new HardwareManager(kretz)

    await manager.start()

    expect(setHardwareStatus).toHaveBeenCalledWith(expect.objectContaining({ scale: 'connected' }))
    await manager.stop()
  })

  it('stop desconecta la balanza', async () => {
    const { kretz } = makeMocks()
    const disconnectKretz = vi.spyOn(kretz, 'disconnect')

    const manager = new HardwareManager(kretz)
    await manager.start()
    await manager.stop()

    expect(disconnectKretz).toHaveBeenCalled()
  })
})

describe('HardwareManager — eventos KRETZ', () => {
  it('actualiza estado a disconnected y programa reconexión si KRETZ se desconecta', async () => {
    const { kretz } = makeMocks()
    const manager = new HardwareManager(kretz)
    await manager.start()

    vi.clearAllMocks()
    kretz.emit('disconnected')

    expect(setHardwareStatus).toHaveBeenCalledWith({ scale: 'disconnected' })
    await manager.stop()
  })

  it('actualiza estado a error si KRETZ emite error', async () => {
    const { kretz } = makeMocks()
    const manager = new HardwareManager(kretz)
    await manager.start()

    vi.clearAllMocks()
    kretz.emit('error', new Error('test error'))

    expect(setHardwareStatus).toHaveBeenCalledWith({ scale: 'error' })
    await manager.stop()
  })
})

describe('HardwareManager — broadcast de tickets', () => {
  it('envía ticket a las ventanas abiertas via webContents.send', async () => {
    const mockSend = vi.fn()
    const { BrowserWindow } = await import('electron')
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send: mockSend } } as unknown as Electron.BrowserWindow,
    ])

    process.env['KRETZ_MOCK_MODE'] = 'normal'
    process.env['KRETZ_MOCK_INTERVAL_MS'] = '100'

    const kretz = new KretzMockDriver()
    const manager = new HardwareManager(kretz)
    await manager.start()

    await vi.advanceTimersByTimeAsync(250)

    expect(mockSend).toHaveBeenCalledWith('ipc:scale-order', expect.objectContaining({
      channel: expect.any(String),
      items: expect.any(Array),
      total: expect.any(Number),
    }))

    await manager.stop()
  })
})
