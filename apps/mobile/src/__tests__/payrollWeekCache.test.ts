import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearPayrollWeekCache,
  getPayrollWeekCache,
  setPayrollWeekCache,
  resolveWeekView,
  weekQueryPlan,
} from '../lib/payrollWeekCache'

describe('weekQueryPlan', () => {
  const current = '2026-08-24'
  const past = '2026-08-10'

  beforeEach(() => {
    clearPayrollWeekCache()
  })

  it('semana pasada sin caché: un getDocs; con caché no vuelve a Firebase', () => {
    expect(weekQueryPlan(past, current, false, false)).toBe('fetch-once')
    expect(weekQueryPlan(past, current, true, false)).toBe('cache-only')
  })

  it('semana actual: live, o caché + live si ya la vimos', () => {
    expect(weekQueryPlan(current, current, false, false)).toBe('live')
    expect(weekQueryPlan(current, current, true, false)).toBe('cache-then-live')
  })

  it('Actualizar fuerza recarga', () => {
    expect(weekQueryPlan(past, current, true, true)).toBe('fetch-once')
    expect(weekQueryPlan(current, current, true, true)).toBe('live')
  })

  it('guarda y recupera una semana', () => {
    setPayrollWeekCache({ weekStart: past, vales: [], payments: [] })
    expect(getPayrollWeekCache(past)?.weekStart).toBe(past)
    expect(getPayrollWeekCache(current)).toBeUndefined()
  })

  it('no pinta vales de otra semana: usa caché o espera', () => {
    const vale = {
      id: 'v1', employeeId: 'a', amount: 1000, description: 'x', paidAt: '2026-08-11T12:00:00.000Z',
    }
    setPayrollWeekCache({ weekStart: past, vales: [vale], payments: [] })
    const fromCache = resolveWeekView(past, current, [], [])
    expect(fromCache.waiting).toBe(false)
    expect(fromCache.vales).toHaveLength(1)
    const waiting = resolveWeekView('2026-07-27', current, [vale], [])
    expect(waiting.waiting).toBe(true)
    expect(waiting.vales).toHaveLength(0)
    const live = resolveWeekView(current, current, [vale], [])
    expect(live.waiting).toBe(false)
    expect(live.vales).toHaveLength(1)
  })
})
