import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OFFLINE_TTL_MS } from '../offlineAuth'

const secretStore = new Map<string, string>()

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../secureStorage', () => ({
  getSecret: vi.fn((key: string) => secretStore.get(key) ?? null),
  setSecret: vi.fn((key: string, val: string) => { secretStore.set(key, val) }),
  deleteSecret: vi.fn((key: string) => { secretStore.delete(key) }),
  SECRET_KEYS: { OFFLINE_CREDENTIALS: 'offline-credentials' },
}))

import { cacheCredentials, validateOffline, normalizeEmail } from '../offlineAuth'

const PROFILE = {
  uid: 'uid-ana',
  email: 'ana@negocio.com',
  role: 'cashier' as const,
  displayName: 'Ana',
  authorizedStores: ['store-1'],
}

describe('offlineAuth', () => {
  beforeEach(() => {
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('normaliza email con trim y minúsculas', () => {
    expect(normalizeEmail('  Ana@Negocio.COM ')).toBe('ana@negocio.com')
  })

  it('cache + validate con la misma contraseña retorna el perfil', () => {
    cacheCredentials('Ana@negocio.com', 'clave-secreta', PROFILE)
    const ok = validateOffline('ana@negocio.com', 'clave-secreta')
    expect(ok).not.toBeNull()
    expect(ok?.userId).toBe('uid-ana')
    expect(ok?.name).toBe('Ana')
    expect(ok?.role).toBe('cashier')
    expect(ok?.authorizedStores).toEqual(['store-1'])
  })

  it('rechaza contraseña incorrecta sin filtrar que el email existe', () => {
    cacheCredentials('ana@negocio.com', 'clave-secreta', PROFILE)
    expect(validateOffline('ana@negocio.com', 'otra')).toBeNull()
    expect(validateOffline('nadie@negocio.com', 'clave-secreta')).toBeNull()
  })

  it('guarda varias cuentas en la misma PC', () => {
    cacheCredentials('ana@negocio.com', 'clave-ana', PROFILE)
    cacheCredentials('beto@negocio.com', 'clave-beto', {
      ...PROFILE,
      uid: 'uid-beto',
      email: 'beto@negocio.com',
      displayName: 'Beto',
      role: 'admin',
    })
    expect(validateOffline('ana@negocio.com', 'clave-ana')?.userId).toBe('uid-ana')
    expect(validateOffline('beto@negocio.com', 'clave-beto')?.role).toBe('admin')
    expect(validateOffline('ana@negocio.com', 'clave-beto')).toBeNull()
  })

  it('rechaza hash expirado (30 días)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    cacheCredentials('ana@negocio.com', 'clave-secreta', PROFILE)
    vi.setSystemTime(new Date(Date.parse('2026-01-01T00:00:00.000Z') + OFFLINE_TTL_MS + 1000))
    expect(validateOffline('ana@negocio.com', 'clave-secreta')).toBeNull()
    vi.useRealTimers()
  })

  it('actualizar cache reemplaza el hash anterior', () => {
    cacheCredentials('ana@negocio.com', 'vieja', PROFILE)
    cacheCredentials('ana@negocio.com', 'nueva', PROFILE)
    expect(validateOffline('ana@negocio.com', 'vieja')).toBeNull()
    expect(validateOffline('ana@negocio.com', 'nueva')?.userId).toBe('uid-ana')
  })
})
