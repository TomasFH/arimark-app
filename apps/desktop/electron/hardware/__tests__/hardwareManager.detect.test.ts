import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../../ipc/hardwareStatus.handler', () => ({
  setHardwareStatus: vi.fn(),
}))

const setSecretMock = vi.hoisted(() => vi.fn())

vi.mock('../../secureStorage', () => ({
  getSecret: vi.fn(() => null),
  setSecret: (...args: unknown[]) => setSecretMock(...args),
  SECRET_KEYS: { KRETZ_PORT: 'kretz-port' },
}))

// Driver real simulado: al conectar emite 'connected' como el real.
class FakeRealDriver extends EventEmitter {
  connect = vi.fn(async () => {
    this.emit('connected')
  })
  disconnect = vi.fn(async () => {})
  isConnected = vi.fn(() => true)
  testLink = vi.fn(async () => true)
}
const realDriverInstances: FakeRealDriver[] = []

vi.mock('../kretz/kretzDriver', () => ({
  KretzRealDriver: vi.fn().mockImplementation(() => {
    const d = new FakeRealDriver()
    realDriverInstances.push(d)
    return d
  }),
}))

const detectKretzPortMock = vi.fn()
vi.mock('../kretz/portDetect', () => ({
  detectKretzPort: (...args: unknown[]) => detectKretzPortMock(...args),
}))

import { HardwareManager } from '../hardwareManager'
import type { KretzDriver } from '../kretz/kretzDriver.interface'
import { setHardwareStatus } from '../../ipc/hardwareStatus.handler'

function makeStubDriver(): EventEmitter & {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
  testLink: ReturnType<typeof vi.fn>
} {
  const e = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    isConnected: ReturnType<typeof vi.fn>
    testLink: ReturnType<typeof vi.fn>
  }
  e.connect = vi.fn(async () => {})
  e.disconnect = vi.fn(async () => {})
  e.isConnected = vi.fn(() => false)
  e.testLink = vi.fn(async () => true)
  return e
}

function asDriver(driver: EventEmitter): KretzDriver {
  return driver as unknown as KretzDriver
}

beforeEach(() => {
  vi.clearAllMocks()
  realDriverInstances.length = 0
  delete process.env['KRETZ_PORT']
  delete process.env['KRETZ_AUTOPROBE']
  process.env['APP_ENV'] = 'dev'
})

describe('HardwareManager — setKretzPort', () => {
  it('crea un driver real nuevo en el puerto dado y reconecta', async () => {
    const initial = makeStubDriver()
    const manager = new HardwareManager(asDriver(initial))

    await manager.setKretzPort('COM11')

    expect(initial.disconnect).toHaveBeenCalled()
    expect(realDriverInstances).toHaveLength(1)
    expect(realDriverInstances[0].connect).toHaveBeenCalled()
    expect(manager.getKretzPort()).toBe('COM11')
    expect(setHardwareStatus).toHaveBeenCalledWith(expect.objectContaining({ scale: 'connected' }))
  })
})

describe('HardwareManager — detectAndConnectKretz', () => {
  it('devuelve el puerto detectado y lo conecta', async () => {
    detectKretzPortMock.mockResolvedValue('COM11')
    const initial = makeStubDriver()
    const manager = new HardwareManager(asDriver(initial))

    const result = await manager.detectAndConnectKretz()

    expect(result).toBe('COM11')
    expect(detectKretzPortMock).toHaveBeenCalled()
    expect(manager.getKretzPort()).toBe('COM11')
    expect(realDriverInstances).toHaveLength(1)
    expect(setSecretMock).toHaveBeenCalledWith('kretz-port', 'COM11')
  })

  it('devuelve null si no detecta ninguna balanza y no cambia el puerto', async () => {
    detectKretzPortMock.mockResolvedValue(null)
    const initial = makeStubDriver()
    const manager = new HardwareManager(asDriver(initial))

    const result = await manager.detectAndConnectKretz()

    expect(result).toBeNull()
    expect(realDriverInstances).toHaveLength(0)
    expect(manager.getKretzPort()).toBeNull()

    // Limpia el timer de reconexión que se programa al no detectar nada.
    await manager.stop()
  })
})

