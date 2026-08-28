import { describe, it, expect } from 'vitest'
import {
  formatAdminAdjustNote,
  isAdminAdjustNote,
  stampAdminAdjustAuthor,
} from '../providerLedgerNotes'

describe('providerLedgerNotes', () => {
  it('deja claro que el admin fijó el saldo', () => {
    expect(formatAdminAdjustNote(10000)).toContain('Ajuste de admin')
    expect(formatAdminAdjustNote(10000)).toContain('deuda')
    expect(formatAdminAdjustNote(-20000)).toContain('a favor')
    expect(formatAdminAdjustNote(0)).toContain('$ 0')
    expect(isAdminAdjustNote(formatAdminAdjustNote(10000))).toBe(true)
    expect(isAdminAdjustNote('Pago')).toBe(false)
  })

  it('incluye el nombre del admin cuando se provee', () => {
    expect(formatAdminAdjustNote(10000, 'Admin Prueba')).toBe(
      'Ajuste de admin (Admin Prueba): dejó la deuda en $ 10.000',
    )
  })

  it('estampa el autor si la nota todavía no lo tiene', () => {
    expect(
      stampAdminAdjustAuthor('Ajuste de admin: dejó la deuda en $ 10.000', 'Admin Prueba'),
    ).toBe('Ajuste de admin (Admin Prueba): dejó la deuda en $ 10.000')
    expect(
      stampAdminAdjustAuthor('Ajuste de admin (Admin Prueba): dejó la deuda en $ 10.000', 'Otro'),
    ).toBe('Ajuste de admin (Admin Prueba): dejó la deuda en $ 10.000')
    expect(stampAdminAdjustAuthor('Pago de deuda', 'Admin')).toBe('Pago de deuda')
  })
})
