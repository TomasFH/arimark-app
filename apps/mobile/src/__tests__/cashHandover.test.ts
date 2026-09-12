import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../lib/db'
import { fetchCashHandover } from '../lib/cashHandover'
import type { LocalShift } from '../types/pos'

function closedShift(partial: Partial<LocalShift> & Pick<LocalShift, 'id' | 'storeId'>): LocalShift {
  return {
    userId: 'uid-1',
    displayName: 'Ana',
    shiftType: 'morning',
    startedAt: '2026-09-11T08:00:00.000Z',
    closedAt: '2026-09-11T16:00:00.000Z',
    openingCash: 0,
    closingCash: 5000,
    syncStatus: 'pending',
    syncedAt: null,
    closingBills: [{ denomination: 1000, quantity: 5 }],
    closingBillsCounted: true,
    ...partial,
  }
}

describe('fetchCashHandover', () => {
  beforeEach(async () => {
    await db.shifts.clear()
  })

  it('usa el último cierre local del mismo local (offline)', async () => {
    await db.shifts.bulkAdd([
      closedShift({
        id: 'older',
        storeId: 'store-1',
        closedAt: '2026-09-10T16:00:00.000Z',
        closingBills: [{ denomination: 1000, quantity: 1 }],
      }),
      closedShift({
        id: 'latest',
        storeId: 'store-1',
        closedAt: '2026-09-11T16:00:00.000Z',
        closingBills: [{ denomination: 1000, quantity: 5 }],
      }),
      closedShift({
        id: 'other-store',
        storeId: 'store-2',
        closedAt: '2026-09-11T20:00:00.000Z',
        closingBills: [{ denomination: 2000, quantity: 9 }],
      }),
    ])

    const result = await fetchCashHandover('store-1')
    expect(result?.fromShiftId).toBe('latest')
    expect(result?.fromCashierName).toBe('Ana')
    expect(result?.bills).toEqual([{ denomination: 1000, quantity: 5 }])
  })
})
