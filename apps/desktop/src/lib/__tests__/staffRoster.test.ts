import { describe, it, expect } from 'vitest'
import { buildStaffRoster } from '../staffRoster'

describe('buildStaffRoster', () => {
  it('une cajera de login con ficha de sueldo por nombre', () => {
    const roster = buildStaffRoster(
      [{ uid: 'u1', displayName: 'Ana Pérez', email: 'ana@x.com', active: true }],
      [{ id: 'e1', name: 'ana pérez', weeklyWage: 80000, active: true, kind: 'cashier' }],
    )
    expect(roster.cashiers).toHaveLength(1)
    expect(roster.cashiers[0]).toMatchObject({
      weeklyWage: 80000,
      cashierUid: 'u1',
      employeeId: 'e1',
      email: 'ana@x.com',
    })
    expect(roster.butchers).toHaveLength(0)
  })

  it('lista cajera sin ficha y ficha cashier sin cuenta de app', () => {
    const roster = buildStaffRoster(
      [{ uid: 'u1', displayName: 'Ana', email: 'ana@x.com', active: true }],
      [{ id: 'e2', name: 'Lucía', weeklyWage: 50000, active: true, kind: 'cashier' }],
    )
    expect(roster.cashiers).toHaveLength(2)
    const ana = roster.cashiers.find(c => c.name === 'Ana')
    const lucia = roster.cashiers.find(c => c.name === 'Lucía')
    expect(ana?.employeeId).toBeNull()
    expect(ana?.weeklyWage).toBe(0)
    expect(lucia?.cashierUid).toBeNull()
  })

  it('no mezcla carniceros con cajeras aunque el nombre coincida', () => {
    const roster = buildStaffRoster(
      [{ uid: 'u1', displayName: 'Juan', email: 'j@x.com', active: true }],
      [{ id: 'e1', name: 'Juan', weeklyWage: 90000, active: true, kind: 'butcher' }],
    )
    expect(roster.cashiers[0]?.weeklyWage).toBe(0)
    expect(roster.butchers).toHaveLength(1)
    expect(roster.butchers[0]?.employeeId).toBe('e1')
  })

  it('trata kind ausente como carnicero', () => {
    const roster = buildStaffRoster(
      [],
      [{ id: 'e1', name: 'Pedro', weeklyWage: 1, active: true }],
    )
    expect(roster.butchers).toHaveLength(1)
    expect(roster.cashiers).toHaveLength(0)
  })
})
