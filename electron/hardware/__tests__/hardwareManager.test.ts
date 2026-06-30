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

describe('HardwareManager — delegación PLU', () => {
  it('delega testLink al driver KRETZ', async () => {
    const { kretz } = makeMocks()
    const spy = vi.spyOn(kretz, 'testLink').mockResolvedValue(true)
    const manager = new HardwareManager(kretz)

    await expect(manager.kretzTestLink()).resolves.toBe(true)
    expect(spy).toHaveBeenCalled()
  })
})

describe('HardwareManager — fallo de conexión', () => {
  it('marca error y programa reconexión si connect falla', async () => {
    const kretz = new KretzMockDriver()
    vi.spyOn(kretz, 'connect').mockRejectedValueOnce(new Error('puerto ocupado'))

    const manager = new HardwareManager(kretz)
    await manager.start()

    expect(setHardwareStatus).toHaveBeenCalledWith({ scale: 'error' })
    await manager.stop()
  })
})

describe('createHardwareManager / singleton', () => {
  it('createHardwareManager usa mock en dev sin KRETZ_PORT', async () => {
    process.env['APP_ENV'] = 'dev'
    delete process.env['KRETZ_PORT']

    const { createHardwareManager } = await import('../hardwareManager')
    const manager = await createHardwareManager()
    expect(manager).toBeInstanceOf(HardwareManager)
    await manager.stop()
  })

  it('getHardwareManager lanza si no fue inicializado', async () => {
    const { getHardwareManager, _setHardwareManagerForTesting } = await import('../hardwareManager')
    _setHardwareManagerForTesting(null as unknown as HardwareManager)
    expect(() => getHardwareManager()).toThrow(/no inicializado/)
  })

  it('initHardwareManager expone singleton', async () => {
    process.env['APP_ENV'] = 'dev'
    delete process.env['KRETZ_PORT']

    const { initHardwareManager, getHardwareManager } = await import('../hardwareManager')
    const manager = await initHardwareManager()
    expect(getHardwareManager()).toBe(manager)
    await manager.stop()
  })
})
