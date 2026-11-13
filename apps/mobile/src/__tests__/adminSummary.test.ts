import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDocs, orderBy, where } from 'firebase/firestore'
import { mondayWeekRange, summaryMoneyView, summaryMonthSpan } from '@carniceria/shared'
import { loadMobileSummary } from '../lib/adminSummary'
import { db } from '../lib/db'
import { invalidateSummaryWeek } from '../lib/summaryCache'

function shiftDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

function money(sold: number, at: string): Record<string, unknown> {
  return {
    soldTotal: sold,
    cashTotal: sold,
    cardWalletTotal: 0,
    debtTotal: 0,
    expenseTotal: 0,
    contributionTotal: 0,
    walletCashTotal: 0,
    moneySnapshottedAt: at,
  }
}

describe('loadMobileSummary', () => {
  beforeEach(async () => {
    vi.mocked(getDocs).mockReset()
    vi.mocked(orderBy).mockClear()
    vi.mocked(where).mockClear()
    await db.summaryShifts.clear()
    await db.summaryWeekPulls.clear()
  })

  it('usa el índice del historial y suma cada turno cerrado del mes', async () => {
    const october = summaryMonthSpan(2026, 10)
    const now = new Date('2026-10-28T15:00:00.000-03:00')
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        shiftDoc('tarde-22', {
          storeId: 'camarones',
          shiftType: 'evening',
          cashierName: 'Admin Prueba',
          startedAt: '2026-10-22T21:00:00.000Z',
          closedAt: '2026-10-22T23:00:00.000Z',
          ...money(2_141_692, '2026-10-22T23:00:00.000Z'),
        }),
        shiftDoc('manana-22', {
          storeId: 'camarones',
          shiftType: 'morning',
          cashierName: 'Admin Prueba',
          startedAt: '2026-10-22T11:00:00.000Z',
          closedAt: '2026-10-22T16:00:00.000Z',
          ...money(2_803_899, '2026-10-22T16:00:00.000Z'),
        }),
        shiftDoc('tarde-21', {
          storeId: 'camarones',
          shiftType: 'evening',
          cashierName: 'Admin Prueba',
          startedAt: '2026-10-21T21:00:00.000Z',
          closedAt: '2026-10-21T23:00:00.000Z',
          ...money(2_853_219, '2026-10-21T23:00:00.000Z'),
        }),
        shiftDoc('hoy', {
          storeId: 'camarones',
          shiftType: 'evening',
          cashierName: 'Admin Prueba',
          startedAt: '2026-10-28T21:00:00.000Z',
          closedAt: '2026-10-28T23:00:00.000Z',
        }),
      ],
    } as never)

    const result = await loadMobileSummary('camarones', october.startIso, october.endIso, now)
    expect(orderBy).toHaveBeenCalledWith('startedAt', 'desc')
    expect(where).toHaveBeenCalledWith('storeId', '==', 'camarones')
    expect(where).toHaveBeenCalledWith('startedAt', '>=', october.startIso)
    expect(where).toHaveBeenCalledWith('startedAt', '<', october.endIso)
    expect(result.shifts.map(shift => shift.id).sort()).toEqual(['hoy', 'manana-22', 'tarde-21', 'tarde-22'])
    const view = summaryMoneyView(result.shifts)
    expect(view.boxes).toHaveLength(4)
    expect(view.lines[0]?.amount).toBe(2_141_692 + 2_803_899 + 2_853_219)
    expect(view.pendingCount).toBe(1)
    expect(view.boxes.find(row => row.id === 'hoy')?.box.kind).toBe('pending')
    expect(result.shifts.some(shift => shift.cashierName.length > 0)).toBe(true)
  })

  it('una semana cerrada se pide una vez, y corregir el cierre refresca solo esa', async () => {
    const now = new Date('2026-10-28T15:00:00.000-03:00')
    const older = mondayWeekRange(-6, now)
    const newer = mondayWeekRange(-5, now)
    const calls: string[] = []
    vi.mocked(getDocs).mockImplementation(async () => {
      const start = calls[calls.length - 1]
      const id = start === older.startIso ? 'vieja' : 'menos-vieja'
      const sold = id === 'vieja' ? 1000 : 2000
      return {
        docs: [shiftDoc(id, {
          storeId: 'camarones',
          shiftType: 'evening',
          cashierName: 'Ana',
          startedAt: start,
          closedAt: start,
          ...money(sold, start),
        })],
      } as never
    })
    vi.mocked(where).mockImplementation((field, _op, value) => {
      if (field === 'startedAt' && _op === '>=') calls.push(String(value))
      return { field, op: _op, value } as never
    })

    const rangeEnd = newer.endIso
    const first = await loadMobileSummary('camarones', older.startIso, rangeEnd, now)
    expect(first.shifts.map(shift => shift.id).sort()).toEqual(['menos-vieja', 'vieja'])
    const shiftQueries = () => calls.filter(start => start === older.startIso || start === newer.startIso)
    expect(shiftQueries()).toEqual([older.startIso, newer.startIso])

    const before = shiftQueries().length
    const second = await loadMobileSummary('camarones', older.startIso, rangeEnd, now)
    expect(shiftQueries().length).toBe(before)
    expect(summaryMoneyView(second.shifts).lines[0]?.amount).toBe(3000)

    await invalidateSummaryWeek('camarones', older.startIso)
    await loadMobileSummary('camarones', older.startIso, rangeEnd, now)
    expect(shiftQueries().slice(before)).toEqual([older.startIso])
  })

  it('la semana en curso se vuelve a pedir', async () => {
    const now = new Date('2026-10-28T15:00:00.000-03:00')
    const week = mondayWeekRange(0, now)
    const starts: string[] = []
    vi.mocked(where).mockImplementation((field, op, value) => {
      if (field === 'startedAt' && op === '>=') starts.push(String(value))
      return { field, op, value } as never
    })
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never)
    await loadMobileSummary('camarones', week.startIso, week.endIso, now)
    await loadMobileSummary('camarones', week.startIso, week.endIso, now)
    expect(starts.filter(start => start === week.startIso)).toEqual([week.startIso, week.startIso])
  })
})
