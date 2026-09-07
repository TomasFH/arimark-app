import { describe, expect, it } from 'vitest'
import { compareOrdersByPickup } from '../orderListSort'
import type { OrderRow } from '../../types/hw-api'

function order(overrides: Partial<OrderRow> & Pick<OrderRow, 'id' | 'pickupDate' | 'status'>): OrderRow {
  return {
    storeId: 's1',
    customerName: overrides.id,
    phone: null,
    items: '',
    timeSlot: null,
    pickupTime: null,
    priority: false,
    notes: null,
    depositAmount: 0,
    depositPayments: null,
    depositMethod: null,
    createdAt: '2026-09-02T10:00:00.000Z',
    createdBy: 'u1',
    updatedAt: null,
    updatedBy: null,
    readyAt: null,
    readyBy: null,
    readyByName: null,
    budgetItems: null,
    ...overrides,
  }
}

describe('compareOrdersByPickup', () => {
  it('pone la fecha de retiro más próxima primero, aunque el más lejano esté pendiente y el de hoy listo', () => {
    const todayReady = order({ id: 'hoy', pickupDate: '2026-09-02', status: 'ready' })
    const fridayPending = order({ id: 'viernes', pickupDate: '2026-09-04', status: 'pending' })
    const list = [fridayPending, todayReady].sort(compareOrdersByPickup)
    expect(list.map(o => o.id)).toEqual(['hoy', 'viernes'])
  })

  it('dentro del mismo día, mañana antes que tarde', () => {
    const afternoon = order({ id: 'tarde', pickupDate: '2026-09-04', status: 'pending', timeSlot: 'afternoon' })
    const morning = order({ id: 'mañana', pickupDate: '2026-09-04', status: 'pending', timeSlot: 'morning' })
    const list = [afternoon, morning].sort(compareOrdersByPickup)
    expect(list.map(o => o.id)).toEqual(['mañana', 'tarde'])
  })

  it('agrupa un horario específico en el turno de su franja, no en un grupo aparte', () => {
    const hours = new Map([['s1', {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }]])
    const ctx = { todayYmd: '2026-09-04', nowMinutes: 8 * 60, hoursByStore: hours }
    const afternoon = order({ id: 'tarde', pickupDate: '2026-09-04', status: 'pending', timeSlot: 'afternoon' })
    const specificMorning = order({
      id: '11am',
      pickupDate: '2026-09-04',
      status: 'pending',
      timeSlot: 'specific',
      pickupTime: '11:00',
    })
    const morning = order({ id: 'mañana', pickupDate: '2026-09-04', status: 'pending', timeSlot: 'morning' })
    const list = [afternoon, specificMorning, morning].sort((a, b) => compareOrdersByPickup(a, b, ctx))
    expect(list.map(o => o.id)).toEqual(['11am', 'mañana', 'tarde'])
  })

  it('si falta una hora o menos, el horario específico queda primero en el día', () => {
    const hours = new Map([['s1', {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }]])
    const ctx = { todayYmd: '2026-09-04', nowMinutes: 10 * 60, hoursByStore: hours }
    const morning = order({ id: 'mañana', pickupDate: '2026-09-04', status: 'pending', timeSlot: 'morning' })
    const dueSoon = order({
      id: 'pronto',
      pickupDate: '2026-09-04',
      status: 'pending',
      timeSlot: 'specific',
      pickupTime: '11:00',
    })
    const list = [morning, dueSoon].sort((a, b) => compareOrdersByPickup(a, b, ctx))
    expect(list.map(o => o.id)).toEqual(['pronto', 'mañana'])
  })

  it('dentro del mismo día y turno, pending antes que ready', () => {
    const ready = order({ id: 'listo', pickupDate: '2026-09-02', status: 'ready', timeSlot: 'morning' })
    const pending = order({ id: 'pendiente', pickupDate: '2026-09-02', status: 'pending', timeSlot: 'morning' })
    const list = [ready, pending].sort(compareOrdersByPickup)
    expect(list.map(o => o.id)).toEqual(['pendiente', 'listo'])
  })
})
