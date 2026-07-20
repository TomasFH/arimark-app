import { beforeEach, describe, expect, it } from 'vitest'
import { getActiveSession, setActiveSession, updateActiveShift } from '../activeSession'

describe('activeSession', () => {
  beforeEach(() => {
    setActiveSession(null)
  })

  it('guarda y devuelve la sesión activa', () => {
    const session = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: null }
    setActiveSession(session)

    expect(getActiveSession()).toEqual(session)
  })

  it('actualiza únicamente el turno de una sesión activa', () => {
    setActiveSession({ userId: 'user-001', storeId: 'store-001', role: 'cashier', shiftId: null })

    updateActiveShift('shift-001')

    expect(getActiveSession()).toEqual({
      userId: 'user-001',
      storeId: 'store-001',
      role: 'cashier',
      shiftId: 'shift-001',
    })
  })

  it('no falla al actualizar turno sin una sesión activa', () => {
    updateActiveShift('shift-001')

    expect(getActiveSession()).toBeNull()
  })
})
