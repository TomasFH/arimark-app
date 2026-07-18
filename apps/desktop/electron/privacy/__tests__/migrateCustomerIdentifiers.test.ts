import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { customers, stores, users } from '../../db/schema'

vi.mock('electron-log', () => ({
  default: { info: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../secureStorage', () => ({
  SECRET_KEYS: { CUSTOMER_DATA_ENCRYPTION_KEY: 'customer-data-encryption-key' },
  getSecret: vi.fn(() => Buffer.alloc(32, 9).toString('base64')),
  setSecret: vi.fn(),
}))

import { getDb } from '../../db/client'
import { encryptLegacyCustomerIdentifiers } from '../migrateCustomerIdentifiers'

describe('encryptLegacyCustomerIdentifiers', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    const instance = await createInMemoryDb()
    db = instance.db
    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001', name: 'Cajera', storeId: 'store-001',
      role: 'cashier', active: true, createdAt: now,
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  it('cifra DNI y teléfono históricos y no vuelve a procesarlos', () => {
    const now = new Date().toISOString()
    db.insert(customers).values({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      storeId: 'store-001',
      name: 'Cliente Histórico',
      dni: '12345678',
      phone: '11-1234-5678',
      active: true,
      createdAt: now,
      createdBy: 'user-001',
    }).run()

    encryptLegacyCustomerIdentifiers()
    const migrated = db.select().from(customers).all()[0]
    expect(migrated.dni).toMatch(/^enc:v1:/)
    expect(migrated.phone).toMatch(/^enc:v1:/)

    encryptLegacyCustomerIdentifiers()
    const rerun = db.select().from(customers).all()[0]
    expect(rerun.dni).toBe(migrated.dni)
    expect(rerun.phone).toBe(migrated.phone)
  })
})
