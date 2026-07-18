import { describe, expect, it, vi } from 'vitest'

const key = Buffer.alloc(32, 7).toString('base64')

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  safeStorage: {},
}))

vi.mock('../../secureStorage', () => ({
  SECRET_KEYS: { CUSTOMER_DATA_ENCRYPTION_KEY: 'customer-data-encryption-key' },
  getSecret: vi.fn(() => key),
  setSecret: vi.fn(),
}))

import {
  decryptCustomerIdentifier,
  encryptCustomerIdentifier,
  maskDni,
  maskPhone,
} from '../customerDataEncryption'

describe('customerDataEncryption', () => {
  it('cifra y descifra un DNI sin persistirlo en texto plano', () => {
    const encrypted = encryptCustomerIdentifier('12345678')

    expect(encrypted).toMatch(/^enc:v1:/)
    expect(encrypted).not.toContain('12345678')
    expect(decryptCustomerIdentifier(encrypted)).toBe('12345678')
  })

  it('lee datos históricos no cifrados para poder migrarlos gradualmente', () => {
    expect(decryptCustomerIdentifier('11-4567-8901')).toBe('11-4567-8901')
  })

  it('enmascara identificadores para no exponerlos al renderer', () => {
    expect(maskDni('12345678')).toBe('DNI •••••678')
    expect(maskPhone('11-4567-8901')).toBe('Tel. ••••8901')
  })
})
