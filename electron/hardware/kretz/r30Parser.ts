/**
 * Parser del protocolo R30 — KRETZ RPF US30P2CAR.
 *
 * NOTA DE VERIFICACIÓN EMPÍRICA:
 * Este parser implementa el layout de frame R30 estándar KRETZ basado en
 * documentación del protocolo. El layout exacto (offsets, baud rate, paridad)
 * DEBE verificarse contra datos reales del hardware antes del primer deploy
 * en producción. Ver PLAN.md § Fase 1 — Bloqueante.
 *
 * Layout del frame (41 bytes totales):
 *   [0]       STX = 0x02
 *   [1..6]    PLU / código de producto — 6 dígitos ASCII, relleno con '0' a izquierda
 *   [7..12]   Peso en gramos          — 6 dígitos ASCII, relleno con '0' a izquierda
 *   [13..19]  Precio unitario (cents) — 7 dígitos ASCII, relleno con '0' a izquierda
 *   [20..26]  Total (cents)           — 7 dígitos ASCII, relleno con '0' a izquierda
 *   [27..32]  Fecha DDMMYY            — 6 dígitos ASCII
 *   [33..38]  Hora HHMMSS             — 6 dígitos ASCII
 *   [39]      ETX = 0x03
 *   [40]      LRC = XOR de los bytes [1..38]
 *
 * Configuración serial esperada: 9600 baud, 8N1.
 */

export const R30_FRAME_LENGTH = 41
const STX = 0x02
const ETX = 0x03
const DATA_START = 1
const DATA_END = 38   // inclusive
const ETX_POS = 39
const LRC_POS = 40

export interface ParsedR30Frame {
  productCode: string
  weightGrams: number
  unitPriceCents: number
  totalCents: number
  /** Fecha raw del frame: DDMMYY */
  rawDate: string
  /** Hora raw del frame: HHMMSS */
  rawTime: string
}

export type ParseR30Result =
  | { ok: true; data: ParsedR30Frame }
  | { ok: false; error: string }

/**
 * Parsea un buffer de exactamente R30_FRAME_LENGTH bytes.
 * Verifica STX, ETX y LRC antes de extraer campos.
 */
export function parseR30Frame(frame: Buffer): ParseR30Result {
  if (frame.length !== R30_FRAME_LENGTH) {
    return { ok: false, error: `Longitud inválida: ${frame.length} (esperado ${R30_FRAME_LENGTH})` }
  }

  if (frame[0] !== STX) {
    return { ok: false, error: `STX inválido: 0x${frame[0].toString(16).padStart(2, '0')}` }
  }

  if (frame[ETX_POS] !== ETX) {
    return {
      ok: false,
      error: `ETX inválido en posición ${ETX_POS}: 0x${frame[ETX_POS].toString(16).padStart(2, '0')}`,
    }
  }

  let lrc = 0
  for (let i = DATA_START; i <= DATA_END; i++) {
    lrc ^= frame[i]
  }
  if (lrc !== frame[LRC_POS]) {
    return {
      ok: false,
      error: `LRC inválido: calculado 0x${lrc.toString(16).padStart(2, '0')}, recibido 0x${frame[LRC_POS].toString(16).padStart(2, '0')}`,
    }
  }

  const ascii = frame.subarray(DATA_START, DATA_END + 1).toString('ascii')
  //             [0..5]   PLU code
  //             [6..11]  Weight grams
  //             [12..18] Unit price cents
  //             [19..25] Total cents
  //             [26..31] Date DDMMYY
  //             [32..37] Time HHMMSS

  const productCode = ascii.slice(0, 6).replace(/^0+/, '') || '0'
  const weightGrams = parseInt(ascii.slice(6, 12), 10)
  const unitPriceCents = parseInt(ascii.slice(12, 19), 10)
  const totalCents = parseInt(ascii.slice(19, 26), 10)
  const rawDate = ascii.slice(26, 32)
  const rawTime = ascii.slice(32, 38)

  if (isNaN(weightGrams) || isNaN(unitPriceCents) || isNaN(totalCents)) {
    return { ok: false, error: 'Campos numéricos no parseables en el frame R30' }
  }

  if (weightGrams < 0 || unitPriceCents < 0 || totalCents < 0) {
    return { ok: false, error: 'Valores negativos en el frame R30' }
  }

  return { ok: true, data: { productCode, weightGrams, unitPriceCents, totalCents, rawDate, rawTime } }
}

/**
 * Busca el primer frame R30 completo dentro de un buffer acumulado.
 * Devuelve el frame encontrado (o null si incompleto) y los bytes consumidos.
 *
 * El caller debe avanzar el buffer en `consumed` bytes independientemente
 * de si se encontró un frame o no.
 */
export function extractNextR30Frame(buffer: Buffer): {
  frame: Buffer | null
  consumed: number
} {
  const stxIndex = buffer.indexOf(STX)

  if (stxIndex === -1) {
    // Sin STX — todo es basura, descartar
    return { frame: null, consumed: buffer.length }
  }

  if (stxIndex > 0) {
    // Hay bytes de basura antes del STX — descartar y reintentar en la próxima llamada
    return { frame: null, consumed: stxIndex }
  }

  // stxIndex === 0: posible inicio de frame
  if (buffer.length < R30_FRAME_LENGTH) {
    // Frame incompleto — esperar más bytes
    return { frame: null, consumed: 0 }
  }

  return { frame: Buffer.from(buffer.subarray(0, R30_FRAME_LENGTH)), consumed: R30_FRAME_LENGTH }
}

/**
 * Construye un frame R30 válido a partir de datos.
 * Útil para tests y simulaciones.
 */
export function buildR30Frame(data: ParsedR30Frame): Buffer {
  const ascii =
    data.productCode.padStart(6, '0') +
    data.weightGrams.toString().padStart(6, '0') +
    data.unitPriceCents.toString().padStart(7, '0') +
    data.totalCents.toString().padStart(7, '0') +
    data.rawDate.padEnd(6, '0') +
    data.rawTime.padEnd(6, '0')

  const dataBytes = Buffer.from(ascii, 'ascii')
  let lrc = 0
  for (const byte of dataBytes) lrc ^= byte

  const frame = Buffer.alloc(R30_FRAME_LENGTH)
  frame[0] = STX
  dataBytes.copy(frame, DATA_START)
  frame[ETX_POS] = ETX
  frame[LRC_POS] = lrc
  return frame
}
