import { describe, expect, it } from 'vitest'
import {
  checkPickupTime,
  effectiveListSlot,
  isPickupDueSoon,
  isPickupOutsideCurrentHours,
  needsNearCloseConfirm,
  openWindowsFromStoreHours,
  pickupHoursLiveError,
  pickupTimeRegistrationError,
  PICKUP_CLOSED_MESSAGE,
  PICKUP_NO_HOURS_MESSAGE,
  timeToMinutes,
  type StoreShiftHours,
} from '../pickupHours'

/** Cierre mañana 13:30, abre tarde 16:30, cierra 20:30. */
const CAMARONES: StoreShiftHours = {
  morningStart: '08:00',
  morningEnd: '13:30',
  afternoonStart: '16:30',
  afternoonEnd: '20:30',
}

/** Cierre mañana 14:00, abre tarde 16:00, cierra 20:30. */
const SAN_MARTIN: StoreShiftHours = {
  morningStart: '08:00',
  morningEnd: '14:00',
  afternoonStart: '16:00',
  afternoonEnd: '20:30',
}

describe('openWindowsFromStoreHours', () => {
  it('nombra mañana/tarde por la hora de inicio, no por la de cierre', () => {
    const windows = openWindowsFromStoreHours(CAMARONES)
    expect(windows.map(w => w.kind)).toEqual(['morning', 'afternoon'])
    expect(windows[0]?.endMinutes).toBe(timeToMinutes('13:30'))
  })

  it('sin horarios no hay franjas', () => {
    expect(openWindowsFromStoreHours({})).toEqual([])
    expect(openWindowsFromStoreHours(null)).toEqual([])
  })
})

describe('checkPickupTime — ejemplos de registro', () => {
  it('8 / 11 / 12 son mañana con margen; 13:00 ya entra en la hora previa al cierre', () => {
    for (const t of ['08:00', '11:00', '12:00']) {
      expect(checkPickupTime(t, CAMARONES)).toEqual({ status: 'ok', window: 'morning' })
      expect(checkPickupTime(t, SAN_MARTIN)).toEqual({ status: 'ok', window: 'morning' })
    }
    expect(checkPickupTime('13:00', CAMARONES).window).toBe('morning')
    expect(checkPickupTime('13:00', SAN_MARTIN).window).toBe('morning')
  })

  it('13:00 en San Martín (cierra 14:00) es cerca del cierre; en Camarones (13:30) también', () => {
    expect(checkPickupTime('13:00', SAN_MARTIN)).toEqual({ status: 'near_close', window: 'morning' })
    expect(checkPickupTime('13:00', CAMARONES)).toEqual({ status: 'near_close', window: 'morning' })
  })

  it('14:00 es inválido en Camarones y válido/mañana (cerca del cierre) en San Martín', () => {
    expect(checkPickupTime('14:00', CAMARONES)).toEqual({ status: 'closed', window: null })
    expect(checkPickupTime('14:00', SAN_MARTIN)).toEqual({ status: 'near_close', window: 'morning' })
  })

  it('15:00 está cerrado en ambos', () => {
    expect(checkPickupTime('15:00', CAMARONES).status).toBe('closed')
    expect(checkPickupTime('15:00', SAN_MARTIN).status).toBe('closed')
  })

  it('16:00 es tarde en San Martín e inválido en Camarones (abre 16:30)', () => {
    expect(checkPickupTime('16:00', SAN_MARTIN)).toEqual({ status: 'ok', window: 'afternoon' })
    expect(checkPickupTime('16:00', CAMARONES)).toEqual({ status: 'closed', window: null })
  })

  it('19:00 tarde; 19:30 y 20:30 advertencia; 21:00 inválido', () => {
    expect(checkPickupTime('19:00', SAN_MARTIN)).toEqual({ status: 'ok', window: 'afternoon' })
    expect(checkPickupTime('19:30', SAN_MARTIN)).toEqual({ status: 'near_close', window: 'afternoon' })
    expect(checkPickupTime('20:30', CAMARONES)).toEqual({ status: 'near_close', window: 'afternoon' })
    expect(checkPickupTime('21:00', SAN_MARTIN)).toEqual({ status: 'closed', window: null })
  })

  it('02:00 y cualquier hora sin franja es cerrado', () => {
    expect(checkPickupTime('02:00', CAMARONES).status).toBe('closed')
  })

  it('sin horarios configurados no se puede registrar un horario específico', () => {
    const check = checkPickupTime('11:00', {})
    expect(check.status).toBe('no_hours')
    expect(pickupTimeRegistrationError(check)).toBe(PICKUP_NO_HOURS_MESSAGE)
  })

  it('cerrado expone el mensaje de registro', () => {
    expect(pickupTimeRegistrationError(checkPickupTime('15:00', CAMARONES))).toBe(PICKUP_CLOSED_MESSAGE)
  })

  it('el aviso de última hora queda apagado; near_close sigue existiendo', () => {
    const check = checkPickupTime('13:00', SAN_MARTIN)
    expect(check.status).toBe('near_close')
    expect(needsNearCloseConfirm(check)).toBe(false)
    expect(pickupHoursLiveError('specific', '13:00', SAN_MARTIN)).toBeNull()
  })

  it('al elegir un horario inválido el error aparece sin esperar al submit', () => {
    expect(pickupHoursLiveError('specific', '15:00', CAMARONES)).toBe(PICKUP_CLOSED_MESSAGE)
    expect(pickupHoursLiveError('specific', '', CAMARONES)).toBeNull()
    expect(pickupHoursLiveError('morning', '15:00', CAMARONES)).toBeNull()
  })
})

