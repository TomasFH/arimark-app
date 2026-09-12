import { describe, expect, it } from 'vitest'
import { canEditCebo } from '../lib/cebo'

describe('canEditCebo', () => {
  it('la cajera solo edita el que cargó', () => {
    expect(canEditCebo('cashier', 'u1', 'u1')).toBe(true)
    expect(canEditCebo('cashier', 'u1', 'u2')).toBe(false)
  })

  it('el admin edita cualquiera', () => {
    expect(canEditCebo('admin', 'admin-1', 'u2')).toBe(true)
  })
})
