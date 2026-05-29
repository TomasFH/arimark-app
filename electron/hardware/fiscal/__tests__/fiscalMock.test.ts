import { describe, it, expect, beforeEach } from 'vitest'
import { FiscalMockDriver } from '../__mocks__/fiscalDriver'

beforeEach(() => {
  delete process.env['FISCAL_MOCK_MODE']
})

describe('FiscalMockDriver — modo normal', () => {
  it('conecta y procesa pago exitosamente', async () => {
    process.env['FISCAL_MOCK_MODE'] = 'normal'
    const driver = new FiscalMockDriver()

    await driver.connect()
    expect(driver.isConnected()).toBe(true)

    const result = await driver.processPayment({
      amount: 1500,
      paymentMethod: 'debit',
      referenceId: 'sale-001',
    })

    expect(result.ok).toBe(true)
    expect(result.receiptNumber).toMatch(/^DEBIT-/)
  })

  it('emite comprobante en efectivo', async () => {
    process.env['FISCAL_MOCK_MODE'] = 'normal'
    const driver = new FiscalMockDriver()
    await driver.connect()

    const result = await driver.issueCashReceipt(2000, 'sale-002')
    expect(result.ok).toBe(true)
    expect(result.receiptNumber).toMatch(/^CASH-/)
  })

  it('retorna error si no está conectado', async () => {
    process.env['FISCAL_MOCK_MODE'] = 'normal'
    const driver = new FiscalMockDriver()

    const result = await driver.processPayment({
      amount: 500,
      paymentMethod: 'wallet',
      referenceId: 'sale-003',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no conectada/)
  })
})

describe('FiscalMockDriver — modo http_error', () => {
  it('retorna error HTTP en processPayment', async () => {
    process.env['FISCAL_MOCK_MODE'] = 'http_error'
    const driver = new FiscalMockDriver()
    await driver.connect()

    const result = await driver.processPayment({
      amount: 1000,
      paymentMethod: 'credit',
      referenceId: 'sale-004',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/500/)
  })
})

describe('FiscalMockDriver — modo malformed_response', () => {
  it('retorna error de respuesta malformada', async () => {
    process.env['FISCAL_MOCK_MODE'] = 'malformed_response'
    const driver = new FiscalMockDriver()
    await driver.connect()

    const result = await driver.processPayment({
      amount: 800,
      paymentMethod: 'debit',
      referenceId: 'sale-005',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/malformada/)
  })
})

describe('FiscalMockDriver — modo disconnect', () => {
  it('simula desconexión durante el pago', async () => {
    process.env['FISCAL_MOCK_MODE'] = 'disconnect'
    const driver = new FiscalMockDriver()
    await driver.connect()

    const result = await driver.processPayment({
      amount: 1200,
      paymentMethod: 'wallet',
      referenceId: 'sale-006',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/desconect/)
    expect(driver.isConnected()).toBe(false)
  })
})
