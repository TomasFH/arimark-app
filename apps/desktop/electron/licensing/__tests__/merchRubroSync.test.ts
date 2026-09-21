import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { merchandiseIntakeRubros } from '../../db/schema'
import { isNull } from 'drizzle-orm'

const { mockSetDoc, mockOnSnapshot } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockOnSnapshot: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => ({ path: args.join('/') }),
  setDoc: mockSetDoc,
  collection: vi.fn((...args: unknown[]) => ({ path: args.join('/') })),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  onSnapshot: mockOnSnapshot,
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../../db/client'
import { isFirebaseAvailable } from '../firebase'
import { getDocs } from 'firebase/firestore'
import {
  ensureFactoryMerchRubros,
} from '../merchIntakeDb'
import {
  pushUnsyncedMerchandiseIntakeRubros,
  pullMerchandiseIntakeRubros,
  startMerchRubroSyncListener,
  stopMerchRubroSyncListener,
} from '../merchRubroSync'

const TENANT = 'test-tenant'

describe('merchRubroSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    stopMerchRubroSyncListener()
    const instance = await createInMemoryDb()
    db = instance.db
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  it('pushea rubros con syncedAt=null', async () => {
    await pushUnsyncedMerchandiseIntakeRubros(TENANT)
    expect(mockSetDoc).toHaveBeenCalled()
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'rubro_media_res',
        name: 'Media res',
        template: 'pieces_weight',
        deleted: false,
      }),
      { merge: true },
    )
    const pending = db.select().from(merchandiseIntakeRubros).where(isNull(merchandiseIntakeRubros.syncedAt)).all()
    expect(pending).toHaveLength(0)
  })

  it('no pushea si Firebase no está disponible', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
    await pushUnsyncedMerchandiseIntakeRubros(TENANT)
    expect(mockSetDoc).not.toHaveBeenCalled()
  })

  it('pull upsertea un rubro remoto y no pisa pendientes', async () => {
    ensureFactoryMerchRubros()
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: 'rubro_media_res',
          data: () => ({
            id: 'rubro_media_res',
            name: 'Remoto',
            template: 'pieces_weight',
            sortOrder: 10,
          }),
        },
        {
          id: 'rubro-custom',
          data: () => ({
            id: 'rubro-custom',
            name: 'Huevos',
            template: 'count',
            sortOrder: 200,
          }),
        },
      ],
    } as never)

    await pullMerchandiseIntakeRubros(TENANT)
    const factory = db.select().from(merchandiseIntakeRubros).all().find(r => r.id === 'rubro_media_res')
    expect(factory?.name).toBe('Media res')
    const custom = db.select().from(merchandiseIntakeRubros).all().find(r => r.id === 'rubro-custom')
    expect(custom?.name).toBe('Huevos')
  })

  it('registra onSnapshot una sola vez', () => {
    mockOnSnapshot.mockReturnValue(() => undefined)
    startMerchRubroSyncListener(TENANT)
    startMerchRubroSyncListener(TENANT)
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1)
    stopMerchRubroSyncListener()
  })
})
