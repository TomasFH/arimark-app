import { describe, it, expect, beforeEach } from 'vitest'
import { preferredStoreIdFrom, readLastStoreId, writeLastStoreId, lastStoreStorageKey } from '../lastStore'

describe('lastStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('lee y escribe el último local de este usuario', () => {
    expect(readLastStoreId('u1')).toBeNull()
    writeLastStoreId('u1', 's-centro')
    expect(readLastStoreId('u1')).toBe('s-centro')
    expect(localStorage.getItem(lastStoreStorageKey('u1'))).toBe('s-centro')
    expect(readLastStoreId('u2')).toBeNull()
  })

  it('preferredStoreIdFrom ignora un id que ya no está activo', () => {
    const stores = [{ id: 's1' }, { id: 's2' }]
    expect(preferredStoreIdFrom(stores, 's1')).toBe('s1')
    expect(preferredStoreIdFrom(stores, 's-archivado')).toBeNull()
    expect(preferredStoreIdFrom(stores, null)).toBeNull()
  })
})
