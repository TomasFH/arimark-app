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
  toMobileOrderPatch,
  resolvedBudgetLines,
  estimatedBudgetTotal,
  budgetDraftFromLines,
  formatPickupSlotLine,
  type MobileOrderDraft,
  type BudgetCartDraft,
} from '../lib/orderMapping'
import type { StoreHoursSource } from '@carniceria/shared'

function sampleCart(): BudgetCartDraft[] {
  return [{
    productId: 'p1',
    name: 'Asado',
    unit: 'kg',
    pluNumber: 10,
    estimatedQty: 1.5,
    unitPrice: 18000,
    qtyRaw: '1,5',
    requestedUnitsRaw: '',
  }]
}

function draft(overrides: Partial<MobileOrderDraft> = {}): MobileOrderDraft {
  return {
    storeId: 'store-1',
    customerName: 'Juan',
    phone: '111',
    items: '',
    pickupDate: '2026-08-18',
    timeSlot: '',
    pickupTime: '',
    priority: false,
    payments: [],
    notes: '',
    createdBy: 'uid-admin',
    budgetCart: sampleCart(),
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
  it('exige nombre, productos, local y createdBy', () => {
    expect(validateMobileOrderDraft(draft({ customerName: '  ' }))).toMatch(/nombre/i)
    expect(validateMobileOrderDraft(draft({ budgetCart: [], items: '' }))).toMatch(/producto/i)
    expect(validateMobileOrderDraft(draft({ storeId: '' }))).toMatch(/local/i)
    expect(validateMobileOrderDraft(draft({ createdBy: '' }))).toMatch(/usuario autenticado/i)
    expect(validateMobileOrderDraft(draft())).toBe(null)
  })

  it('pedidos viejos solo-texto siguen editables', () => {
    const legacy = draft({ budgetCart: [], items: '2 kg asado' })
    expect(validateMobileOrderDraft(legacy)).toMatch(/producto/i)
    expect(validateMobileOrderDraft(legacy, undefined, { allowLegacyText: true })).toBe(null)
    expect(validateMobileOrderDraft(draft({ budgetCart: [], items: '' }), undefined, { allowLegacyText: true })).toMatch(/ítems/i)
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
    expect(record.budgetItems).toEqual([{
      productId: 'p1',
      name: 'Asado',
      unit: 'kg',
      pluNumber: 10,
      estimatedQty: 1.5,
      unitPrice: 18000,
      requestedUnits: null,
    }])
    expect(record.items).toBe('Asado · 1,5 kg')
  })
})

describe('carrito de presupuesto', () => {
  it('resuelve kg, piezas y unidades de catálogo', () => {
    const kg: BudgetCartDraft = {
      productId: 'p1', name: 'Asado', unit: 'kg', pluNumber: 10,
      estimatedQty: 0, unitPrice: 18000, qtyRaw: '1,5', requestedUnitsRaw: '',
    }
    const piezas: BudgetCartDraft = {
      productId: 'p2', name: 'Morcilla', unit: 'kg', pluNumber: 20,
      estimatedQty: 0, unitPrice: 9000, qtyRaw: '', requestedUnitsRaw: '3',
    }
    const unidad: BudgetCartDraft = {
      productId: 'p3', name: 'Huevos', unit: 'unit', pluNumber: 250,
      estimatedQty: 0, unitPrice: 6000, qtyRaw: '12', requestedUnitsRaw: '',
    }
    const lines = resolvedBudgetLines([kg, piezas, unidad])
    expect(lines).toEqual([
      {
        productId: 'p1', name: 'Asado', unit: 'kg', pluNumber: 10,
        estimatedQty: 1.5, unitPrice: 18000, requestedUnits: null,
      },
      {
        productId: 'p2', name: 'Morcilla', unit: 'kg', pluNumber: 20,
        estimatedQty: 0, unitPrice: 9000, requestedUnits: 3,
      },
      {
        productId: 'p3', name: 'Huevos', unit: 'unit', pluNumber: 250,
        estimatedQty: 12, unitPrice: 6000,
      },
    ])
    expect(estimatedBudgetTotal(lines)).toBe(Math.round(18000 * 1.5) + Math.round(6000 * 12))
  })

  it('rechaza líneas sin cantidad y arma items con summarize', () => {
    const emptyLine: BudgetCartDraft = {
      ...sampleCart()[0]!,
      qtyRaw: '',
      requestedUnitsRaw: '',
    }
    expect(validateMobileOrderDraft(draft({ budgetCart: [emptyLine] }))).toMatch(/cantidad/i)
    const record = toMobileOrderRecord(draft({
      budgetCart: [{
        productId: 'p2', name: 'Morcilla', unit: 'kg', pluNumber: 20,
        estimatedQty: 0, unitPrice: 9000, qtyRaw: '1', requestedUnitsRaw: '3',
      }],
    }), '2026-08-18T03:00:00.000Z')
    expect(record.items).toBe('Morcilla · 3 u (~1 kg)')
    expect(record.budgetItems?.[0]?.requestedUnits).toBe(3)
  })

  it('el patch de edición no pisa status y conserva texto legado', () => {
    const patch = toMobileOrderPatch(
      draft({ budgetCart: [], items: '2 kg asado' }),
      '2026-08-18T04:00:00.000Z',
    )
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('createdBy')
    expect(patch.items).toBe('2 kg asado')
    expect(patch.budgetItems).toBe(null)
    expect(patch.updatedAt).toBe('2026-08-18T04:00:00.000Z')
  })

  it('budgetDraftFromLines rehidrata qty para editar', () => {
    const draftLines = budgetDraftFromLines([
      {
        productId: 'p1', name: 'Asado', unit: 'kg', pluNumber: 10,
        estimatedQty: 1.5, unitPrice: 18000,
      },
      {
        productId: 'p2', name: 'Morcilla', unit: 'kg', pluNumber: 20,
        estimatedQty: 0, unitPrice: 9000, requestedUnits: 3,
      },
    ])
    expect(draftLines[0]?.qtyRaw).toBe('1,5')
    expect(draftLines[1]?.requestedUnitsRaw).toBe('3')
    expect(draftLines[1]?.qtyRaw).toBe('')
  })
})
