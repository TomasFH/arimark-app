import { describe, expect, it } from 'vitest'
import { providerBalanceFromSources } from '../providerStoreBalance'

describe('providerBalanceFromSources', () => {
  it('sin Firebase suma todo el ledger local', () => {
    const balance = providerBalanceFromSources({
      firebaseOn: false,
      liveBalance: 255_978,
      remoteBalance: 255_978,
      events: [
        { type: 'debt', amount: 1_780_914, syncedAt: '2026-10-22T00:00:00.000Z' },
        { type: 'debt', amount: 255_978, syncedAt: '2026-11-25T00:00:00.000Z' },
      ],
    })
    expect(balance).toBe(2_036_892)
  })

  it('con el listener no vuelve a sumar lo ya plegado', () => {
    const balance = providerBalanceFromSources({
      firebaseOn: true,
      liveBalance: 255_978,
      remoteBalance: null,
      events: [
        { type: 'debt', amount: 1_780_914, syncedAt: '2026-10-22T00:00:00.000Z' },
        { type: 'debt', amount: 255_978, syncedAt: '2026-11-25T00:00:00.000Z' },
      ],
    })
    expect(balance).toBe(255_978)
  })

  it('suma un movimiento local que todavía no se subió', () => {
    const balance = providerBalanceFromSources({
      firebaseOn: true,
      liveBalance: 255_978,
      remoteBalance: null,
      events: [
        { type: 'debt', amount: 1_780_914, syncedAt: '2026-10-22T00:00:00.000Z' },
        { type: 'payment', amount: 255_978, syncedAt: null },
      ],
    })
    expect(balance).toBe(0)
  })

  it('si el listener no llegó, usa la lectura del checkpoint', () => {
    const balance = providerBalanceFromSources({
      firebaseOn: true,
      liveBalance: null,
      remoteBalance: 0,
      events: [
        { type: 'debt', amount: 1_780_914, syncedAt: '2026-10-23T00:00:00.000Z' },
      ],
    })
    expect(balance).toBe(0)
  })
})
