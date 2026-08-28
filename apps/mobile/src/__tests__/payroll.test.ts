import { describe, it, expect } from 'vitest'
import {
  addDaysYmd,
  firestorePaidAtBounds,
  formatDisplayDate,
  formatYmd,
  valeInLocalWeek,
  weekStartMondayLocalYmd,
} from '../lib/week'
import { buildWeeklyPayroll, mergePayrollWithPayments } from '../lib/payroll'

describe('week lun–dom', () => {
  it('suma días sobre YYYY-MM-DD', () => {
    expect(addDaysYmd('2026-07-28', 6)).toBe('2026-08-03')
    expect(addDaysYmd('2026-08-03', -6)).toBe('2026-07-28')
  })

  it('resuelve el lunes de la semana', () => {
    expect(weekStartMondayLocalYmd('2026-07-28')).toBe('2026-07-27')
    expect(weekStartMondayLocalYmd('2026-08-02')).toBe('2026-07-27')
    expect(weekStartMondayLocalYmd('2026-07-27')).toBe('2026-07-27')
  })

  it('formatea dd/mm/aaaa', () => {
    expect(formatYmd('2026-08-16')).toBe('16/08/2026')
  })

  it('no atrasa un día civil YYYY-MM-DD (retiro de pedido)', () => {
    expect(formatDisplayDate('2026-08-30')).toBe('30/08/2026')
    expect(formatDisplayDate('2026-08-26')).toBe('26/08/2026')
    expect(formatDisplayDate('2026-08-30')).not.toBe('29/08/2026')
  })

  it('incluye un vale del lunes local y excluye el de la semana previa', () => {
    const weekStart = '2026-07-27'
    const weekEnd = '2026-08-02'
    expect(valeInLocalWeek('2026-07-27T12:00:00.000Z', weekStart, weekEnd)).toBe(true)
    expect(valeInLocalWeek('2026-07-26T12:00:00.000Z', weekStart, weekEnd)).toBe(false)
  })

  it('el recorte Firestore es más ancho que la semana civil', () => {
    const b = firestorePaidAtBounds('2026-07-27', '2026-08-02')
    expect(b.from < '2026-07-27T00:00:00.000Z').toBe(true)
    expect(b.to > '2026-08-02T23:59:59.000Z').toBe(true)
  })
})

describe('buildWeeklyPayroll', () => {
  const weekStart = '2026-07-27'
  const weekEnd = '2026-08-02'
  const ana = {
    id: 'a', name: 'Ana', weeklyWage: 100000, archivedAt: null, deleted: false,
  }
  const bob = {
    id: 'b', name: 'Bob', weeklyWage: 80000, archivedAt: null, deleted: false,
  }

  it('resta vales de la semana y omite cancelados, otra semana y archivados', () => {
    const rows = buildWeeklyPayroll(
      [
        ana,
        bob,
        { id: 'c', name: 'Cero', weeklyWage: 0, archivedAt: null, deleted: false },
        { id: 'd', name: 'Arch', weeklyWage: 50000, archivedAt: 'x', deleted: false },
      ],
      [
        { id: 'v1', employeeId: 'a', amount: 10000, description: 'fiambre', paidAt: '2026-07-28T12:00:00.000Z' },
        { id: 'v2', employeeId: 'a', amount: 5000, description: 'x', paidAt: '2026-07-28T13:00:00.000Z', cancelledAt: '2026-07-28T14:00:00.000Z' },
        { id: 'v3', employeeId: 'a', amount: 999, description: 'viejo', paidAt: '2026-07-20T12:00:00.000Z' },
        { id: 'v4', employeeId: 'b', amount: 80000, description: 'todo', paidAt: '2026-07-29T12:00:00.000Z' },
      ],
      weekStart,
      weekEnd,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ weeklyWage: 100000, totalVales: 10000, netToPay: 90000 })
    expect(rows[0].vales).toHaveLength(1)
    expect(rows[1]).toMatchObject({ weeklyWage: 80000, totalVales: 80000, netToPay: 0 })
    expect(rows[0].payment).toBeNull()
  })

  it('congela sueldo y vales cuando hay pago archivado', () => {
    const live = buildWeeklyPayroll(
      [ana],
      [{ id: 'v1', employeeId: 'a', amount: 10000, description: 'nuevo', paidAt: '2026-07-28T12:00:00.000Z' }],
      weekStart,
      weekEnd,
    )
    const merged = mergePayrollWithPayments(
      live,
      [{
        id: 'p1',
        employeeId: 'a',
        amount: 100000,
        valesDeducted: 70000,
        netPaid: 30000,
        notes: 'Llegó tarde 2 veces',
        paidAt: '2026-08-02T18:00:00.000Z',
        valesSnapshot: [
          { id: 'old', employeeId: 'a', amount: 70000, description: 'adelanto', paidAt: '2026-07-28T10:00:00.000Z' },
        ],
      }],
      [ana],
    )
    expect(merged[0]).toMatchObject({
      weeklyWage: 100000,
      totalVales: 70000,
      netToPay: 30000,
    })
    expect(merged[0].payment?.notes).toBe('Llegó tarde 2 veces')
    expect(merged[0].vales).toHaveLength(1)
    expect(merged[0].vales[0].id).toBe('old')
  })
})
