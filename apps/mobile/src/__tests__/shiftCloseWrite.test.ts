import { describe, expect, it } from 'vitest'
import { closeShiftFields, correctShiftFields } from '../lib/shiftCloseWrite'

describe('cierre de turno en el celu', () => {
  it('un campo vacío no se escribe y el cero sí', () => {
    const empty = closeShiftFields({
      closedByUserId: 'admin-1',
      closedByName: 'Ana',
      now: '2026-10-27T15:00:00.000Z',
    })
    expect(empty.cashLeft).toBeUndefined()
    expect(empty.deliveredAmount).toBeUndefined()
    expect(empty.closingCash).toBeNull()
    expect(empty.closedAt).toBe('2026-10-27T15:00:00.000Z')

    const zero = closeShiftFields({
      cashLeft: 0,
      closedByUserId: 'admin-1',
      closedByName: 'Ana',
      now: '2026-10-27T15:00:00.000Z',
    })
    expect(zero.cashLeft).toBe(0)
    expect(zero.deliveredAmount).toBeUndefined()
    expect(zero.closingCash).toBeNull()
  })

  it('corregir no toca quién cerró ni la fecha, y suma solo si están los dos', () => {
    const corrected = correctShiftFields({
      withdrawn: 0,
      currentCashLeft: 1500,
      currentWithdrawn: 400,
    })
    expect(corrected.closedAt).toBeUndefined()
    expect(corrected.closedByUserId).toBeUndefined()
    expect(corrected.cashLeft).toBeUndefined()
    expect(corrected.deliveredAmount).toBe(0)
    expect(corrected.closingCash).toBe(1500)
  })
})
