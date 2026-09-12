import { describe, expect, it } from 'vitest'
import { mondayWeekRange, weekdayInTimeZone, weekStartMondayYmd } from '../weekRange'

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
})
