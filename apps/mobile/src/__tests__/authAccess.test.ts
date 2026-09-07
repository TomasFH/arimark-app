import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { getDocFromServer, onSnapshot } from 'firebase/firestore'
import { signIn, restoreSession, revalidateProfileAccess, subscribeUserAccess } from '../lib/auth'
import { ACCESS_REVOKED_MESSAGE, ACCESS_UNAUTHORIZED_MESSAGE } from '../lib/userAccess'
import { db } from '../lib/db'
import type { LocalProfile } from '../types/pos'

const butcherDoc = {
  role: 'butcher',
  active: true,
  displayName: 'Juan',
  authorizedStores: ['s1'],
  employeeId: 'emp-1',
}

function serverSnap(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => data,
  }
}

const cachedProfile: LocalProfile = {
  uid: 'uid-1',
  displayName: 'Juan',
  role: 'butcher',
  authorizedStores: ['s1'],
  email: 'carn@test.com',
  employeeId: 'emp-1',
}

describe('auth — acceso revocado', () => {
  const onlineDesc = Object.getOwnPropertyDescriptor(navigator, 'onLine')

  beforeEach(async () => {
    vi.clearAllMocks()
    await db.profile.clear()
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    vi.mocked(firebaseSignOut).mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (onlineDesc) Object.defineProperty(navigator, 'onLine', onlineDesc)
    else Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
  })

  it('signIn rechaza butcher con active:false, cierra Auth y no cachea', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-1', email: 'carn@test.com' },
    } as never)
    vi.mocked(getDocFromServer).mockResolvedValue(serverSnap({ ...butcherDoc, active: false }) as never)

    const result = await signIn('carn@test.com', 'secret')

    expect(result).toEqual({ ok: false, error: ACCESS_REVOKED_MESSAGE })
    expect(firebaseSignOut).toHaveBeenCalled()
    expect(await db.profile.get('uid-1')).toBeUndefined()
  })

  it('signIn acepta butcher activo y cachea el perfil', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-1', email: 'carn@test.com' },
    } as never)
    vi.mocked(getDocFromServer).mockResolvedValue(serverSnap(butcherDoc) as never)

    const result = await signIn('carn@test.com', 'secret')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.profile.role).toBe('butcher')
    expect(await db.profile.get('uid-1')).toMatchObject({ uid: 'uid-1', role: 'butcher' })
  })

  it('restoreSession con internet no usa el caché si Firestore dice inactive', async () => {
    await db.profile.put(cachedProfile)
    vi.mocked(getDocFromServer).mockResolvedValue(serverSnap({ ...butcherDoc, active: false }) as never)
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, cb) => {
      queueMicrotask(() => {
        void (cb as (user: { uid: string; email: string }) => void)({ uid: 'uid-1', email: 'carn@test.com' })
      })
      return () => {}
    })

    const result = await restoreSession()

    expect(result).toEqual({ ok: false, error: ACCESS_REVOKED_MESSAGE })
    expect(firebaseSignOut).toHaveBeenCalled()
    expect(await db.profile.get('uid-1')).toBeUndefined()
  })

  it('restoreSession offline conserva el perfil cacheado', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await db.profile.put(cachedProfile)
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, cb) => {
      queueMicrotask(() => {
        void (cb as (user: { uid: string; email: string }) => void)({ uid: 'uid-1', email: 'carn@test.com' })
      })
      return () => {}
    })

    const result = await restoreSession()

    expect(result).toEqual({ ok: true, profile: cachedProfile, mode: 'offline' })
    expect(getDocFromServer).not.toHaveBeenCalled()
  })

  it('revalidateProfileAccess cierra sesión si el perfil está desactivado', async () => {
    await db.profile.put(cachedProfile)
    vi.mocked(getDocFromServer).mockResolvedValue(serverSnap({ ...butcherDoc, active: false }) as never)

    await expect(revalidateProfileAccess('uid-1', 'carn@test.com')).resolves.toBe('revoked')
    expect(firebaseSignOut).toHaveBeenCalled()
    expect(await db.profile.get('uid-1')).toBeUndefined()
  })

  it('subscribeUserAccess dispara onRevoked cuando active pasa a false', () => {
    const onRevoked = vi.fn()
    vi.mocked(onSnapshot).mockImplementation((_ref, onNext) => {
      ;(onNext as (snap: { exists: () => boolean; data: () => Record<string, unknown> }) => void)({
        exists: () => true,
        data: () => ({ role: 'butcher', active: false }),
      })
      return () => {}
    })

    subscribeUserAccess('uid-1', onRevoked)
    expect(onRevoked).toHaveBeenCalledTimes(1)
  })

  it('signIn con rol inválido usa el mensaje de no autorizado', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-1', email: 'x@test.com' },
    } as never)
    vi.mocked(getDocFromServer).mockResolvedValue(serverSnap({ role: 'unknown', active: true }) as never)

    const result = await signIn('x@test.com', 'secret')
    expect(result).toEqual({ ok: false, error: ACCESS_UNAUTHORIZED_MESSAGE })
  })
})
