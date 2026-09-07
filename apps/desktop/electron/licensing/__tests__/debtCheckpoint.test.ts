/**
 * Tests de advanceDebtCheckpoint: query fuera del tx + revalidación adentro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDoc = vi.fn()
const mockGetDocs = vi.fn()
const mockRunTransaction = vi.fn()
const mockTxSet = vi.fn()

vi.mock('firebase/firestore', () => {
  class Timestamp {
    seconds: number
    nanoseconds: number
    constructor(seconds: number, nanoseconds: number) {
      this.seconds = seconds
      this.nanoseconds = nanoseconds
    }
  }
  return {
    getFirestore: vi.fn(() => ({})),
    collection: vi.fn(() => ({})),
    doc: vi.fn(() => ({ path: 'checkpoint' })),
    query: vi.fn((_col: unknown, ...rest: unknown[]) => rest),
    where: vi.fn((...args: unknown[]) => args),
    orderBy: vi.fn((...args: unknown[]) => args),
    limit: vi.fn((n: number) => n),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    Timestamp,
  }
})

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

import { Timestamp } from 'firebase/firestore'
import { advanceDebtCheckpoint, CheckpointConflictError } from '../debtCheckpoint'
import { CHECKPOINT_SAFETY_MS, msToTsRank } from '@carniceria/shared'

const now = Date.parse('2026-09-04T12:00:00.000Z')
const oldTs = new Timestamp(Math.floor((now - 10 * 24 * 60 * 60 * 1000) / 1000), 0)

type EventPayload = {
  createdAtServer: Timestamp
  type: 'debt' | 'payment'
  amount: number
  deleted?: boolean
  providerId: string
  storeId: string
}

function eventSnap(id: string, amount: number, type: 'debt' | 'payment' = 'debt') {
  const payload: EventPayload = {
    createdAtServer: oldTs,
    type,
    amount,
    deleted: false,
    providerId: 'prov-1',
    storeId: 'store-1',
  }
  return {
    id,
    ref: { id },
    data: (): EventPayload => payload,
    exists: (): boolean => true,
  }
}

function missingSnap() {
  return {
    exists: (): boolean => false,
    data: (): undefined => undefined,
  }
}

type Tx = {
  get: (ref: unknown) => Promise<unknown>
  set: (...args: unknown[]) => void
}

describe('advanceDebtCheckpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('noop si no hay eventos compactables', async () => {
    mockGetDoc.mockResolvedValue(missingSnap())
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] })

    const result = await advanceDebtCheckpoint({
      tenantId: 't1',
      kind: 'provider',
      entityId: 'prov-1',
      storeId: 'store-1',
      nowMs: now,
      firestore: {} as never,
    })

    expect(result.status).toBe('noop')
    expect(mockRunTransaction).not.toHaveBeenCalled()
  })

  it('en la transacción suma eventos y escribe saldoAcumulado + checkpointAt', async () => {
    mockGetDoc.mockResolvedValue(missingSnap())
    const e1 = eventSnap('e1', 1000, 'debt')
    mockGetDocs.mockResolvedValue({ empty: false, docs: [e1] })

    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: Tx) => Promise<unknown>) => {
      const tx: Tx = {
        get: async (ref: unknown) => {
          const r = ref as { id?: string }
          if (ref === e1.ref || r.id === 'e1') return e1
          return missingSnap()
        },
        set: mockTxSet,
      }
      return fn(tx)
    })

    const result = await advanceDebtCheckpoint({
      tenantId: 't1',
      kind: 'provider',
      entityId: 'prov-1',
      storeId: 'store-1',
      nowMs: now,
      firestore: {} as never,
    })

    expect(result.status).toBe('advanced')
    if (result.status !== 'advanced') return
    expect(result.checkpoint.saldoAcumulado).toBe(1000)
    expect(result.folded).toBe(1)
    expect(result.checkpoint.checkpointAt).toEqual(msToTsRank(oldTs.seconds * 1000))
    expect(mockTxSet).toHaveBeenCalled()
    const payload = mockTxSet.mock.calls[0]?.[1] as { saldoAcumulado: number; checkpointAt: Timestamp }
    expect(payload.saldoAcumulado).toBe(1000)
    expect(payload.checkpointAt).toBeInstanceOf(Timestamp)
  })

  it('no pliega si el evento cae dentro de los 5 días de margen', async () => {
    const recent = new Timestamp(Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 1000), 0)
    expect(now - recent.seconds * 1000).toBeLessThan(CHECKPOINT_SAFETY_MS)

    mockGetDoc.mockResolvedValue(missingSnap())
    const payload: EventPayload = {
      createdAtServer: recent,
      type: 'debt',
      amount: 50,
      providerId: 'prov-1',
      storeId: 'store-1',
    }
    const e1 = {
      id: 'e-recent',
      ref: { id: 'e-recent' },
      data: (): EventPayload => payload,
      exists: (): boolean => true,
    }
    mockGetDocs.mockResolvedValue({ empty: false, docs: [e1] })

    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: Tx) => Promise<unknown>) => {
      const tx: Tx = {
        get: async () => e1,
        set: mockTxSet,
      }
      return fn(tx)
    })

    const result = await advanceDebtCheckpoint({
      tenantId: 't1',
      kind: 'provider',
      entityId: 'prov-1',
      storeId: 'store-1',
      nowMs: now,
      firestore: {} as never,
    })

    expect(result.status).toBe('noop')
    expect(mockTxSet).not.toHaveBeenCalled()
  })

  it('si otro writer movió el checkpoint, relanza la transacción como conflicto', async () => {
    mockGetDoc.mockResolvedValue(missingSnap())
    const e1 = eventSnap('e1', 100)
    mockGetDocs.mockResolvedValue({ empty: false, docs: [e1] })

    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: Tx) => Promise<unknown>) => {
      const tx: Tx = {
        get: async () => ({
          exists: (): boolean => true,
          data: () => ({
            saldoAcumulado: 5,
            checkpointAt: { seconds: 1, nanoseconds: 0 },
            foldedCount: 1,
          }),
        }),
        set: mockTxSet,
      }
      return fn(tx)
    })

    await expect(advanceDebtCheckpoint({
      tenantId: 't1',
      kind: 'provider',
      entityId: 'prov-1',
      storeId: 'store-1',
      nowMs: now,
      firestore: {} as never,
    })).rejects.toBeInstanceOf(CheckpointConflictError)

    expect(mockTxSet).not.toHaveBeenCalled()
  })
})
