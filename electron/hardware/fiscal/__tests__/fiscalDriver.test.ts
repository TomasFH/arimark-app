import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FiscalRealDriver } from '../fiscalDriver'

// Mockear node:http para no necesitar hardware real en tests
vi.mock('node:http', () => {
  const mockRequest = vi.fn()
  return { default: { request: mockRequest }, request: mockRequest }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FiscalRealDriver — construcción', () => {
  it('construye sin lanzar error con IP vacía', () => {
    expect(() => new FiscalRealDriver('', 'user', 'pass')).not.toThrow()
  })

  it('construye sin lanzar error con credenciales vacías', () => {
    expect(() => new FiscalRealDriver('192.168.1.1', '', '')).not.toThrow()
  })

  it('construye correctamente con parámetros válidos', () => {
    const driver = new FiscalRealDriver('192.168.1.1', 'admin', 'pass123')
    expect(driver).toBeDefined()
    expect(driver.isConnected()).toBe(false)
  })
})

describe('FiscalRealDriver — connect() con parámetros no configurados', () => {
  it('lanza error en connect() si la IP está vacía', async () => {
    const driver = new FiscalRealDriver('', 'user', 'pass')
    await expect(driver.connect()).rejects.toThrow(/IP.*no configurada/i)
  })

  it('lanza error en connect() si la IP es solo espacios', async () => {
    const driver = new FiscalRealDriver('   ', 'user', 'pass')
    await expect(driver.connect()).rejects.toThrow(/IP.*no configurada/i)
  })

  it('lanza error en connect() si las credenciales están vacías', async () => {
    const driver = new FiscalRealDriver('192.168.1.1', '', 'pass')
    await expect(driver.connect()).rejects.toThrow(/credenciales/i)
  })
})

describe('FiscalRealDriver — estado inicial', () => {
  it('isConnected() retorna false antes de conectar', () => {
    const driver = new FiscalRealDriver('192.168.1.1', 'admin', 'pass')
    expect(driver.isConnected()).toBe(false)
  })

  it('retorna error si se intenta procesar un pago sin conectar', async () => {
    const driver = new FiscalRealDriver('192.168.1.1', 'admin', 'pass')
    const result = await driver.processPayment({
      amount: 1000,
      paymentMethod: 'debit',
      referenceId: 'test-001',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no conectada/i)
  })

  it('retorna error si se intenta emitir comprobante sin conectar', async () => {
    const driver = new FiscalRealDriver('192.168.1.1', 'admin', 'pass')
    const result = await driver.issueCashReceipt(500, 'test-002')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no conectada/i)
  })
})
