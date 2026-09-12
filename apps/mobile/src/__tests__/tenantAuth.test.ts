import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth'
import { getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { isOnline } from '../lib/connectivity'
import {
  createTenantAuthUser,
  grantButcherAccess,
  reactivateTenantUser,
  revokeButcherAccess,
} from '../lib/tenantAuth'
import { OFFLINE_ACCOUNT_MESSAGE } from '../lib/tenantAuthLogic'

vi.mock('../lib/connectivity', () => ({
  isOnline: vi.fn(async () => true),
}))

function snap(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    empty: docs.length === 0,
    docs: docs.map(d => ({ id: d.id, data: () => d.data })),
  }
}

describe('tenantAuth — IO', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isOnline).mockResolvedValue(true)
  })

  it('createTenantAuthUser pide internet', async () => {
    vi.mocked(isOnline).mockResolvedValue(false)
    const res = await createTenantAuthUser({
      email: 'ana@x.com',
      displayName: 'Ana',
      role: 'cashier',
      authorizedStores: ['s1'],
    })
    expect(res).toEqual({ ok: false, error: OFFLINE_ACCOUNT_MESSAGE, code: 'UNAVAILABLE' })
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('createTenantAuthUser crea Auth en app secundaria, perfil y manda mail', async () => {
    const deleteUser = vi.fn()
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-new', delete: deleteUser },
    } as never)
    vi.mocked(setDoc).mockResolvedValue(undefined as never)
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined as never)
    vi.mocked(signOut).mockResolvedValue(undefined as never)

    const res = await createTenantAuthUser({
      email: 'ana@x.com',
      displayName: 'Ana',
      role: 'cashier',
      authorizedStores: ['s1'],
    })

    expect(res).toEqual({ ok: true, data: { uid: 'uid-new' } })
    expect(setDoc).toHaveBeenCalled()
    expect(sendPasswordResetEmail).toHaveBeenCalled()
    expect(signOut).toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('createTenantAuthUser hace rollback de Auth si Firestore falla', async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-new', delete: deleteUser },
    } as never)
    vi.mocked(setDoc).mockRejectedValue(new Error('PERMISSION_DENIED'))
    vi.mocked(signOut).mockResolvedValue(undefined as never)

    const res = await createTenantAuthUser({
      email: 'ana@x.com',
      displayName: 'Ana',
      role: 'cashier',
      authorizedStores: ['s1'],
    })

    expect(res.ok).toBe(false)
    expect(deleteUser).toHaveBeenCalled()
    expect(signOut).toHaveBeenCalled()
  })

  it('createTenantAuthUser detecta cuenta huérfana', async () => {
    vi.mocked(createUserWithEmailAndPassword).mockRejectedValue({ code: 'auth/email-already-in-use' })
    vi.mocked(getDocs).mockResolvedValue(snap([]) as never)

    const res = await createTenantAuthUser({
      email: 'ana@x.com',
      displayName: 'Ana',
      role: 'cashier',
      authorizedStores: ['s1'],
    })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('ORPHANED_AUTH_USER')
  })

  it('reactivateTenantUser marca active y reatacha employeeId', async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never)
    const res = await reactivateTenantUser({
      uid: 'uid-1',
      displayName: 'Juan',
      employeeId: 'emp-1',
    })
    expect(res.ok).toBe(true)
    expect(updateDoc).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        active: true,
        deleted: false,
        employeeId: 'emp-1',
        displayName: 'Juan',
      }),
    )
  })

  it('grantButcherAccess sin cuenta previa pide EMAIL_REQUIRED', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap([]) as never)
    const res = await grantButcherAccess({
      employeeId: 'emp-1',
      displayName: 'Juan',
      kind: 'butcher',
      firebaseUid: null,
      homeStoreId: null,
      authorizedStores: ['s1'],
    })
    expect(res).toMatchObject({ ok: false, code: 'EMAIL_REQUIRED' })
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('grantButcherAccess con email crea la cuenta y guarda firebaseUid', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap([]) as never)
    const deleteUser = vi.fn()
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'uid-new', delete: deleteUser },
    } as never)
    vi.mocked(setDoc).mockResolvedValue(undefined as never)
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined as never)
    vi.mocked(signOut).mockResolvedValue(undefined as never)
    vi.mocked(updateDoc).mockResolvedValue(undefined as never)

    const res = await grantButcherAccess({
      employeeId: 'emp-1',
      displayName: 'Juan',
      kind: 'butcher',
      firebaseUid: null,
      homeStoreId: 's1',
      authorizedStores: ['s1'],
      email: 'carn@x.com',
    })

    expect(res).toEqual({ ok: true, data: { uid: 'uid-new' } })
    expect(createUserWithEmailAndPassword).toHaveBeenCalled()
    expect(setDoc).toHaveBeenCalled()
    expect(updateDoc).toHaveBeenCalled()
  })

  it('grantButcherAccess restablece por employeeId y guarda firebaseUid', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap([
      { id: 'uid-old', data: { role: 'butcher', active: false, email: 'c@c.com', employeeId: 'emp-1' } },
    ]) as never)
    vi.mocked(updateDoc).mockResolvedValue(undefined as never)

    const res = await grantButcherAccess({
      employeeId: 'emp-1',
      displayName: 'Juan',
      kind: 'butcher',
      firebaseUid: null,
      homeStoreId: null,
      authorizedStores: ['s1'],
    })

    expect(res).toEqual({ ok: true, data: { uid: 'uid-old' } })
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled()
    expect(updateDoc).toHaveBeenCalled()
  })

  it('revokeButcherAccess no limpia firebaseUid si falla el update del usuario', async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
    const res = await revokeButcherAccess({ employeeId: 'emp-1', firebaseUid: 'uid-1' })
    expect(res).toMatchObject({ ok: false, code: 'FIRESTORE_ERROR' })
    expect(updateDoc).toHaveBeenCalledTimes(1)
  })

  it('revokeButcherAccess desactiva y limpia firebaseUid', async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never)
    const res = await revokeButcherAccess({ employeeId: 'emp-1', firebaseUid: 'uid-1' })
    expect(res.ok).toBe(true)
    expect(updateDoc).toHaveBeenCalledTimes(2)
  })
})
