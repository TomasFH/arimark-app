import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/adminFirestore', () => ({
  fetchAllStores: vi.fn(),
}))

import { fetchAllStores } from '../lib/adminFirestore'
import {
  loadAuthorizedStoreOptions,
  loadCashierStoreOptions,
  peekAuthorizedStoreOptions,
} from '../lib/cashierStores'

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

  it('loadAuthorizedStoreOptions usa el nombre de Firestore, no el id', async () => {
    vi.mocked(fetchAllStores).mockResolvedValue([
      { id: 'local1', name: 'Local Centro', address: null, archivedAt: null, createdAt: '' },
      { id: 'abc-uuid', name: 'Local Norte', address: null, archivedAt: null, createdAt: '' },
      { id: 'otro', name: 'Otro', address: null, archivedAt: null, createdAt: '' },
    ])
    const stores = await loadAuthorizedStoreOptions(['local1', 'abc-uuid'])
    expect(stores).toEqual([
      { id: 'local1', name: 'Local Centro', morningStart: null, morningEnd: null, afternoonStart: null, afternoonEnd: null, hoursSchedule: null },
      { id: 'abc-uuid', name: 'Local Norte', morningStart: null, morningEnd: null, afternoonStart: null, afternoonEnd: null, hoursSchedule: null },
    ])
  })

  it('loadAuthorizedStoreOptions omite archivados y ids que no existen', async () => {
    vi.mocked(fetchAllStores).mockResolvedValue([
      { id: 'a', name: 'Activo', address: null, archivedAt: null, createdAt: '' },
      { id: 'b', name: 'Archivado', address: null, archivedAt: '2026-01-01', createdAt: '' },
    ])
    const stores = await loadAuthorizedStoreOptions(['a', 'b', 'inexistente'])
    expect(stores).toEqual([{ id: 'a', name: 'Activo', morningStart: null, morningEnd: null, afternoonStart: null, afternoonEnd: null, hoursSchedule: null }])
  })

  it('loadAuthorizedStoreOptions propaga el error si Firestore falla y no hay cache', async () => {
    vi.mocked(fetchAllStores).mockRejectedValue(new Error('offline'))
    await expect(loadAuthorizedStoreOptions(['a'])).rejects.toThrow('No se pudieron cargar los locales.')
  })

  it('loadAuthorizedStoreOptions usa el cache si Firestore falla', async () => {
    vi.mocked(fetchAllStores).mockResolvedValueOnce([
      { id: 'a', name: 'Local Centro', address: null, archivedAt: null, createdAt: '' },
    ])
    await loadCashierStoreOptions([])
    vi.mocked(fetchAllStores).mockRejectedValue(new Error('offline'))
    const stores = await loadAuthorizedStoreOptions(['a'])
    expect(stores).toEqual([{ id: 'a', name: 'Local Centro', morningStart: null, morningEnd: null, afternoonStart: null, afternoonEnd: null, hoursSchedule: null }])
  })

  it('peekAuthorizedStoreOptions lee nombres del cache sin llamar a Firestore', async () => {
    vi.mocked(fetchAllStores).mockResolvedValue([
      { id: 'a', name: 'Local Centro', address: null, archivedAt: null, createdAt: '' },
    ])
    await loadCashierStoreOptions([])
    vi.mocked(fetchAllStores).mockClear()
    expect(peekAuthorizedStoreOptions(['a'])).toEqual([{ id: 'a', name: 'Local Centro', morningStart: null, morningEnd: null, afternoonStart: null, afternoonEnd: null, hoursSchedule: null }])
    expect(fetchAllStores).not.toHaveBeenCalled()
  })
})
