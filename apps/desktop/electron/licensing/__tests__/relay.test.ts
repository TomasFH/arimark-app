import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests del relay listener del proceso main del desktop.
 *
 * Estrategia de mocking:
 * - Firebase (getFirestore, onSnapshot, updateDoc) → mocks en memoria
 * - getDb (SQLite) → mock que simula búsqueda de productos por PLU
 * - isFirebaseAvailable → retorna true
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateDoc = vi.fn().mockResolvedValue(undefined)
const mockUnsubscribe = vi.fn()
let _onSnapshotCallback: ((snapshot: unknown) => void) | null = null

vi.mock('../../../electron/licensing/firebase', () => ({
  getFirebaseApp: vi.fn().mockReturnValue({}),
  isFirebaseAvailable: vi.fn().mockReturnValue(true),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn().mockReturnValue({}),
  collection: vi.fn().mockReturnValue({}),
  query: vi.fn().mockReturnValue({}),
  where: vi.fn().mockReturnValue({}),
  onSnapshot: vi.fn().mockImplementation((_q, callback) => {
    _onSnapshotCallback = callback
    return mockUnsubscribe
  }),
  doc: vi.fn().mockReturnValue({}),
  updateDoc: mockUpdateDoc,
}))

vi.mock('../../../electron/db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

vi.mock('../../../electron/db/schema', () => ({
  products: {},
  productPrices: {},
}))

// ---------------------------------------------------------------------------
// Helper para simular snapshot de Firestore
// ---------------------------------------------------------------------------

function fireDocChange(data: Record<string, unknown>) {
  if (!_onSnapshotCallback) throw new Error('onSnapshot no fue registrado')
  _onSnapshotCallback({
    docChanges: () => [
      {
        type: 'added',
        doc: { data: () => data },
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('relay.ts — startRelayListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _onSnapshotCallback = null
  })

  it('rechaza barcodes con formato inválido (no EAN-13 KRETZ)', async () => {
    const { startRelayListener } = await import('../../../electron/licensing/relay')

    const onAccepted = vi.fn()
    startRelayListener('test-key', 'local1', onAccepted)

    // Simular evento con barcode inválido
    fireDocChange({
      eventId: 'evt-1',
      barcode: '1234567890123', // No empieza con "20"
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdByUid: 'uid-1',
    })

    await vi.waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled())

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'rejected' })
    )
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('rechaza barcodes válidos pero PLU no encontrado en catálogo', async () => {
    const { getDb } = await import('../../../electron/db/client')
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              limit: () => ({
                all: () => [],  // Sin productos
              }),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>)

    const { startRelayListener } = await import('../../../electron/licensing/relay')
    const onAccepted = vi.fn()
    startRelayListener('test-key', 'local1', onAccepted)

    // Barcode EAN-13 KRETZ válido: PLU 001, $6000.00
    fireDocChange({
      eventId: 'evt-2',
      barcode: '2000106000001',
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdByUid: 'uid-1',
    })

    await vi.waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled())

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'rejected' })
    )
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('acepta barcode KRETZ válido con PLU en catálogo y llama onAccepted', async () => {
    const { getDb } = await import('../../../electron/db/client')
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              limit: () => ({
                all: () => [{ name: 'Huevos x30' }],
              }),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>)

    const { startRelayListener } = await import('../../../electron/licensing/relay')
    const onAccepted = vi.fn()
    startRelayListener('test-key', 'local1', onAccepted)

    fireDocChange({
      eventId: 'evt-3',
      barcode: '2000106000001',
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdByUid: 'uid-1',
    })

    // Esperar a que tanto updateDoc como onAccepted sean llamados
    await vi.waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'accepted', productName: 'Huevos x30' })
      )
      expect(onAccepted).toHaveBeenCalledWith('2000106000001')
    })
  })

  it('stopRelayListener cancela la suscripción', async () => {
    const { startRelayListener, stopRelayListener } = await import('../../../electron/licensing/relay')

    startRelayListener('test-key', 'local1', vi.fn())
    stopRelayListener()

    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})
