import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock de Firebase — no usamos el SDK real en tests
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(),
  isFirebaseAvailable: vi.fn().mockReturnValue(true),
}))

const { mockGetSecret, mockSetSecret } = vi.hoisted(() => ({
  mockGetSecret: vi.fn(),
  mockSetSecret: vi.fn(),
}))

vi.mock('../../secureStorage', () => ({
  getSecret: mockGetSecret,
  setSecret: mockSetSecret,
  deleteSecret: vi.fn(),
  SECRET_KEYS: {
    LAST_LICENSE_VERIFIED_AT: 'last-license-verified-at',
    FIREBASE_ANON_UID: 'firebase-anon-uid',
    CASHIER_SESSION_TOKEN: 'cashier-session-token',
    ADMIN_SESSION_TOKEN: 'admin-session-token',
  },
}))

import { getDoc } from 'firebase/firestore'
import { verifyLicense } from '../license'

describe('verifyLicense', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'production'
  })

  it('retorna válida en modo sandbox sin llamar Firebase', async () => {
    process.env['APP_ENV'] = 'sandbox'
    const result = await verifyLicense('ANY-KEY')
    expect(result.valid).toBe(true)
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('retorna inválida si la licencia no existe en Firestore', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as unknown as ReturnType<typeof getDoc>)
    const result = await verifyLicense('MISSING-KEY')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('not_found')
  })

  it('retorna inválida si activo: false', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ activo: false, vencimiento: null }),
    } as unknown as ReturnType<typeof getDoc>)

    const result = await verifyLicense('INACTIVE-KEY')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('inactive')
  })

  it('retorna inválida si la licencia venció', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        activo: true,
        vencimiento: { toDate: () => pastDate },
      }),
    } as unknown as ReturnType<typeof getDoc>)

    const result = await verifyLicense('EXPIRED-KEY')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('expired')
  })

  it('retorna válida si activo y sin vencimiento', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ activo: true, vencimiento: null }),
    } as unknown as ReturnType<typeof getDoc>)

    const result = await verifyLicense('VALID-KEY')
    expect(result.valid).toBe(true)
    expect(mockSetSecret).toHaveBeenCalledWith('last-license-verified-at', expect.any(String))
  })

  it('permite acceso offline si última verificación fue hace menos de 48h', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('network error'))
    const recentTime = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()
    mockGetSecret.mockReturnValue(recentTime)

    const result = await verifyLicense('ANY-KEY')
    expect(result.valid).toBe(true)
  })

  it('bloquea si sin internet y última verificación fue hace más de 48h', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('network error'))
    const oldTime = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString()
    mockGetSecret.mockReturnValue(oldTime)

    const result = await verifyLicense('ANY-KEY')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('offline_timeout')
  })

  it('bloquea si sin internet y nunca hubo verificación previa', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('network error'))
    mockGetSecret.mockReturnValue(null)

    const result = await verifyLicense('ANY-KEY')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('offline_timeout')
  })
})
