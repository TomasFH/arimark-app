import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, providers, providerPurchasePrices } from '../../db/schema'

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(),
  isFirebaseAvailable: vi.fn(() => false),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { getDb } from '../../db/client'
import { applyPurchasePrices, localPurchasePrices } from '../merchPurchasePriceSync'

describe('merchPurchasePriceSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    const instance = await createInMemoryDb()
    db = instance.db
    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001', name: 'Ana', storeId: 'store-001', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(providers).values({
      id: 'prov-oso', name: 'Oso', nameKey: 'oso', createdAt: now, createdBy: 'user-001',
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  it('primera vez guarda el costo sin pedir confirmación', () => {
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:maple', name: 'Maple', costUnit: 'pack', unitCost: 9000 }],
      acceptPriceUpdates: false,
      now: new Date().toISOString(),
    })
    expect(localPurchasePrices('prov-oso')[0]?.unitCost).toBe(9000)
  })

  it('si no acepta, no pisa el último costo', () => {
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:maple', name: 'Maple', costUnit: 'pack', unitCost: 9000 }],
      acceptPriceUpdates: true,
      now: '2026-09-17T10:00:00.000Z',
    })
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:maple', name: 'Maple', costUnit: 'pack', unitCost: 11000 }],
      acceptPriceUpdates: false,
      now: '2026-09-17T11:00:00.000Z',
    })
    expect(localPurchasePrices('prov-oso')[0]?.unitCost).toBe(9000)
    expect(db.select().from(providerPurchasePrices).all()).toHaveLength(1)
  })

  it('si acepta, actualiza el último costo', () => {
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:maple', name: 'Maple', costUnit: 'pack', unitCost: 9000 }],
      acceptPriceUpdates: true,
      now: '2026-09-17T10:00:00.000Z',
    })
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:maple', name: 'Maple', costUnit: 'pack', unitCost: 11000 }],
      acceptPriceUpdates: true,
      now: '2026-09-17T11:00:00.000Z',
    })
    expect(localPurchasePrices('prov-oso')[0]?.unitCost).toBe(11000)
  })

  it('recuerda equivalencia y pesada, y no las pisa si no se aceptan', () => {
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{
        productKey: 'p:pollo',
        name: 'Pollo',
        costUnit: 'pack',
        unitCost: 9000,
        packContents: 1,
        weighMode: 'each',
      }],
      acceptPriceUpdates: true,
      now: '2026-10-12T10:00:00.000Z',
    })
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{
        productKey: 'p:pollo',
        name: 'Pollo',
        costUnit: 'pack',
        unitCost: 9500,
        packContents: null,
        weighMode: 'total',
      }],
      acceptPriceUpdates: false,
      now: '2026-10-12T11:00:00.000Z',
    })
    const kept = localPurchasePrices('prov-oso').find(r => r.productKey === 'p:pollo')
    expect(kept?.unitCost).toBe(9000)
    expect(kept?.weighMode).toBe('each')
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{
        productKey: 'p:pollo',
        name: 'Pollo',
        costUnit: 'pack',
        unitCost: 9500,
        packContents: null,
        weighMode: 'total',
      }],
      acceptPriceUpdates: true,
      now: '2026-10-12T12:00:00.000Z',
    })
    const next = localPurchasePrices('prov-oso').find(r => r.productKey === 'p:pollo')
    expect(next?.unitCost).toBe(9500)
    expect(next?.weighMode).toBe('total')
  })

  it('guarda centavos del unitario y no reescala un entero', () => {
    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:bondiola', name: 'Bondiola', costUnit: 'kg', unitCost: 4800.5 }],
      acceptPriceUpdates: true,
      now: '2026-10-11T10:00:00.000Z',
    })
    expect(localPurchasePrices('prov-oso').find(r => r.productKey === 'p:bondiola')?.unitCost).toBe(4800.5)

    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:bondiola', name: 'Bondiola', costUnit: 'kg', unitCost: 4800.5 + 1e-10 }],
      acceptPriceUpdates: false,
      now: '2026-10-11T11:00:00.000Z',
    })
    expect(localPurchasePrices('prov-oso').find(r => r.productKey === 'p:bondiola')?.unitCost).toBe(4800.5)

    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:maple', name: 'Maple', costUnit: 'pack', unitCost: 9000 }],
      acceptPriceUpdates: true,
      now: '2026-10-11T12:00:00.000Z',
    })
    expect(localPurchasePrices('prov-oso').find(r => r.productKey === 'p:maple')?.unitCost).toBe(9000)

    applyPurchasePrices(db as unknown as ReturnType<typeof getDb>, {
      providerId: 'prov-oso',
      lines: [{ productKey: 'p:maple', name: 'Maple', costUnit: 'pack', unitCost: 9000.405 }],
      acceptPriceUpdates: true,
      now: '2026-10-11T13:00:00.000Z',
    })
    expect(localPurchasePrices('prov-oso').find(r => r.productKey === 'p:maple')?.unitCost).toBe(9000.41)
  })
})
