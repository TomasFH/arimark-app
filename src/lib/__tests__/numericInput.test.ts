import { describe, it, expect } from 'vitest'
import {
  stripNonDigits,
  formatIntegerWithDots,
  formatNumericInputValue,
  parseNumericInput,
} from '../numericInput'

describe('numericInput', () => {
  describe('stripNonDigits', () => {
    it('elimina letras y símbolos', () => {
      expect(stripNonDigits('abc1.000,50$')).toBe('100050')
    })

    it('retorna cadena vacía si no hay dígitos', () => {
      expect(stripNonDigits('abc')).toBe('')
    })
  })

  describe('formatIntegerWithDots', () => {
    it('formatea 1000 como 1.000', () => {
      expect(formatIntegerWithDots('1000')).toBe('1.000')
    })

    it('formatea millones', () => {
      expect(formatIntegerWithDots('1000000')).toBe('1.000.000')
    })

    it('no agrega puntos a números menores a 1000', () => {
      expect(formatIntegerWithDots('999')).toBe('999')
    })

    it('retorna vacío para cadena vacía', () => {
      expect(formatIntegerWithDots('')).toBe('')
    })
  })

  describe('formatNumericInputValue', () => {
    it('sanitiza y formatea en un solo paso', () => {
      expect(formatNumericInputValue('1.000abc')).toBe('1.000')
    })
  })

  describe('parseNumericInput', () => {
    it('parsea valor formateado', () => {
      expect(parseNumericInput('1.000')).toBe(1000)
    })

    it('retorna null para campo vacío', () => {
      expect(parseNumericInput('')).toBeNull()
    })
  })
})
