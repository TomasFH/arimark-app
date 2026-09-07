import { describe, it, expect } from 'vitest'
import {
  parseOrderPriority,
  parseTimeSlot,
  parseDepositPayments,
  serializeDepositPayments,
  depositTotal,
  formatDepositPaymentsLine,
  defaultCreateStoreId,
  validateMobileOrderDraft,
  toMobileOrderRecord,
  formatPickupSlotLine,
  type MobileOrderDraft,
} from '../lib/orderMapping'
import type { StoreHoursSource } from '@carniceria/shared'

function draft(overrides: Partial<MobileOrderDraft> = {}): MobileOrderDraft {
  return {
    storeId: 'store-1',
    customerName: 'Juan',
    phone: '111',
    items: '2 kg asado',
    pickupDate: '2026-08-18',
    timeSlot: '',
    pickupTime: '',
    priority: false,
    payments: [],
    notes: '',
    createdBy: 'uid-admin',
    ...overrides,
  }
}

describe('parseOrderPriority', () => {
  it('acepta boolean desktop y el legado mobile high/normal', () => {
    expect(parseOrderPriority(true)).toBe(true)
    expect(parseOrderPriority('high')).toBe(true)
    expect(parseOrderPriority(false)).toBe(false)
    expect(parseOrderPriority('normal')).toBe(false)
    expect(parseOrderPriority(undefined)).toBe(false)
  })
})

describe('parseTimeSlot', () => {
  it('normaliza slots desktop y valores viejos en español', () => {
    expect(parseTimeSlot('morning')).toBe('morning')
    expect(parseTimeSlot('afternoon')).toBe('afternoon')
    expect(parseTimeSlot('specific')).toBe('specific')
    expect(parseTimeSlot('mañana')).toBe('morning')
    expect(parseTimeSlot('tarde')).toBe('afternoon')
    expect(parseTimeSlot('todo el día')).toBe(null)
    expect(parseTimeSlot(null)).toBe(null)
  })
})

describe('formatPickupSlotLine', () => {
  it('muestra el turno de retiro como en PC', () => {
    expect(formatPickupSlotLine('morning', null)).toBe('Turno mañana')
    expect(formatPickupSlotLine('afternoon', null)).toBe('Turno tarde')
    expect(formatPickupSlotLine('specific', '18:30')).toBe('18:30')
    expect(formatPickupSlotLine(null, null)).toBe(null)
  })

  it('si hay horarios del local, el específico dice el turno', () => {
    const hours = {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }
    expect(formatPickupSlotLine('specific', '11:00', hours)).toBe('Turno mañana · 11:00')
    expect(formatPickupSlotLine('specific', '17:00', hours)).toBe('Turno tarde · 17:00')
  })
})

describe('depositPayments', () => {
  it('parsea JSON string de Firestore y arrays', () => {
    const payments = [{ method: 'cash' as const, amount: 1000 }, { method: 'debit' as const, amount: 500 }]
    expect(parseDepositPayments(JSON.stringify(payments))).toEqual(payments)
    expect(parseDepositPayments(payments)).toEqual(payments)
  })

  it('trata 0 / vacío / inválido como sin seña', () => {
    expect(parseDepositPayments(0)).toBe(null)
    expect(parseDepositPayments('')).toBe(null)
    expect(parseDepositPayments(null)).toBe(null)
    expect(parseDepositPayments('not-json')).toBe(null)
    expect(parseDepositPayments([{ method: 'cash', amount: 0 }])).toBe(null)
  })

  it('serializa solo montos positivos', () => {
    expect(serializeDepositPayments([{ method: 'cash', amount: 2000 }])).toBe(
      JSON.stringify([{ method: 'cash', amount: 2000 }]),
    )
    expect(serializeDepositPayments([{ method: 'cash', amount: 0 }])).toBe(null)
    expect(depositTotal([{ method: 'cash', amount: 100 }, { method: 'wallet', amount: 50 }])).toBe(150)
  })

  it('arma el desglose de medios de la seña', () => {
    expect(formatDepositPaymentsLine(
      [{ method: 'cash', amount: 10000 }, { method: 'debit', amount: 20000 }],
      { formatAmount: n => `$${n}` },
    )).toBe('Efectivo $10000 · Débito $20000')
    expect(formatDepositPaymentsLine(null, {
      fallbackMethod: 'cash',
      fallbackAmount: 5000,
      formatAmount: n => `$${n}`,
    })).toBe('Efectivo $5000')
    expect(formatDepositPaymentsLine(null)).toBe(null)
  })
})

