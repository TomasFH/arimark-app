import { describe, it, expect } from 'vitest'
import {
  stripNonDigits,
  formatIntegerWithDots,
  formatNumericInputValue,
  parseNumericInput,
  formatDecimalInputValue,
  parseDecimalInput,
  calcCursorPosition,
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

  describe('calcCursorPosition', () => {
    it('cursor al inicio retorna 0', () => {
      expect(calcCursorPosition('1000', 0, '1.000')).toBe(0)
    })

    it('cursor al final retorna la longitud del formateado', () => {
      // rawValue "1000" cursor 4 → 4 dígitos antes → en "1.000" el 4.° dígito está en pos 4 → retorna 5
      expect(calcCursorPosition('1000', 4, '1.000')).toBe(5)
    })

    it('cursor en medio sin cambio de separadores: preserva posición de dígito', () => {
      // rawValue "1000" cursor 2 → 2 dígitos antes → en "1.000" el 2.° dígito está en pos 3 → retorna 3
      expect(calcCursorPosition('1000', 2, '1.000')).toBe(3)
    })

    it('bug principal: borrar dígito que elimina un punto separador', () => {
      // Tras borrar: rawValue = "1.00.000", cursor = 2 → 1 dígito antes ("1.")
      // formatted = "100.000" → cursor queda después del 1.er dígito → posición 1
      expect(calcCursorPosition('1.00.000', 2, '100.000')).toBe(1)
    })

    it('inserción en medio que agrega un separador: cursor avanza correctamente', () => {
      // Usuario insertó "2" → rawValue = "12000", cursor = 2 → 2 dígitos antes ("12")
      // formatted = "12.000" → 2.° dígito en pos 1 → retorna 2
      expect(calcCursorPosition('12000', 2, '12.000')).toBe(2)
    })

    it('valor vacío retorna 0', () => {
      expect(calcCursorPosition('', 0, '')).toBe(0)
    })

    it('cursor después de separador en rawValue cuenta solo dígitos', () => {
      // rawValue "1.000" cursor 2 → chars "1." → 1 dígito → en "1.000" pos 1
      expect(calcCursorPosition('1.000', 2, '1.000')).toBe(1)
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
