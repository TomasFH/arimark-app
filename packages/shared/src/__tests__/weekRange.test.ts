import { describe, expect, it } from 'vitest'
import { civilYmd } from '../pickupHours'
import {
  calendarMonthRange,
  firstMondayOfMonth,
  formatSummaryRange,
  lastMondayOfMonth,
  mondayWeekContaining,
  mondayWeekRange,
  monthOfWeekMonday,
  summaryMonthSpan,
  summaryMonthStep,
  summaryPeriodDates,
  summaryPeriodQuery,
  weekdayInTimeZone,
  weekStartMondayYmd,
} from '../weekRange'

describe('weekRange', () => {
  it('el lunes de una fecha de miércoles es ese lunes', () => {
    expect(weekStartMondayYmd('2026-09-09')).toBe('2026-09-07')
  })

  it('domingo pertenece a la semana que empezó el lunes anterior', () => {
    expect(weekStartMondayYmd('2026-09-13')).toBe('2026-09-07')
  })

  it('mondayWeekRange(0) cubre lun–dom en ISO', () => {
    const range = mondayWeekRange(0, new Date('2026-09-11T15:00:00.000-03:00'))
    expect(range.startYmd).toBe('2026-09-07')
    expect(range.endInclusiveYmd).toBe('2026-09-13')
    expect(range.startIso).toBe(new Date('2026-09-07T00:00:00.000-03:00').toISOString())
    expect(range.endIso).toBe(new Date('2026-09-14T00:00:00.000-03:00').toISOString())
  })

  it('weekdayInTimeZone usa el día civil AR', () => {
    // Viernes 11 sep 2026 01:00 AR = jueves 10 noche UTC
    expect(weekdayInTimeZone(new Date('2026-09-11T01:00:00.000-03:00'))).toBe(5)
  })

  it('el domingo a las 22 hora Argentina sigue en esa semana', () => {
    const at = new Date('2026-11-15T22:00:00.000-03:00')
    expect(civilYmd(at)).toBe('2026-11-15')
    const stored = at.toISOString()
    const week = mondayWeekContaining(at)
    expect(week.startYmd).toBe('2026-11-09')
    expect(week.endInclusiveYmd).toBe('2026-11-15')
    expect(stored >= week.startIso && stored < week.endIso).toBe(true)
    const next = mondayWeekContaining('2026-11-16T12:00:00.000-03:00')
    expect(next.startYmd).toBe('2026-11-16')
    expect(stored >= next.startIso && stored < next.endIso).toBe(false)
  })

  it('calendarMonthRange cubre el mes civil AR', () => {
    const range = calendarMonthRange(0, new Date('2026-09-17T15:00:00.000-03:00'))
    expect(range.year).toBe(2026)
    expect(range.month).toBe(9)
    expect(range.startYmd).toBe('2026-09-01')
    expect(range.endInclusiveYmd).toBe('2026-09-30')
    expect(range.startIso).toBe(new Date('2026-09-01T00:00:00.000-03:00').toISOString())
    expect(range.endIso).toBe(new Date('2026-10-01T00:00:00.000-03:00').toISOString())
  })

  it('la semana del lunes 26 oct al domingo 1 nov es octubre', () => {
    expect(weekStartMondayYmd('2026-11-01')).toBe('2026-10-26')
    expect(monthOfWeekMonday('2026-10-26')).toEqual({ year: 2026, month: 10 })
    const october = summaryMonthSpan(2026, 10)
    expect(october.startYmd).toBe('2026-10-05')
    expect(october.endInclusiveYmd).toBe('2026-11-01')
    expect(firstMondayOfMonth(2026, 10)).toBe('2026-10-05')
    expect(lastMondayOfMonth(2026, 10)).toBe('2026-10-26')
    for (const day of ['2026-10-21', '2026-10-22', '2026-11-01']) {
      expect(day >= october.startYmd && day <= october.endInclusiveYmd).toBe(true)
    }
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      expect(day >= october.startYmd && day <= october.endInclusiveYmd).toBe(false)
    }
  })

  it('el 1 al 4 de octubre cierran septiembre', () => {
    expect(weekStartMondayYmd('2026-10-01')).toBe('2026-09-28')
    expect(weekStartMondayYmd('2026-10-04')).toBe('2026-09-28')
    expect(monthOfWeekMonday('2026-09-28')).toEqual({ year: 2026, month: 9 })
    const september = summaryMonthSpan(2026, 9)
    expect(september.startYmd).toBe('2026-09-07')
    expect(september.endInclusiveYmd).toBe('2026-10-04')
    expect(september.endInclusiveYmd >= '2026-10-01').toBe(true)
    expect(september.endInclusiveYmd >= '2026-10-04').toBe(true)
  })

  it('el domingo 1 nov «este mes» es octubre y desde el lunes 2 es noviembre', () => {
    const sunday = summaryMonthStep(0, new Date('2026-11-01T15:00:00.000-03:00'))
    expect(sunday.month).toBe(10)
    expect(sunday.name).toBe('Octubre')
    expect(sunday.endInclusiveYmd).toBe('2026-11-01')
    const back = summaryMonthStep(1, new Date('2026-11-01T15:00:00.000-03:00'))
    expect(back.month).toBe(9)

    const monday = summaryMonthStep(0, new Date('2026-11-02T15:00:00.000-03:00'))
    expect(monday.month).toBe(11)
    expect(monday.startYmd).toBe('2026-11-02')
    const october = summaryMonthStep(1, new Date('2026-11-02T15:00:00.000-03:00'))
    expect(october.month).toBe(10)
    expect(october.startYmd).toBe('2026-10-05')
  })

  it('hoy consulta la misma semana y el mes anterior conserva el nombre', () => {
    const now = new Date('2026-10-28T15:00:00.000-03:00')
    const week = summaryPeriodQuery('week', now)
    expect(summaryPeriodQuery('today', now)).toEqual(week)
    expect(week).toEqual({
      startIso: mondayWeekRange(0, now).startIso,
      endIso: mondayWeekRange(0, now).endIso,
    })
    const october = summaryMonthSpan(2026, 10)
    expect(summaryPeriodQuery('month', now)).toEqual({ startIso: october.startIso, endIso: october.endIso })
    const september = summaryMonthSpan(2026, 9)
    expect(summaryPeriodQuery('previous', now)).toEqual({ startIso: september.startIso, endIso: september.endIso })
    expect(summaryPeriodDates('today', now)).toEqual({ startYmd: '2026-10-28', endYmd: '2026-10-28' })
    expect(formatSummaryRange(october.startYmd, october.endInclusiveYmd)).toBe('05/10 – 01/11')
    expect(summaryMonthStep(1, now).name).toBe('Septiembre')
  })

  it('calendarMonthRange(-1) es el mes civil anterior', () => {
    const range = calendarMonthRange(-1, new Date('2026-09-17T15:00:00.000-03:00'))
    expect(range.year).toBe(2026)
    expect(range.month).toBe(8)
    expect(range.startYmd).toBe('2026-08-01')
    expect(range.endInclusiveYmd).toBe('2026-08-31')
  })
})
