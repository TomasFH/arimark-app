import { describe, expect, it } from 'vitest'
import { normalizeProviderAccount } from '../providerAccount'
import type { ProviderDebtEventRow } from '../../types/hw-api'

const CAMARONES = 'a497ca07-3777-4855-be66-b6e47950886b'

const adjust: ProviderDebtEventRow = {
  id: 'f2da4f63-78dc-4ac2-96d7-9b5630fda6c3',
  type: 'payment',
  amount: 255978,
  storeId: CAMARONES,
  storeName: 'Camarones',
  createdAt: '2026-11-25T19:19:45.844Z',
  createdByName: 'Admin Prueba',
  expenseId: null,
  notes: 'Ajuste de admin (Admin Prueba): dejó el saldo en $ 0',
}

describe('normalizeProviderAccount', () => {
  it('una lista pelada de movimientos no deja openings sin recorrer', () => {
    const account = normalizeProviderAccount([adjust])
    expect([...account.openings]).toEqual([])
    expect(account.events.map(event => event.id)).toEqual([adjust.id])
  })

  it('el corte de Camarones se puede recorrer', () => {
    const account = normalizeProviderAccount({
      openings: [{
        storeId: CAMARONES,
        storeName: 'Camarones',
        balance: 255978,
        hasCheckpoint: true,
      }],
      events: [adjust],
    })
    const balances = []
    for (const opening of account.openings) balances.push(opening.balance)
    expect(balances).toEqual([255978])
    expect(account.openings[0]?.hasCheckpoint).toBe(true)
  })
})
