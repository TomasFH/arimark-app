import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { storeTransfers, stores } from '../../db/schema'

const { mockSetDoc, mockGetDoc, mockGetDocs, mockDoc, mockCollection, mockWhere, mockQuery, mockOrderBy, mockLimit, mockOnSnapshot } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockDoc: vi.fn(),
  mockCollection: vi.fn(),
  mockWhere: vi.fn(),
  mockQuery: vi.fn(),
  mockOrderBy: vi.fn(),
  mockLimit: vi.fn(),
  mockOnSnapshot: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: (...args: unknown[]) => {
    mockDoc(...args)
    return { path: args.join('/') }
  },
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  collection: (...args: unknown[]) => {
    mockCollection(...args)
    return { path: args.join('/') }
  },
  query: (...args: unknown[]) => {
    mockQuery(...args)
    return { args }
  },
  where: (...args: unknown[]) => {
    mockWhere(...args)
    return { args }
  },
  orderBy: (...args: unknown[]) => {
    mockOrderBy(...args)
    return { args }
  },
  limit: (...args: unknown[]) => {
    mockLimit(...args)
    return { args }
  },
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
import { pullStoreTransfersForRange, pushUnsyncedStoreTransfers, listStoreTransfersForRange, loadPendingStoreTransfers, clearStoreTransferPullCache } from '../storeTransferSync'

const TENANT = 'test-tenant'
const WHEN = '2026-11-15T03:00:00.000Z'
const NOW = '2026-11-20T15:00:00.000Z'
const START = '2026-11-15T03:00:00.000Z'
const END = '2026-11-22T03:00:00.000Z'

function insertTransfer(
  db: Awaited<ReturnType<typeof createInMemoryDb>>['db'],
  opts: {
    id: string
    syncedAt: string | null
    status?: 'pending' | 'confirmed' | 'cancelled'
    receivedQuantity?: number | null
    hasDifference?: boolean
  },
) {
  db.insert(storeTransfers).values({
    id: opts.id,
    productName: 'Vacío',
    quantity: 4,
    unit: 'kg',
    fromStoreId: 'norte',
    toStoreId: 'sur',
    occurredAt: WHEN,
    notes: null,
    estimatedValue: null,
    status: opts.status ?? 'pending',
    receivedQuantity: opts.receivedQuantity ?? null,
    hasDifference: opts.hasDifference ?? false,
    confirmedAt: opts.status === 'confirmed' ? NOW : null,
    confirmedBy: opts.status === 'confirmed' ? 'ana' : null,
    createdAt: NOW,
    createdBy: 'ana',
    updatedAt: null,
    updatedBy: null,
    syncedAt: opts.syncedAt,
  }).run()
}

function remoteDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      id,
      productName: 'Vacío',
      quantity: 4,
      unit: 'kg',
      fromStoreId: 'norte',
      toStoreId: 'sur',
      occurredAt: WHEN,
      notes: null,
      estimatedValue: null,
      status: 'pending',
      receivedQuantity: null,
      hasDifference: false,
      confirmedAt: null,
      confirmedBy: null,
      createdAt: NOW,
      createdBy: 'ana',
      updatedAt: null,
      updatedBy: null,
      deleted: false,
      ...overrides,
    }),
  }
}

