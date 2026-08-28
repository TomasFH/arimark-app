import { describe, it, expect, beforeEach } from 'vitest'
import { setDisplayTimezone } from '../datetime'
import {
  canPayCurrentSalaryWeek,
  mergeSalaryPayments,
  snapshotToValeLines,
  valeInLocalWeek,
} from '../salaryWeekView'
import type { SalaryPaymentRow } from '../../types/hw-api'

const TZ = 'America/Argentina/Buenos_Aires'

beforeEach(() => {
  setDisplayTimezone(TZ)
})

function payment(partial: Partial<SalaryPaymentRow> & { employeeId: string }): SalaryPaymentRow {
  return {
    id: partial.id ?? `pay-${partial.employeeId}`,
    employeeId: partial.employeeId,
    shiftId: partial.shiftId ?? 'shift-1',
    amount: partial.amount ?? 100000,
    weekStart: partial.weekStart ?? '2026-07-27',
    valesDeducted: partial.valesDeducted ?? 0,
    netPaid: partial.netPaid ?? 100000,
    recordedBy: partial.recordedBy ?? 'user-1',
    paidAt: partial.paidAt ?? '2026-07-27T15:00:00.000Z',
    notes: partial.notes ?? null,
    valesSnapshot: partial.valesSnapshot ?? null,
  }
}

describe('valeInLocalWeek', () => {
  const weekStart = '2026-07-27'
  const weekEnd = '2026-08-02'

  it('incluye un vale del lunes local y excluye el de la semana previa', () => {
    expect(valeInLocalWeek('2026-07-27T12:00:00.000Z', weekStart, weekEnd)).toBe(true)
    expect(valeInLocalWeek('2026-07-26T12:00:00.000Z', weekStart, weekEnd)).toBe(false)
  })

  it('incluye el domingo de esa semana', () => {
    expect(valeInLocalWeek('2026-08-02T20:00:00.000Z', weekStart, weekEnd)).toBe(true)
  })

  it('rechaza string vacío', () => {
    expect(valeInLocalWeek('', weekStart, weekEnd)).toBe(false)
  })
})

describe('snapshotToValeLines', () => {
  it('null o vacío no rompe la lista', () => {
    expect(snapshotToValeLines(null)).toEqual([])
    expect(snapshotToValeLines([])).toEqual([])
  })

  it('mapea el snapshot archivado sin storeId', () => {
    const lines = snapshotToValeLines([
      { id: 'v1', amount: 5000, description: 'fiambre', paidAt: '2026-07-28T12:00:00.000Z' },
    ])
    expect(lines).toEqual([
      {
        id: 'v1',
        amount: 5000,
        description: 'fiambre',
        paidAt: '2026-07-28T12:00:00.000Z',
        storeId: null,
      },
    ])
  })
})

describe('mergeSalaryPayments', () => {
  it('el pago local pisa al remoto del mismo empleado', () => {
    const remote = [payment({ employeeId: 'a', netPaid: 1, id: 'remote' })]
    const local = [payment({ employeeId: 'a', netPaid: 2, id: 'local' })]
    const merged = mergeSalaryPayments(local, remote)
    expect(merged.get('a')?.id).toBe('local')
    expect(merged.get('a')?.netPaid).toBe(2)
  })

  it('conserva pagos que solo están en remoto', () => {
    const remote = [payment({ employeeId: 'b', id: 'only-remote' })]
    const merged = mergeSalaryPayments([], remote)
    expect(merged.get('b')?.id).toBe('only-remote')
  })
})

describe('canPayCurrentSalaryWeek', () => {
  it('solo la semana en curso y con turno abierto', () => {
    expect(canPayCurrentSalaryWeek('2026-07-27', '2026-07-27', true)).toBe(true)
    expect(canPayCurrentSalaryWeek('2026-07-20', '2026-07-27', true)).toBe(false)
    expect(canPayCurrentSalaryWeek('2026-08-03', '2026-07-27', true)).toBe(false)
    expect(canPayCurrentSalaryWeek('2026-07-27', '2026-07-27', false)).toBe(false)
  })
})
