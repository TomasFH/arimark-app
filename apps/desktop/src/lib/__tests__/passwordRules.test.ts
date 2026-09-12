import { describe, it, expect } from 'vitest'
import { newPasswordIssue } from '../passwordRules'

describe('newPasswordIssue', () => {
  it('rechaza clave corta', () => {
    expect(newPasswordIssue('12345', '12345')).toMatch(/al menos 6/)
  })

  it('rechaza si no coinciden', () => {
    expect(newPasswordIssue('abcdef', 'abcdefg')).toMatch(/no coinciden/)
  })

  it('rechaza si es igual a la actual', () => {
    expect(newPasswordIssue('abcdef', 'abcdef', 'abcdef')).toMatch(/distinta/)
  })

  it('acepta una clave válida', () => {
    expect(newPasswordIssue('abcdef', 'abcdef', 'vieja12')).toBeNull()
  })
})
