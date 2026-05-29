import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'

// vi.hoisted con require() inline — se ejecuta antes del hoisting de vi.mock
const { tmpDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _fs = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _os = require('os') as typeof import('os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _path = require('path') as typeof import('path')
  const tmpDir = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'carniceria-secure-test-'))
  return { tmpDir }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((s: string) => Buffer.from(`encrypted:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('encrypted:', '')),
  },
  app: {
    getPath: vi.fn().mockReturnValue(tmpDir),
    getVersion: vi.fn().mockReturnValue('0.1.0'),
  },
}))

vi.mock('@napi-rs/keyring', () => {
  const store = new Map<string, string>()
  return {
    Entry: vi.fn().mockImplementation((_service: string, account: string) => ({
      setPassword: vi.fn((pw: string) => store.set(account, pw)),
      getPassword: vi.fn(() => store.get(account) ?? null),
      deletePassword: vi.fn(() => store.delete(account)),
    })),
  }
})

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    initialize: vi.fn(),
    transports: { file: { level: 'info' } },
  },
}))

import {
  setSecret,
  getSecret,
  deleteSecret,
  setCredential,
  getCredential,
  deleteCredential,
} from '../secureStorage'

describe('secureStorage — safeStorage', () => {
  beforeEach(() => {
    const secretsDir = path.join(tmpDir, '.secrets')
    if (fs.existsSync(secretsDir)) {
      fs.readdirSync(secretsDir).forEach(f => fs.unlinkSync(path.join(secretsDir, f)))
    }
  })

  it('guarda y recupera un secreto correctamente', () => {
    setSecret('test-key', 'mi-valor-secreto')
    const result = getSecret('test-key')
    expect(result).toBe('mi-valor-secreto')
  })

  it('retorna null si el secreto no existe', () => {
    expect(getSecret('clave-inexistente')).toBeNull()
  })

  it('elimina un secreto', () => {
    setSecret('borrar-esto', 'valor')
    deleteSecret('borrar-esto')
    expect(getSecret('borrar-esto')).toBeNull()
  })
})

describe('secureStorage — keyring (SAM4S credentials)', () => {
  it('guarda y recupera credenciales', () => {
    setCredential('sam4s-user', 'admin')
    expect(getCredential('sam4s-user')).toBe('admin')
  })

  it('retorna null si la credencial no existe', () => {
    expect(getCredential('inexistente-account')).toBeNull()
  })

  it('elimina credencial', () => {
    setCredential('cuenta-borrar', 'pw123')
    deleteCredential('cuenta-borrar')
    expect(getCredential('cuenta-borrar')).toBeNull()
  })
})
