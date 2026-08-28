import { describe, it, expect } from 'vitest'
import {
  formatNumericInputValue,
  parseNumericInput,
  formatDecimalInputValue,
  parseDecimalInput,
} from '../lib/numericInput'

describe('numericInput', () => {
  it('formatea miles es-AR', () => {
    expect(formatNumericInputValue('1000000')).toBe('1.000.000')
    expect(parseNumericInput('1.000.000')).toBe(1000000)
  })

  it('peso: punto decimal → coma', () => {
    expect(formatDecimalInputValue('0.490', 3, { weightMode: true })).toBe('0,490')
    expect(parseDecimalInput('0,490')).toBe(0.49)
  })

  it('precio total con miles y centavos', () => {
    expect(formatDecimalInputValue('17535,50')).toBe('17.535,50')
    expect(parseDecimalInput('17.535,50')).toBe(17535.5)
  })
})
