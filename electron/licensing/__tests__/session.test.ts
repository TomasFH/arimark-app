import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  Timestamp: {
    fromDate: vi.fn((d: Date) => ({ toDate: () => d, seconds: d.getTime() / 1000 })),
  },
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(),
}))

const secretStore = new Map<string, string>()

vi.mock('../../secureStorage', () => ({
  getSecret: vi.fn((key: string) => secretStore.get(key) ?? null),
  setSecret: vi.fn((key: string, val: string) => { secretStore.set(key, val) }),
  deleteSecret: vi.fn((key: string) => { secretStore.delete(key) }),
  SECRET_KEYS: {
    CASHIER_SESSION_TOKEN: 'cashier-session-token',
    ADMIN_SESSION_TOKEN: 'admin-session-token',
    LAST_LICENSE_VERIFIED_AT: 'last-license-verified-at',
    FIREBASE_ANON_UID: 'firebase-anon-uid',
  },
}))

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-token'),
}))

import { getDoc, setDoc, deleteDoc } from 'firebase/firestore'
import { signInWithEmailAndPassword } from 'firebase/auth'
import {
  startCashierSession,
  endCashierSession,
  getStoredCashierSession,
  loginAdmin,
  logoutAdmin,
  getStoredAdminSession,
} from '../session'

describe('CashierSession — modo sandbox', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'sandbox'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('inicia sesión de cajera correctamente', async () => {
    const result = await startCashierSession('LIC-001', 'store-001', 'user-001')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.token).toBe('mock-uuid-token')
      expect(result.session.storeId).toBe('store-001')
    }
  })

  it('recupera la sesión almacenada', async () => {
    await startCashierSession('LIC-001', 'store-001', 'user-001')
    const session = getStoredCashierSession()
    expect(session).not.toBeNull()
    expect(session?.storeId).toBe('store-001')
  })

  it('cierra la sesión correctamente', async () => {
    await startCashierSession('LIC-001', 'store-001', 'user-001')
    await endCashierSession('LIC-001', 'store-001')
    const session = getStoredCashierSession()
    expect(session).toBeNull()
  })
})

describe('CashierSession — modo producción', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'production'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('bloquea si ya hay una cajera activa en ese local', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        cashier_session_expires: { toDate: () => futureDate },
      }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await startCashierSession('LIC-001', 'store-001', 'user-002')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/cajera con sesión activa/)
  })

  it('inicia sesión si no hay sesión activa', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
    } as unknown as Awaited<ReturnType<typeof getDoc>>)
    vi.mocked(setDoc).mockResolvedValue(undefined)

    const result = await startCashierSession('LIC-001', 'store-001', 'user-001')
    expect(result.ok).toBe(true)
    expect(setDoc).toHaveBeenCalled()
  })

  it('cierra sesión llamando deleteDoc en Firestore', async () => {
    vi.mocked(deleteDoc).mockResolvedValue(undefined)
    await endCashierSession('LIC-001', 'store-001')
    expect(deleteDoc).toHaveBeenCalled()
  })
})

describe('AdminSession — modo sandbox', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'sandbox'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('login admin en sandbox siempre retorna ok', async () => {
    const result = await loginAdmin('admin@test.com', 'any-password')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.session.uid).toBe('sandbox-admin-uid')
  })

  it('recupera sesión admin almacenada', async () => {
    await loginAdmin('admin@test.com', 'pwd')
    const session = getStoredAdminSession()
    expect(session).not.toBeNull()
    expect(session?.email).toBe('admin@test.com')
  })

  it('logout elimina la sesión', async () => {
    await loginAdmin('admin@test.com', 'pwd')
    await logoutAdmin()
    const session = getStoredAdminSession()
    expect(session).toBeNull()
  })
})

describe('AdminSession — modo producción', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'production'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('retorna error con credenciales incorrectas', async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
      new Error('auth/wrong-password')
    )

    const result = await loginAdmin('admin@test.com', 'wrong')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Credenciales incorrectas/)
  })

  it('retorna ok con credenciales correctas', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'real-admin-uid', email: 'admin@test.com', getIdToken: vi.fn() },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)

    const result = await loginAdmin('admin@test.com', 'correct-password')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.session.uid).toBe('real-admin-uid')
  })
})
