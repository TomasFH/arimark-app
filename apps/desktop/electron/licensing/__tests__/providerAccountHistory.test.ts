import { describe, expect, it } from 'vitest'
import {
  mergeProviderAccountTails,
  providerNotebookMatchesLedger,
  weaveProviderVisits,
  type ProviderAccountEvent,
  type ProviderAccountVisit,
} from '../providerAccountHistory'

function event(partial: Partial<ProviderAccountEvent> & Pick<ProviderAccountEvent, 'id'>): ProviderAccountEvent {
  return {
    type: 'debt',
    amount: 1000,
    storeId: 'cam',
    createdAt: '2026-11-25T12:00:00.000Z',
    createdBy: 'user',
    expenseId: null,
    notes: null,
    ...partial,
  }
}

describe('mergeProviderAccountTails', () => {
  it('guarda el corte y deja afuera lo ya plegado', () => {
    const merged = mergeProviderAccountTails({
      slices: [{
        storeId: 'cam',
        openingBalance: 4000,
        hasCheckpoint: true,
        events: [event({ id: 'tail', amount: 500, createdAt: '2026-11-20T12:00:00.000Z' })],
      }],
      unsynced: [],
    })
    expect(merged.openings).toEqual([{ storeId: 'cam', balance: 4000, hasCheckpoint: true, checkpointAt: null }])
    expect(merged.events.map(row => row.id)).toEqual(['tail'])
  })

  it('suma un movimiento de esta PC que todavía no subió, sin duplicar la cola', () => {
    const tail = event({ id: 'tail', createdAt: '2026-11-20T12:00:00.000Z' })
    const pending = event({ id: 'pending', type: 'payment', amount: 300, createdAt: '2026-11-25T15:00:00.000Z' })
    const merged = mergeProviderAccountTails({
      slices: [{ storeId: 'cam', openingBalance: 4000, hasCheckpoint: true, events: [tail] }],
      unsynced: [tail, pending],
    })
    expect(merged.events.map(row => row.id)).toEqual(['pending', 'tail'])
  })
})

function visit(partial: Partial<ProviderAccountVisit> & Pick<ProviderAccountVisit, 'id' | 'paidAmount' | 'debtAmount'>): ProviderAccountVisit {
  return {
    storeId: 'sm',
    createdAt: '2026-11-27T13:00:00.000Z',
    createdBy: 'ana',
    expenseId: 'exp-1',
    concept: 'Pan rallado',
    ...partial,
  }
}

describe('weaveProviderVisits', () => {
  it('una visita pagada entera es cargo y abono, y el saldo queda igual', () => {
    const lines = weaveProviderVisits({
      events: [],
      visits: [visit({ id: 'pan', paidAmount: 60_000, debtAmount: 0 })],
    })
    expect(lines.find(line => line.role === 'cargo')).toMatchObject({ amount: 60_000, concept: 'Pan rallado' })
    expect(lines.find(line => line.role === 'abono')).toMatchObject({ amount: 60_000 })
    expect(providerNotebookMatchesLedger([], lines)).toBe(true)
  })

  it('una visita a cuenta es un cargo, sin abono', () => {
    const debt = event({ id: 'deuda', amount: 100_000, expenseId: 'exp-1', storeId: 'sm' })
    const lines = weaveProviderVisits({
      events: [debt],
      visits: [visit({ id: 'cuenta', paidAmount: 0, debtAmount: 100_000, concept: 'Asado' })],
    })
    expect(lines.map(line => line.role)).toEqual(['cargo'])
    expect(lines[0]).toMatchObject({ amount: 100_000 })
    expect(providerNotebookMatchesLedger([debt], lines)).toBe(true)
  })

  it('un pago de deuda vieja queda como abono junto al cargo de la visita', () => {
    const debt = event({ id: 'deuda', amount: 80_000, expenseId: 'exp-1', storeId: 'sm' })
    const oldPayment = event({
      id: 'pago-viejo',
      type: 'payment',
      amount: 15_000,
      expenseId: 'exp-1',
      storeId: 'sm',
    })
    const lines = weaveProviderVisits({
      events: [debt, oldPayment],
      visits: [visit({ id: 'mixta', paidAmount: 20_000, debtAmount: 80_000, concept: 'Vacío' })],
    })
    expect(lines.find(line => line.role === 'cargo')).toMatchObject({ amount: 100_000 })
    expect(lines.find(line => line.id === 'visit-paid:mixta')).toMatchObject({ amount: 20_000, role: 'abono' })
    expect(lines.find(line => line.id === 'pago-viejo')).toMatchObject({ amount: 15_000, role: 'abono' })
    expect(lines.some(line => line.id === 'deuda')).toBe(false)
    expect(providerNotebookMatchesLedger([debt, oldPayment], lines)).toBe(true)
  })
})
