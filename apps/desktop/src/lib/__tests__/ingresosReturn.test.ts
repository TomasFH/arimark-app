import { describe, expect, it } from 'vitest'
import { ingresosBackTarget } from '../ingresosReturn'

describe('ingresosBackTarget', () => {
  it('desde Consultas, Ver visita vuelve al historial y no al POS', () => {
    expect(ingresosBackTarget({ returnTo: 'history', fromCashier: true })).toBe('history')
  })

  it('desde el hub, Ver visita vuelve al historial', () => {
    expect(ingresosBackTarget({ returnTo: 'history', fromCashier: false })).toBe('history')
  })

  it('Mercadería abierta desde Consultas vuelve al POS', () => {
    expect(ingresosBackTarget({ fromCashier: true })).toBe('cashier')
  })

  it('una visita abierta desde proveedores vuelve a proveedores', () => {
    expect(ingresosBackTarget({ returnTo: 'providers', fromCashier: false })).toBe('providers')
  })

  it('sin origen vuelve al hub', () => {
    expect(ingresosBackTarget({ fromCashier: false })).toBe('hub')
  })
})
