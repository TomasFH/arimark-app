import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HardwareManager } from '../hardwareManager'
import { KretzMockDriver } from '../kretz/__mocks__/kretzDriver'
import { FiscalMockDriver } from '../fiscal/__mocks__/fiscalDriver'

// Mockear módulos de Electron que no están disponibles en tests
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../../ipc/hardwareStatus.handler', () => ({
  setHardwareStatus: vi.fn(),
}))

vi.mock('../../secureStorage', () => ({
  getSecret: vi.fn(() => null),
  getCredential: vi.fn(() => null),
  SECRET_KEYS: { KRETZ_PORT: 'kretz-port', SAM4S_IP: 'sam4s-ip' },
  CREDENTIAL_ACCOUNTS: { SAM4S_USER: 'sam4s-user', SAM4S_PASSWORD: 'sam4s-password' },
}))

import { setHardwareStatus } from '../../ipc/hardwareStatus.handler'

function makeMocks() {
  process.env['KRETZ_MOCK_MODE'] = 'normal'
  process.env['KRETZ_MOCK_INTERVAL_MS'] = '100'
  process.env['FISCAL_MOCK_MODE'] = 'normal'
  return {
    kretz: new KretzMockDriver(),
    fiscal: new FiscalMockDriver(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  delete process.env['KRETZ_MOCK_MODE']
  delete process.env['FISCAL_MOCK_MODE']
  delete process.env['KRETZ_MOCK_INTERVAL_MS']
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HardwareManager — start / stop', () => {
  it('llama setHardwareStatus con scale:connected al conectar KRETZ', async () => {
    const { kretz, fiscal } = makeMocks()
    const manager = new HardwareManager(kretz, fiscal)

    await manager.start()

    expect(setHardwareStatus).toHaveBeenCalledWith(expect.objectContaining({ scale: 'connected' }))
    await manager.stop()
  })

  it('llama setHardwareStatus con fiscal:connected al conectar SAM4S', async () => {
    const { kretz, fiscal } = makeMocks()
    const manager = new HardwareManager(kretz, fiscal)

    await manager.start()

    expect(setHardwareStatus).toHaveBeenCalledWith(expect.objectContaining({ fiscal: 'connected' }))
    await manager.stop()
  })

  it('stop desconecta ambos drivers', async () => {
    const { kretz, fiscal } = makeMocks()
    const disconnectKretz = vi.spyOn(kretz, 'disconnect')
    const disconnectFiscal = vi.spyOn(fiscal, 'disconnect')

    const manager = new HardwareManager(kretz, fiscal)
    await manager.start()
    await manager.stop()

    expect(disconnectKretz).toHaveBeenCalled()
    expect(disconnectFiscal).toHaveBeenCalled()
  })
})

describe('HardwareManager — eventos KRETZ', () => {
  it('actualiza estado a disconnected y programa reconexión si KRETZ se desconecta', async () => {
    const { kretz, fiscal } = makeMocks()
    const manager = new HardwareManager(kretz, fiscal)
    await manager.start()

    vi.clearAllMocks()
    kretz.emit('disconnected')

    expect(setHardwareStatus).toHaveBeenCalledWith({ scale: 'disconnected' })
    await manager.stop()
  })

  it('actualiza estado a error si KRETZ emite error', async () => {
    const { kretz, fiscal } = makeMocks()
    const manager = new HardwareManager(kretz, fiscal)
    await manager.start()

    vi.clearAllMocks()
    kretz.emit('error', new Error('test error'))

    expect(setHardwareStatus).toHaveBeenCalledWith({ scale: 'error' })
    await manager.stop()
  })
})

describe('HardwareManager — processFiscalPayment', () => {
  it('delega processPayment al driver fiscal', async () => {
    const { kretz, fiscal } = makeMocks()
    const manager = new HardwareManager(kretz, fiscal)
    await manager.start()

    const result = await manager.processPayment({
      amount: 1500,
      paymentMethod: 'debit',
      referenceId: 'sale-001',
    })

    expect(result.ok).toBe(true)
    await manager.stop()
  })

  it('delega issueCashReceipt al driver fiscal', async () => {
    const { kretz, fiscal } = makeMocks()
    const manager = new HardwareManager(kretz, fiscal)
    await manager.start()

    const result = await manager.issueCashReceipt(2000, 'sale-002')
    expect(result.ok).toBe(true)
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
    process.env['FISCAL_MOCK_MODE'] = 'normal'

    const kretz = new KretzMockDriver()
    const fiscal = new FiscalMockDriver()
    const manager = new HardwareManager(kretz, fiscal)
    await manager.start()

    await vi.advanceTimersByTimeAsync(250)

    expect(mockSend).toHaveBeenCalledWith('ipc:scale-ticket', expect.objectContaining({
      weightKg: expect.any(Number),
      productCode: expect.any(String),
    }))

    await manager.stop()
  })
})
