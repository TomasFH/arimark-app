import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((...args: unknown[]) => args),
  getDocs: vi.fn(),
  doc: vi.fn(),
  updateDoc: vi.fn(),
}))

import { getDocs, updateDoc } from 'firebase/firestore'
import {
  findTenantUserByEmployeeId,
  findTenantUserByEmail,
  reactivateTenantUser,
  sameStoreIdSet,
  syncButcherAuthorizedStores,
} from '../tenantAuth'

function snap(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    empty: docs.length === 0,
    docs: docs.map(d => ({ id: d.id, data: () => d.data })),
  }
}

describe('tenantAuth — reactivar acceso', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('findTenantUserByEmployeeId elige el butcher inactivo', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap([
      { id: 'uid-on', data: { role: 'butcher', active: true, email: 'a@a.com' } },
      { id: 'uid-off', data: { role: 'butcher', active: false, email: 'b@b.com' } },
    ]) as never)

    const found = await findTenantUserByEmployeeId('lic', 'emp-1')
    expect(found?.uid).toBe('uid-off')
    expect(found?.active).toBe(false)
  })

  it('findTenantUserByEmail ignora cuentas que no son butcher', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap([
      { id: 'uid-c', data: { role: 'cashier', email: 'x@x.com', active: false } },
    ]) as never)

    await expect(findTenantUserByEmail('lic', 'x@x.com')).resolves.toBeNull()
  })

  it('reactivateTenantUser marca active true y reatacha employeeId', async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never)
    const res = await reactivateTenantUser({
      licenseKey: 'lic',
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
})

describe('syncButcherAuthorizedStores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trata la misma lista en otro orden como igual', () => {
    expect(sameStoreIdSet(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(sameStoreIdSet(['a'], ['a', 'b'])).toBe(false)
  })

  it('agrega el local nuevo a la cuenta del carnicero y no toca una lista ya completa', async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never)
    vi.mocked(getDocs).mockResolvedValue(snap([
      { id: 'uid-viejo', data: { role: 'butcher', active: true, authorizedStores: ['san-martin'] } },
      { id: 'uid-al-dia', data: { role: 'butcher', active: true, authorizedStores: ['camarones', 'san-martin'] } },
      { id: 'uid-off', data: { role: 'butcher', active: false, authorizedStores: ['san-martin'] } },
    ]) as never)

    const updated = await syncButcherAuthorizedStores('lic', ['camarones', 'san-martin'])

    expect(updated).toBe(1)
    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(updateDoc).toHaveBeenCalledWith(
      undefined,
      { authorizedStores: ['camarones', 'san-martin'] },
    )
  })
})