describe('defaultCreateStoreId', () => {
  it('hereda el local del filtro y queda vacío en Todos', () => {
    expect(defaultCreateStoreId('store-camarones')).toBe('store-camarones')
    expect(defaultCreateStoreId('')).toBe('')
  })
})

describe('validateMobileOrderDraft / toMobileOrderRecord', () => {
  it('exige nombre, ítems, local y createdBy', () => {
    expect(validateMobileOrderDraft(draft({ customerName: '  ' }))).toMatch(/nombre/i)
    expect(validateMobileOrderDraft(draft({ items: '' }))).toMatch(/ítems/i)
    expect(validateMobileOrderDraft(draft({ storeId: '' }))).toMatch(/local/i)
    expect(validateMobileOrderDraft(draft({ createdBy: '' }))).toMatch(/usuario autenticado/i)
    expect(validateMobileOrderDraft(draft())).toBe(null)
  })

  it('exige horario si el slot es específico', () => {
    expect(validateMobileOrderDraft(draft({ timeSlot: 'specific', pickupTime: '' }))).toMatch(/horario/i)
    expect(validateMobileOrderDraft(draft({ timeSlot: 'specific', pickupTime: '18:30' }))).toBe(null)
  })

  it('rechaza un horario específico con el local cerrado cuando hay franjas', () => {
    const hours = {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
    }
    expect(validateMobileOrderDraft(draft({ timeSlot: 'specific', pickupTime: '15:00' }), hours)).toMatch(/cerrado/i)
    expect(validateMobileOrderDraft(draft({ timeSlot: 'specific', pickupTime: '11:00' }), hours)).toBe(null)
  })

  it('rechaza turno tarde un domingo que solo abre de mañana', () => {
    const hours: StoreHoursSource = {
      morningStart: '08:00',
      morningEnd: '14:00',
      afternoonStart: '16:00',
      afternoonEnd: '20:30',
      hoursSchedule: [
        {
          days: [1, 2, 3, 4, 5, 6],
          morningStart: '08:00',
          morningEnd: '14:00',
          afternoonStart: '16:00',
          afternoonEnd: '20:30',
        },
        {
          days: [0],
          morningStart: '08:00',
          morningEnd: '14:00',
          afternoonStart: null,
          afternoonEnd: null,
        },
      ],
    }
    expect(validateMobileOrderDraft(draft({ pickupDate: '2026-09-06', timeSlot: 'afternoon' }), hours)).toMatch(/tarde/)
    expect(validateMobileOrderDraft(draft({ pickupDate: '2026-09-07', timeSlot: 'afternoon' }), hours)).toBe(null)
    expect(validateMobileOrderDraft(draft({ pickupDate: '2026-09-06', timeSlot: 'morning' }), hours)).toBe(null)
  })

  it('el payload de Firestore siempre lleva createdBy y seña serializada', () => {
    const record = toMobileOrderRecord(
      draft({
        priority: true,
        payments: [{ method: 'cash', amount: 1000 }, { method: 'debit', amount: 500 }],
        notes: 'sin hueso',
      }),
      '2026-08-18T03:00:00.000Z',
    )
    expect(record.createdBy).toBe('uid-admin')
    expect(record.createdBy.length).toBeGreaterThan(0)
    expect(record.priority).toBe(true)
    expect(record.depositAmount).toBe(1500)
    expect(record.depositPayments).toBe(
      JSON.stringify([{ method: 'cash', amount: 1000 }, { method: 'debit', amount: 500 }]),
    )
    expect(record.status).toBe('pending')
    expect(record.notes).toBe('sin hueso')
  })
})