describe('HardwareManager — puerto configurado que no responde', () => {
  it('si COM8 responde al enlace, no sondea otros COM', async () => {
    const initial = makeStubDriver()
    const manager = new HardwareManager(asDriver(initial), 'COM8')

    await manager.start()

    expect(initial.testLink).toHaveBeenCalled()
    expect(detectKretzPortMock).not.toHaveBeenCalled()
    expect(manager.getKretzPort()).toBe('COM8')
    expect(setSecretMock).not.toHaveBeenCalled()
    expect(setHardwareStatus).toHaveBeenCalledWith(expect.objectContaining({ scale: 'connected' }))
    await manager.stop()
  })

  it('si el puerto configurado no responde al enlace, conecta el COM que sí responde', async () => {
    detectKretzPortMock.mockResolvedValue('COM11')
    const initial = makeStubDriver()
    initial.connect.mockImplementation(async () => {
      initial.emit('connected')
    })
    initial.testLink.mockResolvedValue(false)
    const manager = new HardwareManager(asDriver(initial), 'COM8')

    await manager.start()

    expect(detectKretzPortMock).toHaveBeenCalled()
    expect(manager.getKretzPort()).toBe('COM11')
    expect(realDriverInstances).toHaveLength(1)
    expect(realDriverInstances[0]?.testLink).toHaveBeenCalled()
    expect(setSecretMock).toHaveBeenCalledWith('kretz-port', 'COM11')
    expect(setHardwareStatus).toHaveBeenCalledWith(expect.objectContaining({ scale: 'connected' }))
    await manager.stop()
  })

  it('si el COM configurado no abre, conecta el otro que responde', async () => {
    detectKretzPortMock.mockResolvedValue('COM5')
    const initial = makeStubDriver()
    initial.connect.mockRejectedValue(new Error('No se pudo abrir el puerto COM8: File not found'))
    const manager = new HardwareManager(asDriver(initial), 'COM8')

    await manager.start()

    expect(detectKretzPortMock).toHaveBeenCalled()
    expect(manager.getKretzPort()).toBe('COM5')
    expect(setSecretMock).toHaveBeenCalledWith('kretz-port', 'COM5')
    await manager.stop()
  })

  it('si ningún COM responde, conserva el puerto configurado y no guarda otro', async () => {
    detectKretzPortMock.mockResolvedValue(null)
    const initial = makeStubDriver()
    initial.testLink.mockResolvedValue(false)
    const manager = new HardwareManager(asDriver(initial), 'COM8')

    await manager.start()

    expect(manager.getKretzPort()).toBe('COM8')
    expect(realDriverInstances).toHaveLength(0)
    expect(setSecretMock).not.toHaveBeenCalled()
    expect(setHardwareStatus).toHaveBeenCalledWith({ scale: 'error' })
    await manager.stop()
  })

  it('sin puerto configurado no sondea (el mock de pnpm dev no busca COM)', async () => {
    const initial = makeStubDriver()
    initial.connect.mockRejectedValue(new Error('puerto ocupado'))
    const manager = new HardwareManager(asDriver(initial))

    await manager.start()

    expect(detectKretzPortMock).not.toHaveBeenCalled()
    expect(manager.getKretzPort()).toBeNull()
    expect(setHardwareStatus).toHaveBeenCalledWith({ scale: 'error' })
    await manager.stop()
  })
})

describe('createHardwareManager — KRETZ_AUTOPROBE', () => {
  it('en dev sin puerto ni KRETZ_AUTOPROBE no instancia el driver real', async () => {
    const { createHardwareManager } = await import('../hardwareManager')
    const manager = await createHardwareManager()

    expect(realDriverInstances).toHaveLength(0)
    expect(manager.getKretzPort()).toBeNull()
    await manager.stop()
  })

  it('con KRETZ_AUTOPROBE y sin puerto guardado conecta el COM que responde', async () => {
    process.env['KRETZ_AUTOPROBE'] = '1'
    detectKretzPortMock.mockResolvedValue('COM11')
    const { createHardwareManager } = await import('../hardwareManager')
    const manager = await createHardwareManager()

    await manager.start()

    expect(manager.getKretzPort()).toBe('COM11')
    expect(detectKretzPortMock).toHaveBeenCalled()
    expect(setSecretMock).toHaveBeenCalledWith('kretz-port', 'COM11')
    await manager.stop()
  })

  it('con KRETZ_PORT usa ese puerto y no sondea si el enlace responde', async () => {
    process.env['KRETZ_PORT'] = 'COM8'
    process.env['KRETZ_AUTOPROBE'] = '1'
    const { createHardwareManager } = await import('../hardwareManager')
    const manager = await createHardwareManager()

    expect(manager.getKretzPort()).toBe('COM8')
    await manager.start()

    expect(detectKretzPortMock).not.toHaveBeenCalled()
    expect(manager.getKretzPort()).toBe('COM8')
    await manager.stop()
  })
})
