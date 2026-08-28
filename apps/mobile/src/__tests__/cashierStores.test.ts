import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/adminFirestore', () => ({
  fetchAllStores: vi.fn(),
}))

import { fetchAllStores } from '../lib/adminFirestore'
import { loadCashierStoreOptions } from '../lib/cashierStores'

describe('loadCashierStoreOptions', () => {
  beforeEach(() => {
    vi.mocked(fetchAllStores).mockReset()
    localStorage.clear()
  })

  it('usa los locales activos de Firestore y no filtra por authorizedStores', async () => {
    vi.mocked(fetchAllStores).mockResolvedValue([
      { id: 'a', name: 'Local A', address: null, archivedAt: null, createdAt: '' },
      { id: 'b', name: 'Local B', address: null, archivedAt: '2026-01-01', createdAt: '' },
      { id: 'c', name: 'Local C', address: null, archivedAt: null, createdAt: '' },
    ])

    const stores = await loadCashierStoreOptions(['solo-este'])
    expect(stores.map(s => s.id)).toEqual(['a', 'c'])
    expect(stores[0]?.name).toBe('Local A')
  })

  it('cae a authorizedStores si Firestore falla y no hay cache', async () => {
    vi.mocked(fetchAllStores).mockRejectedValue(new Error('offline'))
    const stores = await loadCashierStoreOptions(['local1', 'local2'])
    expect(stores).toEqual([
      { id: 'local1', name: 'local1' },
      { id: 'local2', name: 'local2' },
    ])
  })
})
