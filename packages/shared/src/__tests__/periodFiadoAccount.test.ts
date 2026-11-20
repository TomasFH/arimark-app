import { describe, expect, it } from 'vitest'
import { civilYmd } from '../pickupHours'
import { mondayWeekContaining } from '../weekRange'
import { PERIOD_FIADO_LIMIT, periodFiadoAccount, type LedgerEvent } from '../summaryFiado'

function event(
  eventType: string,
  amount: number,
  createdAt: string,
  shiftId: string | null,
): Pick<LedgerEvent, 'eventType' | 'amount' | 'createdAt' | 'shiftId'> {
  return { eventType, amount, createdAt, shiftId }
}

describe('periodFiadoAccount', () => {
  const sundayNight = new Date('2026-11-15T22:00:00.000-03:00')
  const week = mondayWeekContaining(sundayNight)
  const next = mondayWeekContaining('2026-11-16T12:00:00.000-03:00')

  it('el domingo a las 22 hora Argentina cae en esa semana', () => {
    expect(civilYmd(sundayNight)).toBe('2026-11-15')
    expect(week.startYmd).toBe('2026-11-09')
    expect(week.endInclusiveYmd).toBe('2026-11-15')
    const stored = sundayNight.toISOString()
    const rows = [
      event('created', 4_500, stored, 'turno'),
      event('debt', 500, stored, 'turno'),
      event('paid', -800, stored, null),
      event('partial_payment', 200, stored, 'turno'),
      event('cancelled', -9_000, stored, null),
      event('reopened', 100, '2026-11-16T03:00:00.000Z', 'turno'),
    ]
    const inWeek = periodFiadoAccount(rows, week.startIso, week.endIso)
    expect(inWeek).toEqual({
      newDebt: 5_000,
      collections: 1_000,
      unshifted: 800,
      incomplete: false,
    })
    const following = periodFiadoAccount(rows, next.startIso, next.endIso)
    expect(following).toEqual({
      newDebt: 100,
      collections: 0,
      unshifted: 0,
      incomplete: false,
    })
  })

  it('un período vacío es cero, no pendiente', () => {
    expect(periodFiadoAccount([], week.startIso, week.endIso)).toEqual({
      newDebt: 0,
      collections: 0,
      unshifted: 0,
      incomplete: false,
    })
  })

  it('al llegar a 500 no devuelve la suma parcial', () => {
    const stored = sundayNight.toISOString()
    const under = Array.from({ length: PERIOD_FIADO_LIMIT - 1 }, () => (
      event('created', 10, stored, 'turno')
    ))
    expect(periodFiadoAccount(under, week.startIso, week.endIso)).toEqual({
      newDebt: (PERIOD_FIADO_LIMIT - 1) * 10,
      collections: 0,
      unshifted: 0,
      incomplete: false,
    })

    const full = [...under, event('paid', 9_999, stored, null)]
    expect(full).toHaveLength(PERIOD_FIADO_LIMIT)
    expect(periodFiadoAccount(full, week.startIso, week.endIso)).toEqual({
      newDebt: null,
      collections: null,
      unshifted: null,
      incomplete: true,
    })
  })
})
