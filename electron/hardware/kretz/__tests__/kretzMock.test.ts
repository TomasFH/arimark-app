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
  it('no emite pedidos automáticamente', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'manual'
    const driver = new KretzMockDriver()
    const onOrder = vi.fn()
    driver.on('order', onOrder)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(500)

    expect(onOrder).not.toHaveBeenCalled()
    await driver.disconnect()
  })

  it('emite pedido al llamar emitMockOrder', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'manual'
    const driver = new KretzMockDriver()
    const onOrder = vi.fn()
    driver.on('order', onOrder)

    await driver.connect()
    driver.emitMockOrder({
      channel: 'A',
      items: [
        { productCode: 'ASADO', weightKg: 1.5, unitPrice: 8500 },
        { productCode: 'VACIO', weightKg: 0.8, unitPrice: 9200 },
      ],
    })

    expect(onOrder).toHaveBeenCalledOnce()
    const order = onOrder.mock.calls[0][0]
    expect(order).toMatchObject({
      channel: 'A',
      items: expect.arrayContaining([
        expect.objectContaining({ productCode: 'ASADO', weightKg: 1.5, subtotal: 12750 }),
        expect.objectContaining({ productCode: 'VACIO', weightKg: 0.8 }),
      ]),
      total: expect.any(Number),
      timestamp: expect.any(String),
    })
    expect(order.items).toHaveLength(2)

    await driver.disconnect()
  })

  it('usa manual como modo por defecto sin variable de entorno', async () => {
    delete process.env['KRETZ_MOCK_MODE']
    const driver = new KretzMockDriver()
    const onOrder = vi.fn()
    driver.on('order', onOrder)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(500)

    expect(onOrder).not.toHaveBeenCalled()
    await driver.disconnect()
  })
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

  it('emite pedidos sintéticos en modo normal', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'normal'
    const driver = new KretzMockDriver()
    const onOrder = vi.fn()
    driver.on('order', onOrder)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(350)

    expect(onOrder).toHaveBeenCalled()
    const order = onOrder.mock.calls[0][0]
    expect(order).toMatchObject({
      channel: expect.stringMatching(/^[ABCD]$/),
      items: expect.any(Array),
      total: expect.any(Number),
      timestamp: expect.any(String),
    })
    expect(order.items.length).toBeGreaterThanOrEqual(1)

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
  it('no emite connected ni pedidos en modo timeout', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'timeout'
    const driver = new KretzMockDriver()
    const onConnected = vi.fn()
    const onOrder = vi.fn()
    driver.on('connected', onConnected)
    driver.on('order', onOrder)

    await driver.connect()
    vi.advanceTimersByTime(1000)

    expect(onConnected).not.toHaveBeenCalled()
    expect(onOrder).not.toHaveBeenCalled()
    expect(driver.isConnected()).toBe(false)
  })
})

describe('KretzMockDriver — modo garbage', () => {
  it('emite errores en lugar de pedidos', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'garbage'
    const driver = new KretzMockDriver()
    const onError = vi.fn()
    const onOrder = vi.fn()
    driver.on('error', onError)
    driver.on('order', onOrder)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(250)

    expect(onError).toHaveBeenCalled()
    expect(onOrder).not.toHaveBeenCalled()

    await driver.disconnect()
  })
})

describe('KretzMockDriver — modo malformed_response', () => {
  it('emite error con mensaje de frame inválido', async () => {
    process.env['KRETZ_MOCK_MODE'] = 'malformed_response'
    const driver = new KretzMockDriver()
    const onError = vi.fn()
    const onOrder = vi.fn()
    driver.on('error', onError)
    driver.on('order', onOrder)

    await driver.connect()
    await vi.advanceTimersByTimeAsync(250)

    expect(onError).toHaveBeenCalled()
    const err: Error = onError.mock.calls[0][0]
    expect(err.message).toMatch(/inválidos|inválido/i)
    expect(onOrder).not.toHaveBeenCalled()

    await driver.disconnect()
  })
})

describe('KretzMockDriver — modo disconnect', () => {
  it('se desconecta automáticamente tras N pedidos', async () => {
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