describe('storeTransferSync', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    clearStoreTransferPullCache()
    vi.mocked(isFirebaseAvailable).mockReturnValue(true)
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined })
    mockGetDocs.mockResolvedValue({ docs: [] })
    const instance = await createInMemoryDb()
    db = instance.db
    db.insert(stores).values([
      { id: 'norte', name: 'Norte', createdAt: NOW },
      { id: 'sur', name: 'Sur', createdAt: NOW },
    ]).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
  })

  it('sube solo las filas con syncedAt vacío', async () => {
    insertTransfer(db, { id: 'tr-nueva', syncedAt: null })
    insertTransfer(db, { id: 'tr-ya', syncedAt: NOW })

    await pushUnsyncedStoreTransfers(TENANT)

    expect(mockGetDoc).toHaveBeenCalledTimes(1)
    expect(mockSetDoc).toHaveBeenCalledTimes(1)
    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(),
      'licenses',
      TENANT,
      'storeTransfers',
      'tr-nueva',
    )
    const body = mockSetDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).toMatchObject({
      id: 'tr-nueva',
      status: 'pending',
      fromStoreId: 'norte',
      toStoreId: 'sur',
      deleted: false,
    })
    expect(body).not.toHaveProperty('syncedAt')
    expect(db.select().from(storeTransfers).all().find(row => row.id === 'tr-nueva')?.syncedAt).toEqual(expect.any(String))
    expect(mockOnSnapshot).not.toHaveBeenCalled()
  })

  it('un push tarde no pisa la confirmación remota y baja esa copia', async () => {
    insertTransfer(db, { id: 'tr-tarde', syncedAt: null, status: 'pending' })
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => remoteDoc('tr-tarde', {
        status: 'confirmed',
        receivedQuantity: 3.5,
        hasDifference: true,
        confirmedAt: '2026-11-20T18:00:00.000Z',
        confirmedBy: 'remoto',
        updatedAt: '2026-11-20T18:00:00.000Z',
        updatedBy: 'remoto',
      }).data(),
    })

    await pushUnsyncedStoreTransfers(TENANT)

    expect(mockSetDoc).not.toHaveBeenCalled()
    const row = db.select().from(storeTransfers).all().find(item => item.id === 'tr-tarde')
    expect(row).toMatchObject({
      status: 'confirmed',
      receivedQuantity: 3.5,
      hasDifference: true,
      confirmedBy: 'remoto',
    })
    expect(row?.syncedAt).toEqual(expect.any(String))
  })

  it('baja pendientes y confirmados del rango, sin la colección entera y sin pisar lo no subido', async () => {
    insertTransfer(db, {
      id: 'tr-local',
      syncedAt: null,
      status: 'confirmed',
      receivedQuantity: 2,
      hasDifference: true,
    })
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        remoteDoc('tr-local', {
          status: 'confirmed',
          receivedQuantity: 9,
          confirmedAt: NOW,
          confirmedBy: 'otro',
        }),
        remoteDoc('tr-pendiente', { status: 'pending' }),
        remoteDoc('tr-confirmada', {
          status: 'confirmed',
          receivedQuantity: 4,
          confirmedAt: NOW,
          confirmedBy: 'luis',
        }),
        remoteDoc('tr-cancelada', { status: 'cancelled' }),
      ],
    })

    const count = await pullStoreTransfersForRange(TENANT, START, END)

    expect(count).toBe(3)
    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), 'licenses', TENANT, 'storeTransfers')
    expect(mockWhere).toHaveBeenCalledWith('occurredAt', '>=', START)
    expect(mockWhere).toHaveBeenCalledWith('occurredAt', '<', END)
    expect(mockGetDocs).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockOnSnapshot).not.toHaveBeenCalled()
    expect(mockSetDoc).not.toHaveBeenCalled()

    const local = db.select().from(storeTransfers).all().find(row => row.id === 'tr-local')
    expect(local).toMatchObject({ receivedQuantity: 2, syncedAt: null, confirmedBy: 'ana' })
    expect(db.select().from(storeTransfers).all().map(row => row.id).sort()).toEqual([
      'tr-cancelada',
      'tr-confirmada',
      'tr-local',
      'tr-pendiente',
    ])
    expect(db.select().from(storeTransfers).all().find(row => row.id === 'tr-confirmada')).toMatchObject({
      status: 'confirmed',
      receivedQuantity: 4,
      hasDifference: false,
    })
    expect(db.select().from(storeTransfers).all().find(row => row.id === 'tr-pendiente')?.status).toBe('pending')
  })

  it('no habla con Firebase si está apagado', async () => {
    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
    insertTransfer(db, { id: 'tr-1', syncedAt: null })
    await pushUnsyncedStoreTransfers(TENANT)
    expect(await pullStoreTransfersForRange(TENANT, START, END)).toBe(0)
    expect(mockGetDoc).not.toHaveBeenCalled()
    expect(mockGetDocs).not.toHaveBeenCalled()
  })

  it('la segunda lectura del mismo rango no vuelve a Firestore', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [remoteDoc('tr-semana', { status: 'pending' })],
    })
    const first = await listStoreTransfersForRange(TENANT, START, END, false)
    const second = await listStoreTransfersForRange(TENANT, START, END, false)
    expect(first.map(row => row.id)).toEqual(['tr-semana'])
    expect(second.map(row => row.id)).toEqual(['tr-semana'])
    expect(mockGetDocs).toHaveBeenCalledTimes(1)

    await listStoreTransfersForRange(TENANT, START, END, true)
    expect(mockGetDocs).toHaveBeenCalledTimes(2)
  })

  it('los pendientes del resumen se piden una vez, con tope, y sin conexión no fingen una lista vacía', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        remoteDoc('tr-ok', { estimatedValue: 15000 }),
        remoteDoc('tr-hecho', {
          status: 'confirmed',
          receivedQuantity: 4,
          confirmedAt: NOW,
          confirmedBy: 'ana',
        }),
      ],
    })
    const few = await loadPendingStoreTransfers(TENANT, START, END)
    expect(few.ok).toBe(true)
    if (few.ok) {
      expect(few.rows.map(row => row.id)).toEqual(['tr-ok'])
      expect(few.rows[0]?.estimatedValue).toBe(15000)
      expect(few.incomplete).toBe(false)
    }
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'pending')
    expect(mockWhere).toHaveBeenCalledWith('occurredAt', '>=', START)
    expect(mockWhere).toHaveBeenCalledWith('occurredAt', '<', END)
    expect(mockOrderBy).toHaveBeenCalledWith('occurredAt')
    expect(mockLimit).toHaveBeenCalledWith(101)
    expect(mockOnSnapshot).not.toHaveBeenCalled()
    expect(getDb).not.toHaveBeenCalled()

    mockGetDocs.mockResolvedValueOnce({
      docs: Array.from({ length: 101 }, (_, index) => remoteDoc(`tr-${index}`)),
    })
    const many = await loadPendingStoreTransfers(TENANT, START, END)
    expect(many.ok).toBe(true)
    if (many.ok) {
      expect(many.rows).toHaveLength(100)
      expect(many.incomplete).toBe(true)
    }

    mockGetDocs.mockResolvedValueOnce({
      docs: Array.from({ length: 100 }, (_, index) => remoteDoc(`justo-${index}`)),
    })
    const exact = await loadPendingStoreTransfers(TENANT, START, END)
    expect(exact.ok).toBe(true)
    if (exact.ok) {
      expect(exact.rows).toHaveLength(100)
      expect(exact.incomplete).toBe(false)
    }

    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
    const offline = await loadPendingStoreTransfers(TENANT, START, END)
    expect(offline).toEqual({ ok: false, reason: 'OFFLINE' })
    expect(mockGetDocs).toHaveBeenCalledTimes(3)
  })
})
