import { describe, it, expect } from 'vitest'
import {
  parseKretzBarcode,
  verifyEan13CheckDigit,
  centsToARS,
} from '../kretzBarcode'

// ---------------------------------------------------------------------------
// Datos empíricos del ticket real (sesión 29/06/2026)
// ---------------------------------------------------------------------------
// Huevos x30:      PLU 001, $6000.00  → 0600000 → barcode 2000106000001
// Huevos x30 ofer: PLU 002, $10000.00 → 1000000 → barcode 2000210000003
// Vacío x2:        PLU 005, $17535.00 → 1753500 → barcode 2000517535000

describe('verifyEan13CheckDigit', () => {
  it('acepta los tres barcodes del ticket real', () => {
    expect(verifyEan13CheckDigit('2000106000001')).toBe(true)
    expect(verifyEan13CheckDigit('2000210000003')).toBe(true)
    expect(verifyEan13CheckDigit('2000517535000')).toBe(true)
  })

  it('rechaza un barcode con check digit incorrecto', () => {
    expect(verifyEan13CheckDigit('2000106000009')).toBe(false)
    expect(verifyEan13CheckDigit('2000517535001')).toBe(false)
  })

  it('rechaza un string de longitud incorrecta', () => {
    expect(verifyEan13CheckDigit('200010600000')).toBe(false)   // 12 dígitos
    expect(verifyEan13CheckDigit('20001060000011')).toBe(false) // 14 dígitos
  })
})

describe('parseKretzBarcode', () => {
  describe('casos válidos del ticket real', () => {
    it('Huevos x30 — PLU 1, $6000.00', () => {
      const result = parseKretzBarcode('2000106000001')
      expect(result).not.toBeNull()
      expect(result!.pluNumber).toBe('001')
      expect(result!.totalCents).toBe(600000)
    })

    it('Huevos x30 ofer — PLU 2, $10000.00', () => {
      const result = parseKretzBarcode('2000210000003')
      expect(result).not.toBeNull()
      expect(result!.pluNumber).toBe('002')
      expect(result!.totalCents).toBe(1000000)
    })

    it('Vacío x2 — PLU 5, $17535.00', () => {
      const result = parseKretzBarcode('2000517535000')
      expect(result).not.toBeNull()
      expect(result!.pluNumber).toBe('005')
      expect(result!.totalCents).toBe(1753500)
    })
  })

  describe('tolerancia de formato', () => {
    it('ignora espacios en la cadena de entrada (output de algunas lectoras)', () => {
      // El barcode real es 2000106000001 — con un espacio decorativo entre grupos
      const result = parseKretzBarcode('200 0106000001')
      expect(result).not.toBeNull()
      expect(result!.pluNumber).toBe('001')
    })

    it('ignora guiones de separación', () => {
      const result = parseKretzBarcode('2000-1060-00001')
      expect(result).not.toBeNull()
      expect(result!.pluNumber).toBe('001')
    })
  })

  describe('casos inválidos', () => {
    it('retorna null para string vacío', () => {
      expect(parseKretzBarcode('')).toBeNull()
    })

    it('retorna null si tiene menos de 13 dígitos', () => {
      expect(parseKretzBarcode('200010600000')).toBeNull()
    })

    it('retorna null si tiene más de 13 dígitos', () => {
      expect(parseKretzBarcode('20001060000011')).toBeNull()
    })

    it('retorna null si el prefijo no es 20', () => {
      // barcode de otro sistema (GS1 estándar de peso variable usa prefijo 21-29)
      expect(parseKretzBarcode('2100106000001')).toBeNull()
    })

    it('retorna null si el check digit es incorrecto', () => {
      expect(parseKretzBarcode('2000106000009')).toBeNull()
    })

    it('retorna null si contiene solo letras', () => {
      expect(parseKretzBarcode('abcdefghijklm')).toBeNull()
    })
  })

  describe('valores límite de precio', () => {
    it('acepta precio mínimo ($0.01 = 1 centavo)', () => {
      // 20 + PLU 001 + 0000001 = 2000100000012 → calcular check
      // Verificamos que el parser extrae centavos = 1 si el barcode es válido
      const barcode = buildBarcode('001', 1)
      const result = parseKretzBarcode(barcode)
      expect(result).not.toBeNull()
      expect(result!.totalCents).toBe(1)
    })

    it('acepta precio máximo ($99999.99 = 9999999 centavos)', () => {
      const barcode = buildBarcode('001', 9999999)
      const result = parseKretzBarcode(barcode)
      expect(result).not.toBeNull()
      expect(result!.totalCents).toBe(9999999)
    })

    it('acepta precio cero (product sin cargo en ticket)', () => {
      const barcode = buildBarcode('001', 0)
      const result = parseKretzBarcode(barcode)
      expect(result).not.toBeNull()
      expect(result!.totalCents).toBe(0)
    })
  })
})

describe('centsToARS', () => {
  it('convierte centavos a pesos correctamente', () => {
    expect(centsToARS(600000)).toBe(6000)
    expect(centsToARS(1753500)).toBe(17535)
    expect(centsToARS(1)).toBe(0.01)
    expect(centsToARS(0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Helper — construye un barcode válido para tests de valores límite
// ---------------------------------------------------------------------------

function buildBarcode(plu: string, cents: number): string {
  const pluStr = plu.slice(-3).padStart(3, '0')
  const priceStr = String(cents).padStart(7, '0').slice(-7)
  const body = `20${pluStr}${priceStr}`
  const check = computeEan13Check(body)
  return `${body}${check}`
}

function computeEan13Check(twelveDigits: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = parseInt(twelveDigits[i]!, 10)
    sum += i % 2 === 0 ? d : d * 3
  }
  return (10 - (sum % 10)) % 10
}
