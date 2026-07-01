import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KretzMockDriver } from '../__mocks__/kretzDriver'

beforeEach(() => {
  vi.useFakeTimers()
  delete process.env['KRETZ_MOCK_MODE']
  process.env['KRETZ_MOCK_INTERVAL_MS'] = '100'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('KretzMockDriver — modo manual (default)', () => {
  it('emite connected al conectar y no emite nada más', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'manual'
    const driver = new KretzMockDriver()
    const onConnected = vi.fn()
    const onError = vi.fn()
    driver.on('connected', onConnected)
    driver.on('error', onError)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(500)

    expect(onConnected).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    await driver.disconnect()
  })

  it('usa manual como modo por defecto sin variable de entorno', async () => {
    delete process.env['KRETZ_MOCK_MODE']
    const driver = new KretzMockDriver()
    const onError = vi.fn()
    driver.on('error', onError)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(500)

    expect(onError).not.toHaveBeenCalled()
    await driver.disconnect()
  })
})

describe('KretzMockDriver — modo timeout', () => {
  it('no emite connected ni errores en modo timeout', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'timeout'
    const driver = new KretzMockDriver()
    const onConnected = vi.fn()
    const onError = vi.fn()
    driver.on('connected', onConnected)
    driver.on('error', onError)

    await driver.connect()
    vi.advanceTimersByTime(1000)

    expect(onConnected).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(driver.isConnected()).toBe(false)
  })
})

describe('KretzMockDriver — modo garbage', () => {
  it('emite errores de datos corruptos periódicamente', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'garbage'
    const driver = new KretzMockDriver()
    const onError = vi.fn()
    driver.on('error', onError)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(250)

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)

    await driver.disconnect()
  })
})

describe('KretzMockDriver — modo malformed_response', () => {
  it('emite error con mensaje de frame inválido', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'malformed_response'
    const driver = new KretzMockDriver()
    const onError = vi.fn()
    driver.on('error', onError)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(250)

    expect(onError).toHaveBeenCalled()
    const err: Error = onError.mock.calls[0][0]
    expect(err.message).toMatch(/inválidos|inválido/i)

    await driver.disconnect()
  })
})

describe('KretzMockDriver — modo disconnect', () => {
  it('se desconecta automáticamente tras N intervalos', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'disconnect'
    process.env['KRETZ_MOCK_DISCONNECT_AFTER'] = '2'
    const driver = new KretzMockDriver()
    const onDisconnected = vi.fn()
    driver.on('disconnected', onDisconnected)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(350)

    expect(onDisconnected).toHaveBeenCalled()
    expect(driver.isConnected()).toBe(false)
  })

  it('emite connected antes de desconectarse', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'disconnect'
    process.env['KRETZ_MOCK_DISCONNECT_AFTER'] = '3'
    const driver = new KretzMockDriver()
    const onConnected = vi.fn()
    const onDisconnected = vi.fn()
    driver.on('connected', onConnected)
    driver.on('disconnected', onDisconnected)

    await driver.connect()
    expect(onConnected).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(450)
    expect(onDisconnected).toHaveBeenCalled()
  })
})

describe('KretzMockDriver — conexión / desconexión', () => {
  it('isConnected() refleja el estado correctamente', async () => {
    const driver = new KretzMockDriver()
    expect(driver.isConnected()).toBe(false)

    await driver.connect()
    expect(driver.isConnected()).toBe(true)

    await driver.disconnect()
    expect(driver.isConnected()).toBe(false)
  })
})
