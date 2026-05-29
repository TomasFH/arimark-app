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

describe('KretzMockDriver — modo normal', () => {
  it('emite evento connected al conectar', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'normal'
    const driver = new KretzMockDriver()
    const onConnected = vi.fn()
    driver.on('connected', onConnected)

    await driver.connect()
    expect(onConnected).toHaveBeenCalledOnce()
    expect(driver.isConnected()).toBe(true)

    await driver.disconnect()
  })

  it('emite tickets sintéticos en modo normal', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'normal'
    const driver = new KretzMockDriver()
    const onTicket = vi.fn()
    driver.on('ticket', onTicket)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(350)

    expect(onTicket).toHaveBeenCalled()
    const ticket = onTicket.mock.calls[0][0]
    expect(ticket).toMatchObject({
      weightKg: expect.any(Number),
      productCode: expect.any(String),
      unitPrice: expect.any(Number),
      subtotal: expect.any(Number),
      timestamp: expect.any(String),
    })

    await driver.disconnect()
  })

  it('emite evento disconnected al desconectar', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'normal'
    const driver = new KretzMockDriver()
    const onDisconnected = vi.fn()
    driver.on('disconnected', onDisconnected)

    await driver.connect()
    await driver.disconnect()

    expect(onDisconnected).toHaveBeenCalledOnce()
    expect(driver.isConnected()).toBe(false)
  })
})

describe('KretzMockDriver — modo timeout', () => {
  it('no emite connected ni tickets en modo timeout', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'timeout'
    const driver = new KretzMockDriver()
    const onConnected = vi.fn()
    const onTicket = vi.fn()
    driver.on('connected', onConnected)
    driver.on('ticket', onTicket)

    await driver.connect()
    vi.advanceTimersByTime(1000)

    expect(onConnected).not.toHaveBeenCalled()
    expect(onTicket).not.toHaveBeenCalled()
    expect(driver.isConnected()).toBe(false)
  })
})

describe('KretzMockDriver — modo garbage', () => {
  it('emite errores en lugar de tickets', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'garbage'
    const driver = new KretzMockDriver()
    const onError = vi.fn()
    const onTicket = vi.fn()
    driver.on('error', onError)
    driver.on('ticket', onTicket)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(250)

    expect(onError).toHaveBeenCalled()
    expect(onTicket).not.toHaveBeenCalled()

    await driver.disconnect()
  })
})

describe('KretzMockDriver — modo malformed_response', () => {
  it('emite error con mensaje de frame inválido', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'malformed_response'
    const driver = new KretzMockDriver()
    const onError = vi.fn()
    const onTicket = vi.fn()
    driver.on('error', onError)
    driver.on('ticket', onTicket)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(250)

    expect(onError).toHaveBeenCalled()
    const err: Error = onError.mock.calls[0][0]
    expect(err.message).toMatch(/inválidos|inválido/i)
    expect(onTicket).not.toHaveBeenCalled()

    await driver.disconnect()
  })
})

describe('KretzMockDriver — modo disconnect', () => {
  it('se desconecta automáticamente tras N tickets', async () => {
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
})
