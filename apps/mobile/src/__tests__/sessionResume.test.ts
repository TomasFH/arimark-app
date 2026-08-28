import { describe, it, expect } from 'vitest'
import { pickOpenShiftForUser } from '../lib/sessionResume'
import { remainderForField, paidTotal } from '../lib/paymentSplit'

describe('pickOpenShiftForUser', () => {
  it('elige el turno abierto de esa cuenta, el más reciente', () => {
    const shifts = [
      { id: 'old', userId: 'ana', storeId: 'a', closedAt: null, startedAt: '2026-08-25T08:00:00.000Z' },
      { id: 'new', userId: 'ana', storeId: 'b', closedAt: null, startedAt: '2026-08-25T12:00:00.000Z' },
      { id: 'other', userId: 'luis', storeId: 'a', closedAt: null, startedAt: '2026-08-25T13:00:00.000Z' },
      { id: 'closed', userId: 'ana', storeId: 'a', closedAt: '2026-08-25T14:00:00.000Z', startedAt: '2026-08-25T14:00:00.000Z' },
    ]
    expect(pickOpenShiftForUser(shifts, 'ana')?.id).toBe('new')
  })

  it('null si no hay turno abierto', () => {
    expect(pickOpenShiftForUser([{ id: 'x', userId: 'ana', closedAt: 't', startedAt: 't' }], 'ana')).toBeNull()
  })
})

describe('paymentSplit', () => {
  it('resto ignora el campo actual; campos vacíos no cubren el total', () => {
    const amounts = { cash: '', debit: '4.000', wallet: '', credit: '' }
    expect(remainderForField(10000, amounts, 'cash')).toBe(6000)
    expect(remainderForField(10000, amounts, 'debit')).toBe(10000)
    expect(paidTotal({ cash: '', debit: '', wallet: '', credit: '' })).toBe(0)
  })
})
