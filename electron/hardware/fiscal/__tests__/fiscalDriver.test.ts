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
  it('lanza error si la IP está vacía', () => {
    expect(() => new FiscalRealDriver('', 'user', 'pass')).toThrow(/IP.*no configurada/i)
  })

  it('lanza error si la IP es solo espacios', () => {
    expect(() => new FiscalRealDriver('   ', 'user', 'pass')).toThrow(/IP.*no configurada/i)
  })

  it('lanza error si el usuario está vacío', () => {
    expect(() => new FiscalRealDriver('192.168.1.1', '', 'pass')).toThrow(/credenciales/i)
  })

  it('lanza error si la contraseña está vacía', () => {
    expect(() => new FiscalRealDriver('192.168.1.1', 'user', '')).toThrow(/credenciales/i)
  })

  it('construye correctamente con parámetros válidos', () => {
    const driver = new FiscalRealDriver('192.168.1.1', 'admin', 'pass123')
    expect(driver).toBeDefined()
    expect(driver.isConnected()).toBe(false)
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
