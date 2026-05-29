import { describe, it, expect } from 'vitest'
import {
  parseR30Frame,
  extractNextR30Frame,
  buildR30Frame,
  R30_FRAME_LENGTH,
  type ParsedR30Frame,
} from '../r30Parser'

const SAMPLE: ParsedR30Frame = {
  productCode: '1234',
  weightGrams: 500,
  unitPriceCents: 8500,
  totalCents: 4250,
  rawDate: '290526',
  rawTime: '143000',
}

describe('buildR30Frame + parseR30Frame — roundtrip', () => {
  it('construye y parsea un frame válido correctamente', () => {
    const frame = buildR30Frame(SAMPLE)
    expect(frame.length).toBe(R30_FRAME_LENGTH)

    const result = parseR30Frame(frame)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.productCode).toBe('1234')
    expect(result.data.weightGrams).toBe(500)
    expect(result.data.unitPriceCents).toBe(8500)
    expect(result.data.totalCents).toBe(4250)
    expect(result.data.rawDate).toBe('290526')
    expect(result.data.rawTime).toBe('143000')
  })

  it('strips leading zeros del productCode', () => {
    const frame = buildR30Frame({ ...SAMPLE, productCode: '42' })
    const result = parseR30Frame(frame)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.productCode).toBe('42')
  })

  it('productCode todo-ceros se normaliza a "0"', () => {
    const frame = buildR30Frame({ ...SAMPLE, productCode: '0' })
    const result = parseR30Frame(frame)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.productCode).toBe('0')
  })
})

describe('parseR30Frame — errores de estructura', () => {
  it('retorna error si el frame es demasiado corto', () => {
    const result = parseR30Frame(Buffer.alloc(10))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/longitud/i)
  })

  it('retorna error si el frame es demasiado largo', () => {
    const result = parseR30Frame(Buffer.alloc(50))
    expect(result.ok).toBe(false)
  })

  it('retorna error si STX es incorrecto', () => {
    const frame = buildR30Frame(SAMPLE)
    frame[0] = 0xff
    const result = parseR30Frame(frame)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/STX/i)
  })

  it('retorna error si ETX es incorrecto', () => {
    const frame = buildR30Frame(SAMPLE)
    frame[39] = 0xff
    const result = parseR30Frame(frame)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/ETX/i)
  })

  it('retorna error si LRC no coincide', () => {
    const frame = buildR30Frame(SAMPLE)
    frame[40] ^= 0xff // corromper LRC
    const result = parseR30Frame(frame)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/LRC/i)
  })

  it('retorna error si los campos numéricos contienen caracteres no numéricos', () => {
    const frame = buildR30Frame(SAMPLE)
    // Sobreescribir el campo de peso con letras (posición 7 a 12 en el frame = DATA_START+6..+11)
    Buffer.from('XXXXXX', 'ascii').copy(frame, 7)
    // Recalcular LRC para que pase esa validación
    let lrc = 0
    for (let i = 1; i <= 38; i++) lrc ^= frame[i]
    frame[40] = lrc

    const result = parseR30Frame(frame)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/parseables|numéricos/i)
  })
})

describe('extractNextR30Frame', () => {
  it('retorna frame si el buffer empieza con STX y tiene suficientes bytes', () => {
    const frame = buildR30Frame(SAMPLE)
    const { frame: extracted, consumed } = extractNextR30Frame(frame)
    expect(extracted).not.toBeNull()
    expect(consumed).toBe(R30_FRAME_LENGTH)
    expect(extracted!.length).toBe(R30_FRAME_LENGTH)
  })

  it('retorna null y consumed=0 si el frame está incompleto', () => {
    const partial = buildR30Frame(SAMPLE).subarray(0, 20)
    const { frame, consumed } = extractNextR30Frame(partial)
    expect(frame).toBeNull()
    expect(consumed).toBe(0)
  })

  it('descarta bytes de basura antes del STX', () => {
    const garbage = Buffer.from([0xaa, 0xbb, 0xcc])
    const frame = buildR30Frame(SAMPLE)
    const buffer = Buffer.concat([garbage, frame])
    const { frame: extracted, consumed } = extractNextR30Frame(buffer)
    expect(extracted).toBeNull()
    expect(consumed).toBe(3) // solo descarta los bytes de basura
  })

  it('descarta todo si no hay STX', () => {
    const noStx = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])
    const { frame, consumed } = extractNextR30Frame(noStx)
    expect(frame).toBeNull()
    expect(consumed).toBe(4)
  })

  it('extrae frame correcto cuando hay basura al final', () => {
    const frame = buildR30Frame(SAMPLE)
    const extra = Buffer.from([0xaa, 0xbb])
    const buffer = Buffer.concat([frame, extra])
    const { frame: extracted, consumed } = extractNextR30Frame(buffer)
    expect(extracted).not.toBeNull()
    expect(consumed).toBe(R30_FRAME_LENGTH)
  })
})
