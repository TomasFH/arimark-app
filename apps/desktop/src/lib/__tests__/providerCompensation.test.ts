import { describe, it, expect } from 'vitest'
import { planProviderStoreCompensation, previewCompensatedBalances } from '../providerCompensation'

describe('previewCompensatedBalances', () => {
  it('deja el resto a pagar en el local con más deuda', () => {
    expect(previewCompensatedBalances({
      cam: -50000,
      sm: 99999,
    })).toEqual({
      cam: 0,
      sm: 49999,
    })
  })

  it('sin mixto no cambia nada', () => {
    expect(previewCompensatedBalances({ sm: 10000 })).toEqual({ sm: 10000 })
    expect(previewCompensatedBalances({ cam: -2000 })).toEqual({ cam: -2000 })
  })

  it('planifica eventos de crédito y pago', () => {
    expect(planProviderStoreCompensation({ cam: -50000, sm: 50000 })).toEqual([
      { storeId: 'cam', type: 'debt', amount: 50000 },
      { storeId: 'sm', type: 'payment', amount: 50000 },
    ])
  })
})
