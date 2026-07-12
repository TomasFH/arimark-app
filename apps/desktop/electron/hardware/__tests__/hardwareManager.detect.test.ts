import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

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

// Driver real simulado: al conectar emite 'connected' como el real.
class FakeRealDriver extends EventEmitter {
  connect = vi.fn(async () => {
    this.emit('connected')
  })
  disconnect = vi.fn(async () => {})
  isConnected = vi.fn(() => true)
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
import { setHardwareStatus } from '../../ipc/hardwareStatus.handler'

function makeStubDriver(): EventEmitter & {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
} {
  const e = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    isConnected: ReturnType<typeof vi.fn>
  }
  e.connect = vi.fn(async () => {})
  e.disconnect = vi.fn(async () => {})
  e.isConnected = vi.fn(() => false)
  return e
}

beforeEach(() => {
  vi.clearAllMocks()
  realDriverInstances.length = 0
})

describe('HardwareManager — setKretzPort', () => {
  it('crea un driver real nuevo en el puerto dado y reconecta', async () => {
    const initial = makeStubDriver()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = new HardwareManager(initial as any)

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = new HardwareManager(initial as any)

    const result = await manager.detectAndConnectKretz()

    expect(result).toBe('COM11')
    expect(detectKretzPortMock).toHaveBeenCalled()
    expect(manager.getKretzPort()).toBe('COM11')
    expect(realDriverInstances).toHaveLength(1)
  })

  it('devuelve null si no detecta ninguna balanza y no cambia el puerto', async () => {
    detectKretzPortMock.mockResolvedValue(null)
    const initial = makeStubDriver()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = new HardwareManager(initial as any)

    const result = await manager.detectAndConnectKretz()

    expect(result).toBeNull()
    expect(realDriverInstances).toHaveLength(0)
    expect(manager.getKretzPort()).toBeNull()

    // Limpia el timer de reconexión que se programa al no detectar nada.
    await manager.stop()
  })
})
