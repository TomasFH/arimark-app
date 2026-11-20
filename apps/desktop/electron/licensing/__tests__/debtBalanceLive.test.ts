/**
 * La deuda de ahora lee la caché que el login ya escucha.
 * getLiveCustomerPairs no pide documentos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockOnSnapshot, mockGetDocs } = vi.hoisted(() => ({
  mockOnSnapshot: vi.fn(),
  mockGetDocs: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, ...parts: string[]) => parts.join('/')),
  query: vi.fn((col: unknown) => col),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: mockOnSnapshot,
  getDocs: mockGetDocs,
  Timestamp: class Timestamp {
    seconds: number
    nanoseconds: number
    constructor(seconds: number, nanoseconds: number) {
      this.seconds = seconds
      this.nanoseconds = nanoseconds
    }
  },
}))

vi.mock('../customerDebtSync', () => ({
  applyRemoteCustomerDebtEvent: vi.fn(),
}))

vi.mock('../providerSync', () => ({
  applyRemoteProviderDebtEvent: vi.fn(),
}))

import { storeLiveFiadoBalance } from '@carniceria/shared'
import { getLiveCustomerPairs, startDebtBalanceLiveSync, stopDebtBalanceLiveSync } from '../debtBalanceLive'

type Snap = { docs: Array<{ id: string; data: () => Record<string, unknown> }> }
type SnapFn = (snap: Snap) => void

describe('getLiveCustomerPairs', () => {
  const callbacks = new Map<string, SnapFn>()

  beforeEach(() => {
    callbacks.clear()
    mockGetDocs.mockReset()
    mockOnSnapshot.mockReset()
    mockOnSnapshot.mockImplementation((target: unknown, cb: SnapFn) => {
      callbacks.set(String(target), cb)
      return vi.fn()
    })
  })

  afterEach(() => {
    stopDebtBalanceLiveSync()
  })

  it('arma el saldo con lo que el listener ya guardó, sin leer de nuevo', () => {
    startDebtBalanceLiveSync('tenant', {} as never)
    expect(getLiveCustomerPairs()).toEqual([])

    const provider = callbacks.get('licenses/tenant/providerDebtCheckpoints')
    const customer = callbacks.get('licenses/tenant/customerDebtCheckpoints')
    expect(provider).toBeTypeOf('function')
    expect(customer).toBeTypeOf('function')

    provider?.({
      docs: [{
        id: 'prov__store-001',
        data: () => ({
          entityId: 'prov',
          storeId: 'store-001',
          saldoAcumulado: 99_000,
          foldedCount: 1,
        }),
      }],
    })
    expect(getLiveCustomerPairs()).toEqual([])

    const listensBefore = mockOnSnapshot.mock.calls.length
    customer?.({
      docs: [{
        id: 'c1__store-001',
        data: () => ({
          entityId: 'c1',
          storeId: 'store-001',
          saldoAcumulado: 10_000,
          checkpointAt: { seconds: 50, nanoseconds: 0 },
          foldedCount: 1,
        }),
      }],
    })
    const tail = [...callbacks.keys()].find(key => key.includes('customerDebtEvents'))
    expect(tail).toBeTruthy()
    callbacks.get(tail ?? '')?.({
      docs: [{
        id: 'pago',
        data: () => ({
          customerId: 'c1',
          storeId: 'store-001',
          eventType: 'partial_payment',
          amount: 3_000,
          createdAtServer: { seconds: 80, nanoseconds: 0 },
          createdAt: '2026-11-01T12:00:00.000Z',
        }),
      }],
    })

    const pairs = getLiveCustomerPairs()
    expect(storeLiveFiadoBalance('store-001', pairs)).toBe(7_000)
    expect(mockGetDocs).not.toHaveBeenCalled()
    expect(mockOnSnapshot.mock.calls.length).toBe(listensBefore + 1)
  })
})
