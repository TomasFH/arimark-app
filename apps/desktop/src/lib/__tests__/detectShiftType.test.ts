import { describe, expect, it } from 'vitest'
import { detectShiftType, timeToMinutes } from '../detectShiftType'

const MORNING = { start: '08:00', end: '12:00' }
const AFTERNOON = { start: '16:30', end: '20:30' }

function at(hhmm: string) {
  return detectShiftType(
    timeToMinutes(hhmm),
    MORNING.start,
    MORNING.end,
    AFTERNOON.start,
    AFTERNOON.end,
  )
}

describe('detectShiftType', () => {
  it('elige mañana dentro del horario de mañana', () => {
    expect(at('08:00')).toBe('morning')
    expect(at('10:00')).toBe('morning')
    expect(at('12:00')).toBe('morning')
  })

  it('elige tarde dentro del horario de tarde', () => {
    expect(at('16:30')).toBe('evening')
    expect(at('18:00')).toBe('evening')
    expect(at('20:30')).toBe('evening')
  })

  it('elige tarde si llega hasta 90 min antes de la apertura', () => {
    expect(at('15:00')).toBe('evening')
    expect(at('16:29')).toBe('evening')
  })

  it('elige mañana si llega hasta 90 min antes de la apertura', () => {
    expect(at('06:30')).toBe('morning')
    expect(at('07:59')).toBe('morning')
  })

  it('fuera de ambos rangos (y de la ventana temprana) cae en mañana', () => {
    expect(at('14:59')).toBe('morning')
    expect(at('21:00')).toBe('morning')
    expect(at('05:00')).toBe('morning')
  })

  it('si está en horario de mañana no lo pisa la ventana temprana de la tarde', () => {
    const overlapping = detectShiftType(
      timeToMinutes('15:30'),
      '08:00',
      '16:00',
      '16:30',
      '20:30',
    )
    expect(overlapping).toBe('morning')
  })

  it('sin horarios configurados elige mañana', () => {
    expect(detectShiftType(timeToMinutes('18:00'), null, null, null, null)).toBe('morning')
  })
})
