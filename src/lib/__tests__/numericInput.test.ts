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

    it('limita a 2 decimales por defecto', () => {
      expect(formatDecimalInputValue('100,999')).toBe('100,99')
    })

    it('limita a 3 decimales cuando se especifica maxDecimals=3', () => {
      expect(formatDecimalInputValue('0,4905', 3)).toBe('0,490')
    })

    it('permite 0 decimales con maxDecimals=0', () => {
      expect(formatDecimalInputValue('2,5', 0)).toBe('2')
    })

    it('ignora caracteres no numéricos excepto coma', () => {
      expect(formatDecimalInputValue('17.535,5abc')).toBe('17.535,5')
    })

    describe('weightMode', () => {
      it('convierte punto a coma como separador decimal', () => {
        expect(formatDecimalInputValue('0.490', 3, { weightMode: true })).toBe('0,490')
      })

      it('convierte 1.500 (punto decimal) en 1,500', () => {
        expect(formatDecimalInputValue('1.500', 3, { weightMode: true })).toBe('1,500')
      })

      it('auto-inserta coma al escribir dígito después de cero inicial', () => {
        expect(formatDecimalInputValue('04', 3, { weightMode: true })).toBe('0,4')
      })

      it('auto-inserta coma: 049 → 0,49', () => {
        expect(formatDecimalInputValue('049', 3, { weightMode: true })).toBe('0,49')
      })

      it('no inserta coma si el valor ya la tiene (0,4)', () => {
        expect(formatDecimalInputValue('0,4', 3, { weightMode: true })).toBe('0,4')
      })

      it('no inserta coma para enteros >= 1 (ej. 1500g = 1,500 kg)', () => {
        expect(formatDecimalInputValue('1500', 3, { weightMode: true })).toBe('1.500')
      })
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
