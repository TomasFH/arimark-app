import { describe, expect, it } from 'vitest'
import { mondayWeekRange } from '@carniceria/shared'
import { shouldRefreshMerchWeek, weekOffsetForMonday } from '../lib/merchIntake'

describe('semana de medias en el celu', () => {
  it('la semana en curso se vuelve a pedir aunque ya haya filas', () => {
    expect(shouldRefreshMerchWeek(0, 4)).toBe(true)
    expect(shouldRefreshMerchWeek(0, 0)).toBe(true)
  })

  it('una semana cerrada que ya está no se vuelve a bajar', () => {
    expect(shouldRefreshMerchWeek(-1, 3)).toBe(false)
    expect(shouldRefreshMerchWeek(-3, 0)).toBe(true)
  })

  it('el lunes de la semana actual es el offset 0', () => {
    const now = new Date('2026-10-27T15:00:00.000Z')
    expect(weekOffsetForMonday(mondayWeekRange(0, now).startYmd, now)).toBe(0)
    expect(weekOffsetForMonday(mondayWeekRange(-1, now).startYmd, now)).toBe(-1)
  })
})
