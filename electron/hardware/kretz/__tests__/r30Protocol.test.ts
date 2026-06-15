/**
 * Tests del módulo r30Protocol.ts.
 *
 * Verifica encode/decode de tramas R30 y la construcción de datos de PLU.
 * No requiere hardware — sin I/O.
 */

import { describe, it, expect } from 'vitest'
import {
  encodeFrame,
  takeResponseFrame,
  parseResponse,
  parseState1524,
  buildPlu2005Data,
  parsePlu5005,
  explainResponseCode,
} from '../r30Protocol'

// ---------------------------------------------------------------------------
// Helpers de test
// ---------------------------------------------------------------------------

/** Construye una respuesta sintética válida para usar en tests. */
function buildFakeResponse(responseCode: string, data = ''): Buffer {
  const STX_RESP = 0x07
  const ETX = 0x04
  // Estructura interna: equipo(1) + id(2) + grupo(2) + código(2) + datos
  const inner = `B0101${responseCode}${data}`
  const innerBuf = Buffer.from(inner, 'ascii')
  const prefix = Buffer.from([STX_RESP])
  // Checksum sobre prefix + inner
  let sum = 0
  for (const b of Buffer.concat([prefix, innerBuf])) sum = (sum + b) & 0xffff
  const low = sum & 0xff
  const chk = String.fromCharCode(0x30 + ((low >> 4) & 0x0f), 0x30 + (low & 0x0f))
  return Buffer.concat([prefix, innerBuf, Buffer.from(chk + String.fromCharCode(ETX), 'ascii')])
}

// ---------------------------------------------------------------------------
// encodeFrame
// ---------------------------------------------------------------------------

describe('encodeFrame', () => {
  it('genera un buffer que empieza con STX (0x02) y termina con ETX (0x04)', () => {
    const frame = encodeFrame('0002')
    expect(frame[0]).toBe(0x02)
    expect(frame[frame.length - 1]).toBe(0x04)
  })

  it('incluye el comando de 4 dígitos en el cuerpo', () => {
    const frame = encodeFrame('1524')
    const body = frame.toString('ascii')
    expect(body).toContain('1524')
  })

  it('rellena comandos cortos a 4 dígitos', () => {
    const frame = encodeFrame('2', 'datos')
    const body = frame.toString('ascii')
    expect(body).toContain('0002')
  })

  it('incluye datos opcionales en el cuerpo', () => {
    const frame = encodeFrame('5005', '000001')
    const body = frame.toString('ascii')
    expect(body).toContain('000001')
  })
})

// ---------------------------------------------------------------------------
// takeResponseFrame
// ---------------------------------------------------------------------------

describe('takeResponseFrame', () => {
  it('extrae una trama completa del buffer', () => {
    const resp = buildFakeResponse('01')
    const result = takeResponseFrame(resp)
    expect(result).not.toBeNull()
    const [frame, rest] = result!
    expect(frame[0]).toBe(0x07)
    expect(rest.length).toBe(0)
  })

  it('devuelve null si el buffer está incompleto', () => {
    const resp = buildFakeResponse('01')
    const partial = resp.subarray(0, resp.length - 2)
    expect(takeResponseFrame(partial)).toBeNull()
  })

  it('devuelve null si no hay STX de respuesta', () => {
    expect(takeResponseFrame(Buffer.from('basura'))).toBeNull()
  })

  it('deja el resto del buffer después de la primera trama', () => {
    const resp = buildFakeResponse('01', 'abc')
    const extra = Buffer.from('extradata')
    const combined = Buffer.concat([resp, extra])
    const result = takeResponseFrame(combined)
    expect(result).not.toBeNull()
    expect(result![1].toString('ascii')).toBe('extradata')
  })
})

// ---------------------------------------------------------------------------
// parseResponse
// ---------------------------------------------------------------------------

describe('parseResponse', () => {
  it('parsea correctamente una respuesta OK (01)', () => {
    const frame = buildFakeResponse('01', 'datos_de_prueba')
    const parsed = parseResponse(frame)
    expect(parsed.responseCode).toBe('01')
    expect(parsed.data).toBe('datos_de_prueba')
  })

  it('parsea respuesta de enlace 0002 sin campo datos (7 chars internos)', () => {
    const frame = buildFakeResponse('01')
    const parsed = parseResponse(frame)
    expect(parsed.responseCode).toBe('01')
    expect(parsed.data).toBe('')
  })

  it('lanza si el checksum es inválido', () => {
    const frame = buildFakeResponse('01')
    // Corromper el checksum (penúltimo byte antes de ETX)
    const corrupt = Buffer.from(frame)
    corrupt[corrupt.length - 2] = 0x00
    expect(() => parseResponse(corrupt)).toThrow('Checksum inválido')
  })
})

