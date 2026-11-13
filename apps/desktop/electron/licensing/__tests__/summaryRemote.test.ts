import { describe, expect, it, vi, beforeEach } from 'vitest'
import { summaryMonthSpan } from '@carniceria/shared'

const { mockGetDocs, mockOrderBy, mockWhere } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockOrderBy: vi.fn((...args: unknown[]) => args),
  mockWhere: vi.fn((...args: unknown[]) => args),
}))

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: () => ({ tenant_id: 'tenant-test' }),
}))

vi.mock('../firebase', () => ({
  getFirebaseApp: () => ({}),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  doc: vi.fn(),
  setDoc: vi.fn(),
  query: vi.fn((...args: unknown[]) => args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}))

import { fetchRemoteSummaryShifts } from '../summaryRemote'

describe('fetchRemoteSummaryShifts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pide el índice del historial y no descarta turnos sin ficha de plata', async () => {
    const october = summaryMonthSpan(2026, 10)
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'tarde-22',
          data: () => ({
            storeId: 'camarones',
            shiftType: 'evening',
            cashierName: 'Admin Prueba',
            startedAt: '2026-10-22T21:00:00.000Z',
            closedAt: '2026-10-22T23:00:00.000Z',
          }),
        },
        {
          id: 'manana-22',
          data: () => ({
            storeId: 'camarones',
            shiftType: 'morning',
            cashierName: 'Admin Prueba',
            startedAt: '2026-10-22T11:00:00.000Z',
            closedAt: '2026-10-22T16:00:00.000Z',
          }),
        },
        {
          id: 'tarde-21',
          data: () => ({
            storeId: 'camarones',
            shiftType: 'evening',
            cashierName: 'Admin Prueba',
            startedAt: '2026-10-21T21:00:00.000Z',
            closedAt: '2026-10-21T23:00:00.000Z',
          }),
        },
      ],
    })

    const rows = await fetchRemoteSummaryShifts('camarones', october.startIso, october.endIso)
    expect(rows.map(row => row.id)).toEqual(['tarde-22', 'manana-22', 'tarde-21'])
    expect(rows.every(row => row.soldTotal == null)).toBe(true)
    expect(mockOrderBy).toHaveBeenCalledWith('startedAt', 'desc')
    expect(mockWhere).toHaveBeenCalledWith('storeId', '==', 'camarones')
    expect(mockWhere).toHaveBeenCalledWith('startedAt', '>=', october.startIso)
    expect(mockWhere).toHaveBeenCalledWith('startedAt', '<', october.endIso)
  })
})
