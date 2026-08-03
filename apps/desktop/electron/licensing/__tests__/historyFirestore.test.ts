import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HistoryShiftRow } from '../../../src/types/hw-api'

vi.mock('../firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
  getFirebaseApp: vi.fn(),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'tenant-test' })),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { mergeHistoryShiftRows, fetchHistoryShiftsFromFirestore } from '../historyFirestore'
import { isFirebaseAvailable } from '../firebase'

function row(partial: Partial<HistoryShiftRow> & { id: string; startedAt: string }): HistoryShiftRow {
  return {
    shiftType: 'morning',
    closedAt: '2026-07-01T16:00:00.000Z',
    cashierName: 'c1',
    salesCount: 0,
    totalRevenue: 0,
    totalCashSales: 0,
    totalExpenses: 0,
    cashInHand: 0,
    totalDeposits: 0,
    ...partial,
  }
}

describe('historyFirestore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFirebaseAvailable).mockReturnValue(false)
  })

  describe('mergeHistoryShiftRows', () => {
    it('prefer local sobre remoto con el mismo id', () => {
      const local = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', totalRevenue: 100, cashierName: 'Local' })]
      const remote = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z', totalRevenue: 50, cashierName: 'Remote' })]
      const merged = mergeHistoryShiftRows(local, remote)
      expect(merged).toHaveLength(1)
      expect(merged[0].cashierName).toBe('Local')
      expect(merged[0].totalRevenue).toBe(100)
    })

    it('incluye turnos solo remotos y ordena por startedAt', () => {
      const local = [row({ id: 'b', startedAt: '2026-07-02T08:00:00.000Z' })]
      const remote = [row({ id: 'a', startedAt: '2026-07-01T08:00:00.000Z' })]
      const merged = mergeHistoryShiftRows(local, remote)
      expect(merged.map(r => r.id)).toEqual(['a', 'b'])
    })
  })

  describe('fetchHistoryShiftsFromFirestore', () => {
    it('retorna [] si Firebase no está disponible', async () => {
      const rows = await fetchHistoryShiftsFromFirestore({ effectiveStoreId: null })
      expect(rows).toEqual([])
    })
  })
})
