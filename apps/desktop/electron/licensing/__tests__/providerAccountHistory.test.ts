import { describe, expect, it } from 'vitest'
import { mergeProviderAccountTails, type ProviderAccountEvent } from '../providerAccountHistory'

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
    expect(merged.openings).toEqual([{ storeId: 'cam', balance: 4000, hasCheckpoint: true }])
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
