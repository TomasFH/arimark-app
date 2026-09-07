import { describe, expect, it } from 'vitest'
import { checkPickupTime } from '../pickupHours'
import {
  ALL_WEEKDAYS,
  SHIFT_HOURS_OVERLAP_MESSAGE,
  addHoursBlock,
  checkPickupTimeOnDate,
  editorScheduleFromStore,
  formatWeekScheduleSummary,
  hoursForDate,
  legacyHoursFromSchedule,
  parseHoursSchedule,
  pickupSlotAvailability,
  pickupSlotRegistrationError,
  PICKUP_NO_AFTERNOON_MESSAGE,
  serializeHoursSchedule,
  shiftWindowsOverlap,
  storeHasAnyHours,
  toggleDayInSchedule,
  validateShiftHours,
  validateWeekSchedule,
  weekdayFromYmd,
  type StoreHoursBlock,
} from '../storeHours'

const SAN_MARTIN_WEEKDAY: StoreHoursBlock = {
  days: [1, 2, 3, 4, 5, 6],
  morningStart: '08:00',
  morningEnd: '14:00',
  afternoonStart: '16:00',
  afternoonEnd: '20:30',
}

const SAN_MARTIN_SUNDAY: StoreHoursBlock = {
  days: [0],
  morningStart: '08:00',
  morningEnd: '14:00',
  afternoonStart: null,
  afternoonEnd: null,
}

describe('validateShiftHours / overlap', () => {
  it('un turno corrido 08:00–20:30 sin tarde es válido', () => {
    expect(validateShiftHours({
      morningStart: '08:00',
      morningEnd: '20:30',
      afternoonStart: null,
      afternoonEnd: null,
    })).toBeNull()
  })

  it('mañana 08:00–20:30 y tarde 16:00–20:30 se pisan', () => {
    expect(shiftWindowsOverlap({
      morningStart: '08:00',
      morningEnd: '20:30',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    })).toBe(true)
    expect(validateShiftHours({
      morningStart: '08:00',
      morningEnd: '20:30',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    })).toBe(SHIFT_HOURS_OVERLAP_MESSAGE)
  })

  it('tocarse en el extremo no es solapamiento', () => {
    expect(validateShiftHours({
      morningStart: '08:00',
      morningEnd: '16:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    })).toBeNull()
  })

  it('cierre antes o igual que apertura es inválido', () => {
    expect(validateShiftHours({
      morningStart: '14:00',
      morningEnd: '08:00',
    })).toMatch(/cierre/)
  })
})

describe('week schedule', () => {
  it('2026-09-06 es domingo', () => {
    expect(weekdayFromYmd('2026-09-06')).toBe(0)
    expect(weekdayFromYmd('2026-09-07')).toBe(1)
  })

  it('San Martín: domingo solo mañana; lunes con tarde', () => {
    const source = {
      hoursSchedule: [SAN_MARTIN_WEEKDAY, SAN_MARTIN_SUNDAY],
      ...legacyHoursFromSchedule([SAN_MARTIN_WEEKDAY, SAN_MARTIN_SUNDAY]),
    }
    expect(hoursForDate(source, '2026-09-06').afternoonStart).toBeNull()
    expect(hoursForDate(source, '2026-09-07').afternoonStart).toBe('16:00')
    expect(checkPickupTimeOnDate('17:00', source, '2026-09-06').status).toBe('closed')
    expect(checkPickupTimeOnDate('17:00', source, '2026-09-07').status).toBe('ok')
    expect(checkPickupTimeOnDate('11:00', source, '2026-09-06').window).toBe('morning')
    expect(pickupSlotAvailability(source, '2026-09-06')).toEqual({ morning: true, afternoon: false })
    expect(pickupSlotAvailability(source, '2026-09-07')).toEqual({ morning: true, afternoon: true })
    expect(pickupSlotRegistrationError('afternoon', source, '2026-09-06')).toBe(PICKUP_NO_AFTERNOON_MESSAGE)
    expect(pickupSlotRegistrationError('afternoon', source, '2026-09-07')).toBeNull()
    expect(pickupSlotRegistrationError('morning', source, '2026-09-06')).toBeNull()
  })

  it('día sin bloque está cerrado aunque el local tenga horarios otros días', () => {
    const source = { hoursSchedule: [SAN_MARTIN_WEEKDAY] }
    expect(storeHasAnyHours(source)).toBe(true)
    expect(checkPickupTimeOnDate('11:00', source, '2026-09-06').status).toBe('closed')
    expect(checkPickupTime('11:00', hoursForDate(source, '2026-09-06')).status).toBe('no_hours')
  })

  it('sin schedule, los 4 campos valen los 7 días', () => {
    const source = {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }
    expect(hoursForDate(source, '2026-09-06').afternoonStart).toBe('16:00')
    expect(checkPickupTimeOnDate('17:00', source, '2026-09-06').status).toBe('ok')
  })

  it('rechaza un día en dos bloques', () => {
    expect(validateWeekSchedule([
      { ...SAN_MARTIN_WEEKDAY, days: [0, 1] },
      { ...SAN_MARTIN_SUNDAY, days: [0] },
    ])).toMatch(/mismo día/)
  })

  it('el editor mueve el día de un bloque al otro', () => {
    const next = toggleDayInSchedule(
      [SAN_MARTIN_WEEKDAY, { ...SAN_MARTIN_SUNDAY, days: [] }],
      1,
      0,
    )
    expect(next[0]?.days).not.toContain(0)
    expect(next[1]?.days).toContain(0)
  })

  it('agregar bloque vacío no pisa los días ya asignados', () => {
    const next = addHoursBlock([SAN_MARTIN_WEEKDAY])
    expect(next).toHaveLength(2)
    expect(next[1]?.days).toEqual([])
  })

  it('resume Lun–Sáb y Dom por separado', () => {
    const text = formatWeekScheduleSummary({
      hoursSchedule: [SAN_MARTIN_WEEKDAY, SAN_MARTIN_SUNDAY],
    })
    expect(text).toContain('Lun–Sáb')
    expect(text).toContain('Dom')
    expect(text).toContain('08:00–14:00 / 16:00–20:30')
  })

  it('parse/serialize redondo', () => {
    const json = serializeHoursSchedule([SAN_MARTIN_WEEKDAY, SAN_MARTIN_SUNDAY])
    expect(json).toBeTruthy()
    const parsed = parseHoursSchedule(json)
    expect(parsed).toHaveLength(2)
    expect(parsed?.[1]?.days).toEqual([0])
  })

  it('editor arranca con los 7 días si solo hay campos legacy', () => {
    const schedule = editorScheduleFromStore({
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    })
    expect(schedule).toHaveLength(1)
    expect(schedule[0]?.days).toEqual(ALL_WEEKDAYS)
  })

  it('un editor vacío (días marcados, sin horas) se puede guardar', () => {
    expect(validateWeekSchedule(editorScheduleFromStore(null))).toBeNull()
  })
})