describe('effectiveListSlot / pedidos viejos fuera de franja', () => {
  it('un específico a las 11:00 se lista en mañana', () => {
    expect(effectiveListSlot({ timeSlot: 'specific', pickupTime: '11:00' }, CAMARONES)).toBe('morning')
  })

  it('un específico a las 17:00 se lista en tarde', () => {
    expect(effectiveListSlot({ timeSlot: 'specific', pickupTime: '17:00' }, CAMARONES)).toBe('afternoon')
  })

  it('si el admin acortó el horario, el pendiente queda en specific para advertir', () => {
    const closedAtNoon: StoreShiftHours = {
      morningStart: '08:00',
      morningEnd: '12:00',
      afternoonStart: '16:30',
      afternoonEnd: '20:30',
    }
    const order = { timeSlot: 'specific' as const, pickupTime: '13:00' }
    expect(effectiveListSlot(order, closedAtNoon)).toBe('specific')
    expect(isPickupOutsideCurrentHours(order, closedAtNoon)).toBe(true)
    expect(isPickupOutsideCurrentHours(order, CAMARONES)).toBe(false)
  })

  it('turno mañana sin hora concreta sigue siendo mañana', () => {
    expect(effectiveListSlot({ timeSlot: 'morning', pickupTime: null }, CAMARONES)).toBe('morning')
  })
})

describe('isPickupDueSoon', () => {
  it('true si falta una hora o menos el mismo día', () => {
    expect(isPickupDueSoon({
      pickupDate: '2026-09-07',
      pickupTime: '11:00',
      todayYmd: '2026-09-07',
      nowMinutes: timeToMinutes('10:00')!,
    })).toBe(true)
    expect(isPickupDueSoon({
      pickupDate: '2026-09-07',
      pickupTime: '11:00',
      todayYmd: '2026-09-07',
      nowMinutes: timeToMinutes('10:01')!,
    })).toBe(true)
  })

  it('false si falta más de una hora, si ya pasó, o si es otro día', () => {
    expect(isPickupDueSoon({
      pickupDate: '2026-09-07',
      pickupTime: '11:00',
      todayYmd: '2026-09-07',
      nowMinutes: timeToMinutes('09:59')!,
    })).toBe(false)
    expect(isPickupDueSoon({
      pickupDate: '2026-09-07',
      pickupTime: '11:00',
      todayYmd: '2026-09-07',
      nowMinutes: timeToMinutes('11:00')!,
    })).toBe(false)
    expect(isPickupDueSoon({
      pickupDate: '2026-09-08',
      pickupTime: '11:00',
      todayYmd: '2026-09-07',
      nowMinutes: timeToMinutes('10:30')!,
    })).toBe(false)
  })
})
