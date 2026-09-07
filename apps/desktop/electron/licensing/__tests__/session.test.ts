import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
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
    ADMIN_SESSION_TOKEN: 'admin-session-token',
    LAST_LICENSE_VERIFIED_AT: 'last-license-verified-at',
    FIREBASE_ANON_UID: 'firebase-anon-uid',
  },
}))

import { getDoc } from 'firebase/firestore'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { signInWithRole, signInAutoDetect, loginAdmin, logoutAdmin, getStoredAdminSession } from '../session'

describe('signInWithRole — modo dev', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'dev'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('acepta cualquier credencial y fabrica un perfil determinístico', async () => {
    const result = await signInWithRole('LIC-001', 'cajera1@dev.local', 'cualquier-cosa', 'cashier')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile.uid).toBe('dev-cashier-cajera1@dev.local')
      expect(result.profile.role).toBe('cashier')
      expect(result.profile.active).toBe(true)
    }
  })

  it('fabrica perfiles distintos para cashier y admin con el mismo email', async () => {
    const cashier = await signInWithRole('LIC-001', 'x@dev.local', 'pw', 'cashier')
    const admin = await signInWithRole('LIC-001', 'x@dev.local', 'pw', 'admin')
    expect(cashier.ok && cashier.profile.uid).not.toBe(admin.ok && admin.profile.uid)
  })
})

describe('signInWithRole — modo producción', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'production'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('rechaza si Firebase Auth falla (credenciales o red)', async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(new Error('auth/wrong-password'))

    const result = await signInWithRole('LIC-001', 'cajera1@negocio.com', 'wrong', 'cashier')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Credenciales incorrectas/)
  })

  it('rechaza si no existe el perfil en Firestore', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-001', email: 'cajera1@negocio.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await signInWithRole('LIC-001', 'cajera1@negocio.com', 'pw', 'cashier')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no autorizado/i)
  })

  it('rechaza si el perfil está inactivo', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-001', email: 'cajera1@negocio.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'cashier', authorizedStores: ['store-1'], displayName: 'Cajera', active: false }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await signInWithRole('LIC-001', 'cajera1@negocio.com', 'pw', 'cashier')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/desactivado/i)
  })

  it('rechaza si el rol del perfil no coincide con el esperado', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-001', email: 'cajera1@negocio.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'admin', authorizedStores: [], displayName: 'Alguien', active: true }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await signInWithRole('LIC-001', 'alguien@negocio.com', 'pw', 'cashier')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/permiso/i)
  })

  it('retorna ok con el perfil resuelto cuando todo es válido', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-001', email: 'cajera1@negocio.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'cashier', authorizedStores: ['store-1', 'store-2'], displayName: 'Cajera Uno', active: true }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await signInWithRole('LIC-001', 'cajera1@negocio.com', 'pw', 'cashier')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile.uid).toBe('uid-001')
      expect(result.profile.authorizedStores).toEqual(['store-1', 'store-2'])
      expect(result.profile.displayName).toBe('Cajera Uno')
    }
  })

  it('signInAutoDetect rechaza rol butcher con mensaje de celular', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-carn', email: 'carn@negocio.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'butcher', authorizedStores: ['store-1'], displayName: 'Juan', active: true }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await signInAutoDetect('LIC-001', 'carn@negocio.com', 'pw')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/celular/i)
  })

  it('si displayName viene vacío usa el local-part del email', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-001', email: 'cajera.prueba@negocio.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'cashier', authorizedStores: ['store-1'], displayName: '  ', active: true }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await signInWithRole('LIC-001', 'cajera.prueba@negocio.com', 'pw', 'cashier')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.profile.displayName).toBe('cajera.prueba')
  })
})

describe('loginAdmin / AdminSession — modo dev', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'dev'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('login admin en dev siempre retorna ok', async () => {
    const result = await loginAdmin('LIC-001', 'admin@test.com', 'any-password')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.session.uid).toBe('dev-admin-admin@test.com')
  })

  it('recupera sesión admin almacenada', async () => {
    await loginAdmin('LIC-001', 'admin@test.com', 'pwd')
    const session = getStoredAdminSession()
    expect(session).not.toBeNull()
    expect(session?.email).toBe('admin@test.com')
  })

  it('logout elimina la sesión', async () => {
    await loginAdmin('LIC-001', 'admin@test.com', 'pwd')
    await logoutAdmin()
    const session = getStoredAdminSession()
    expect(session).toBeNull()
  })
})

describe('loginAdmin — modo producción', () => {
  beforeEach(() => {
    process.env['APP_ENV'] = 'production'
    secretStore.clear()
    vi.clearAllMocks()
  })

  it('retorna error con credenciales incorrectas', async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(new Error('auth/wrong-password'))

    const result = await loginAdmin('LIC-001', 'admin@test.com', 'wrong')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Credenciales incorrectas/)
  })

  it('retorna error si el perfil no tiene rol admin', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-002', email: 'cajera@test.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'cashier', authorizedStores: ['store-1'], displayName: 'Cajera', active: true }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await loginAdmin('LIC-001', 'cajera@test.com', 'correct-password')
    expect(result.ok).toBe(false)
  })

  it('retorna ok con credenciales correctas y perfil admin', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'real-admin-uid', email: 'admin@test.com', getIdToken: vi.fn().mockResolvedValue('tok') },
    } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>)
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ role: 'admin', authorizedStores: [], displayName: 'Admin', active: true }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>)

    const result = await loginAdmin('LIC-001', 'admin@test.com', 'correct-password')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.session.uid).toBe('real-admin-uid')
  })
})
