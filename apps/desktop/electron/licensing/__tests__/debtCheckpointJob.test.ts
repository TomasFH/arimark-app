/**
 * Tests del job de checkpoint: lease, worklist filtrado, tope de pasadas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDoc = vi.fn()
const mockGetDocs = vi.fn()
const mockRunTransaction = vi.fn()
const mockAdvance = vi.fn()

vi.mock('firebase/firestore', () => {
  class Timestamp {
    seconds: number
    nanoseconds: number
    constructor(seconds: number, nanoseconds: number) {
      this.seconds = seconds
      this.nanoseconds = nanoseconds
    }
    static fromMillis(ms: number) {
      return new Timestamp(Math.floor(ms / 1000), 0)
    }
  }
  return {
    getFirestore: vi.fn(() => ({})),
    collection: vi.fn(() => ({})),
    doc: vi.fn(() => ({ path: 'job' })),
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

vi.mock('../debtCheckpoint', () => ({
  advanceDebtCheckpoint: (...args: unknown[]) => mockAdvance(...args),
}))

vi.mock('../../secureStorage', () => ({
  getSecret: vi.fn(() => 'pc-1'),
  SECRET_KEYS: { FIREBASE_ANON_UID: 'firebase-anon-uid' },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { Timestamp } from 'firebase/firestore'
import { runDebtCheckpointJob } from '../debtCheckpointJob'
import { CHECKPOINT_SAFETY_MS } from '@carniceria/shared'

const now = Date.parse('2026-09-04T12:00:00.000Z')
const oldTs = new Timestamp(Math.floor((now - 10 * 24 * 60 * 60 * 1000) / 1000), 0)

describe('runDebtCheckpointJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunTransaction.mockImplementation(async (_db: unknown, fn: (tx: {
      get: () => Promise<unknown>
      set: () => void
    }) => Promise<unknown>) => {
      const tx = {
        get: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
        set: vi.fn(),
      }
      return fn(tx)
    })
  })

  it('no mete en el worklist un tail de los últimos 5 días', async () => {
    const recent = new Timestamp(Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 1000), 0)
    expect(now - recent.seconds * 1000).toBeLessThan(CHECKPOINT_SAFETY_MS)

    mockGetDocs.mockResolvedValue({
      size: 1,
      docs: [{
        data: () => ({
          kind: 'provider',
          entityId: 'prov-1',
          storeId: 'store-1',
          firstEventAt: recent,
          lastEventAt: recent,
        }),
      }],
    })
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined })

    const result = await runDebtCheckpointJob({
      tenantId: 't1',
      holderId: 'pc-1',
      nowMs: now,
      firestore: {} as never,
    })

    expect(result.status).toBe('noop')
    expect(result.pendingPairs).toBe(0)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('corta el worklist al llegar al tope de lecturas y deja el resto para la próxima corrida', async () => {
    mockGetDocs.mockResolvedValue({
      size: 3,
      docs: [
        {
          data: () => ({
            kind: 'provider',
            entityId: 'prov-1',
            storeId: 'store-1',
            firstEventAt: oldTs,
            lastEventAt: oldTs,
          }),
        },
        {
          data: () => ({
            kind: 'provider',
            entityId: 'prov-2',
            storeId: 'store-1',
            firstEventAt: oldTs,
            lastEventAt: oldTs,
          }),
        },
        {
          data: () => ({
            kind: 'customer',
            entityId: 'cust-1',
            storeId: 'store-1',
            firstEventAt: oldTs,
            lastEventAt: oldTs,
          }),
        },
      ],
    })
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined })

    const result = await runDebtCheckpointJob({
      tenantId: 't1',
      holderId: 'pc-1',
      nowMs: now,
      firestore: {} as never,
      maxPasses: 8,
      maxReads: 4,
    })

    expect(result.capped).toBe(true)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('compacta un par pendiente y respeta el tope de pasadas', async () => {
    mockGetDocs
      .mockResolvedValueOnce({
        size: 1,
        docs: [{
          data: () => ({
            kind: 'provider',
            entityId: 'prov-1',
            storeId: 'store-1',
            firstEventAt: oldTs,
            lastEventAt: oldTs,
          }),
        }],
      })
      .mockResolvedValueOnce({ empty: false, size: 1, docs: [{ id: 'e1' }] })

    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined })
    mockAdvance.mockResolvedValue({
      status: 'advanced',
      folded: 400,
      reads: 800,
      checkpoint: { saldoAcumulado: 1 },
    })

    const result = await runDebtCheckpointJob({
      tenantId: 't1',
      holderId: 'pc-1',
      nowMs: now,
      firestore: {} as never,
      maxPasses: 1,
      maxReads: 4000,
    })

    expect(result.status).toBe('ran')
    expect(result.passes).toBe(1)
    expect(result.folded).toBe(400)
    expect(result.capped).toBe(true)
    expect(mockAdvance).toHaveBeenCalledTimes(1)
  })

  it('salta si otra PC tiene el lease vigente', async () => {
    mockRunTransaction.mockImplementationOnce(async () => ({ ok: false, reason: 'lease-held' }))

    const result = await runDebtCheckpointJob({
      tenantId: 't1',
      holderId: 'pc-2',
      nowMs: now,
      firestore: {} as never,
    })

    expect(result.status).toBe('lease-held')
    expect(mockAdvance).not.toHaveBeenCalled()
  })
})