// ---------------------------------------------------------------------------
// explainResponseCode
// ---------------------------------------------------------------------------

describe('explainResponseCode', () => {
  it('devuelve "OK" para código 01', () => {
    expect(explainResponseCode('01')).toBe('OK')
  })

  it('devuelve texto descriptivo para código 20', () => {
    expect(explainResponseCode('20')).toContain('inexistente')
  })

  it('devuelve mensaje genérico para código desconocido', () => {
    expect(explainResponseCode('99')).toContain('99')
  })
})

// ---------------------------------------------------------------------------
// parseState1524
// ---------------------------------------------------------------------------

describe('parseState1524', () => {
  it('extrae PLU, peso, precio, importe y unidades de una respuesta real', () => {
    // 6 + 6 + 9 + 9 + 4 = 34 chars
    const data = '000001' + '000840' + '000555555' + '000466666' + '0001'
    const state = parseState1524(data)
    expect(state.plu).toBe('000001')
    expect(state.weightRaw).toBe('000840')
    expect(state.priceRaw).toBe('000555555')
    expect(state.amountRaw).toBe('000466666')
    expect(state.unitsRaw).toBe('0001')
  })

  it('maneja todos ceros (balanza en reposo)', () => {
    const data = '000000' + '000000' + '000000000' + '000000000' + '0000'
    const state = parseState1524(data)
    expect(state.plu).toBe('000000')
    expect(state.weightRaw).toBe('000000')
  })
})

// ---------------------------------------------------------------------------
// buildPlu2005Data
// ---------------------------------------------------------------------------

describe('buildPlu2005Data', () => {
  const baseArgs = {
    pluNumber: '1',
    department: '001',
    family: '001',
    name: 'ASADO',
    description: 'ASADO',
    articleCode: '00001',
    pesable: true,
    priceCents: 850000, // $8.500,00
    priceDigits: 6 as const,
  }

  it('genera un string no vacío', () => {
    const data = buildPlu2005Data(baseArgs)
    expect(data.length).toBeGreaterThan(0)
  })

  it('incluye el número de PLU con padding izquierdo de 6 dígitos', () => {
    const data = buildPlu2005Data(baseArgs)
    expect(data.startsWith('000001')).toBe(true)
  })

  it('incluye "P" para artículos pesables', () => {
    const data = buildPlu2005Data({ ...baseArgs, pesable: true })
    expect(data).toContain('P')
  })

  it('incluye "N" para artículos no pesables', () => {
    const data = buildPlu2005Data({ ...baseArgs, pesable: false })
    expect(data).toContain('N')
  })

  it('precio de 0 centavos genera todos ceros en el campo precio', () => {
    const data = buildPlu2005Data({ ...baseArgs, priceCents: 0 })
    // El campo precio (6 dígitos) después del valorFijo (7 dígitos)
    // Posición: 6(plu)+3(dep)+3(fam)+26(nm)+26(desc)+5(code)+1(tipo)+7(valorFijo) = 77
    const priceField = data.slice(77, 77 + 6)
    expect(priceField).toBe('000000')
  })
})

// ---------------------------------------------------------------------------
// parsePlu5005
// ---------------------------------------------------------------------------

describe('parsePlu5005', () => {
  it('parsea correctamente una respuesta de PLU pesable', () => {
    const num = '000001'
    const dep = '001'
    const fam = '001'
    const name = 'ASADO                     '  // 26 chars
    const desc = 'ASADO                     '  // 26 chars
    const code = '00001'
    const type = 'P'
    const valorFijo = '0000000'
    const price = '850000'
    const data = num + dep + fam + name + desc + code + type + valorFijo + price

    const row = parsePlu5005(data, 6)
    expect(row.number).toBe('000001')
    expect(row.name).toBe('ASADO')
    expect(row.code).toBe('00001')
    expect(row.price).toBe('850000')
    expect(row.type).toBe('pesable')
  })

  it('identifica artículos normales (N)', () => {
    const num = '000002'
    const dep = '001'
    const fam = '001'
    const name = 'PRODUCTO NORMAL           '
    const desc = 'PRODUCTO NORMAL           '
    const code = '00002'
    const type = 'N'
    const valorFijo = '0000000'
    const price = '100000'
    const data = num + dep + fam + name + desc + code + type + valorFijo + price

    const row = parsePlu5005(data, 6)
    expect(row.type).toBe('normal')
  })
})
