import { describe, expect, it } from 'vitest'
import { isStaleOpenOrder } from '../orderRetention'

const TODAY = '2026-10-15'

describe('isStaleOpenOrder', () => {
  it('conserva un pedido a futuro aunque se haya cargado hace mucho', () => {
    expect(isStaleOpenOrder('2026-10-31', 'pending', TODAY)).toBe(false)
    expect(isStaleOpenOrder('2026-11-30', 'ready', TODAY)).toBe(false)
  })

  it('conserva un vencido reciente', () => {
    expect(isStaleOpenOrder('2026-10-14', 'pending', TODAY)).toBe(false)
    expect(isStaleOpenOrder('2026-10-08', 'ready', TODAY)).toBe(false)
  })

  it('descarta pendiente y listo cuando el retiro pasó hace más de una semana', () => {
    expect(isStaleOpenOrder('2026-10-07', 'pending', TODAY)).toBe(true)
    expect(isStaleOpenOrder('2026-09-01', 'ready', TODAY)).toBe(true)
  })

  it('no toca entregados ni cancelados', () => {
    expect(isStaleOpenOrder('2026-09-01', 'delivered', TODAY)).toBe(false)
    expect(isStaleOpenOrder('2026-09-01', 'cancelled', TODAY)).toBe(false)
  })
})
