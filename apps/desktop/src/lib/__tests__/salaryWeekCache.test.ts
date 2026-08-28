import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearSalaryWeekRemoteCache,
  setSalaryWeekRemoteCache,
  shouldRefetchSalaryWeek,
} from '../salaryWeekCache'

describe('shouldRefetchSalaryWeek', () => {
  beforeEach(() => {
    clearSalaryWeekRemoteCache()
  })

  it('no vuelve a pedir Firebase una semana pasada ya vista', () => {
    const past = '2020-01-06'
    setSalaryWeekRemoteCache(past, { payments: [], vales: [] })
    expect(shouldRefetchSalaryWeek(past, false)).toBe(false)
    expect(shouldRefetchSalaryWeek(past, true)).toBe(true)
  })

  it('semana sin caché se pide', () => {
    expect(shouldRefetchSalaryWeek('2020-01-06', false)).toBe(true)
  })
})
