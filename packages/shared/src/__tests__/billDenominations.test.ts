import { describe, expect, it } from 'vitest'
import {
  ARS_BILL_DENOMINATIONS,
  billLinesDiff,
  billLinesTotal,
  buildCashHandoverAudit,
  compactBillLines,
  isEmptyBillCount,
  parseBillLines,
} from '../billDenominations'

describe('billDenominations', () => {
  it('no incluye el billete de 5000', () => {
    expect(ARS_BILL_DENOMINATIONS).toEqual([20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10])
    expect(ARS_BILL_DENOMINATIONS).not.toContain(5000)
  })

  it('compacta, suma y trata vacío', () => {
    expect(compactBillLines([
      { denomination: 1000, quantity: 2 },
      { denomination: 1000, quantity: 1 },
      { denomination: 500, quantity: 0 },
      { denomination: 7, quantity: 4 },
    ])).toEqual([{ denomination: 1000, quantity: 3 }])
    expect(billLinesTotal([{ denomination: 20000, quantity: 1 }, { denomination: 100, quantity: 2 }])).toBe(20200)
    expect(isEmptyBillCount([{ denomination: 1000, quantity: 0 }])).toBe(true)
    expect(isEmptyBillCount([])).toBe(true)
  })

  it('parsea arrays de Firestore e ignora basura', () => {
    expect(parseBillLines(null)).toEqual([])
    expect(parseBillLines([
      { denomination: 1000, quantity: 4 },
      { denomination: '500', quantity: '2' },
      { foo: 1 },
      { denomination: 50, quantity: -1 },
    ])).toEqual([
      { denomination: 1000, quantity: 4 },
      { denomination: 500, quantity: 2 },
    ])
  })

  it('calcula diferencia dejó vs encontró por denominación', () => {
    const diffs = billLinesDiff(
      [{ denomination: 1000, quantity: 5 }, { denomination: 500, quantity: 2 }],
      [{ denomination: 1000, quantity: 4 }, { denomination: 200, quantity: 1 }],
    )
    expect(diffs).toEqual([
      { denomination: 1000, expectedQty: 5, foundQty: 4, qtyDiff: -1, amountDiff: -1000 },
      { denomination: 500, expectedQty: 2, foundQty: 0, qtyDiff: -2, amountDiff: -1000 },
      { denomination: 200, expectedQty: 0, foundQty: 1, qtyDiff: 1, amountDiff: 200 },
    ])
    expect(billLinesTotal(diffs.map(d => ({ denomination: d.denomination, quantity: 0 })))).toBe(0)
  })

  it('arma auditoría sin pisar el cierre: encontró vs esperado', () => {
    const audit = buildCashHandoverAudit({
      cashierName: 'Lucía',
      startedAt: '2026-09-11T12:00:00.000Z',
      closedAt: '2026-09-11T20:00:00.000Z',
      openingBills: [{ denomination: 1000, quantity: 3 }],
      closingBills: [{ denomination: 1000, quantity: 8 }],
      openingCounted: true,
      closingCounted: true,
      handover: {
        fromShiftId: 'prev',
        fromCashierName: 'Ana',
        fromClosedAt: '2026-09-11T11:50:00.000Z',
        expectedBills: [{ denomination: 1000, quantity: 5 }],
      },
    })
    expect(audit.found?.total).toBe(3000)
    expect(audit.left?.total).toBe(8000)
    expect(audit.expected?.cashierName).toBe('Ana')
    expect(audit.expected?.total).toBe(5000)
    expect(audit.amountDiff).toBe(-2000)
  })

  it('no inventa lo esperado si la apertura no contó (omitir en dev)', () => {
    const audit = buildCashHandoverAudit({
      cashierName: 'Lucía',
      startedAt: '2026-09-11T12:00:00.000Z',
      closedAt: null,
      openingBills: [],
      closingBills: [],
      openingCounted: false,
      closingCounted: false,
      handover: {
        fromShiftId: 'prev',
        fromCashierName: 'Ana',
        fromClosedAt: '2026-09-11T11:50:00.000Z',
        expectedBills: [],
      },
    })
    expect(audit.expected).toBeNull()
    expect(audit.found).toBeNull()
  })

  it('no inventa “dejó $0” si el cierre viejo no contó', () => {
    const audit = buildCashHandoverAudit({
      cashierName: 'Ana',
      startedAt: '2026-09-11T08:00:00.000Z',
      closedAt: '2026-09-11T16:00:00.000Z',
      openingBills: [],
      closingBills: [],
      openingCounted: false,
      closingCounted: false,
    })
    expect(audit.left).toBeNull()
    expect(audit.found).toBeNull()
    expect(audit.expected).toBeNull()
    expect(audit.amountDiff).toBeNull()
  })
})
