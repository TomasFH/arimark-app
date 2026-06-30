import { describe, it, expect } from 'vitest'
import {
  stripNonDigits,
  formatIntegerWithDots,
  formatNumericInputValue,
  parseNumericInput,
  formatDecimalInputValue,
  parseDecimalInput,
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

  describe('formatDecimalInputValue', () => {
    it('formatea entero con miles', () => {
      expect(formatDecimalInputValue('17535')).toBe('17.535')
    })

    it('formatea monto con centavos', () => {
      expect(formatDecimalInputValue('17535,50')).toBe('17.535,50')
    })

    it('conserva coma mientras se tipea', () => {
      expect(formatDecimalInputValue('17535,')).toBe('17.535,')
    })

    it('limita a 2 decimales', () => {
      expect(formatDecimalInputValue('100,999')).toBe('100,99')
    })

    it('ignora caracteres no numéricos excepto coma', () => {
      expect(formatDecimalInputValue('17.535,5abc')).toBe('17.535,5')
    })
  })

  describe('parseDecimalInput', () => {
    it('parsea monto con coma decimal', () => {
      expect(parseDecimalInput('17.535,50')).toBe(17535.5)
    })

    it('parsea entero sin decimales', () => {
      expect(parseDecimalInput('17.535')).toBe(17535)
    })

    it('retorna null para campo vacío', () => {
      expect(parseDecimalInput('')).toBeNull()
    })

    it('retorna null para solo coma', () => {
      expect(parseDecimalInput(',')).toBeNull()
    })
  })
})
