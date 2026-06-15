/**
 * Protocolo R30 de la balanza KRETZ REPORT NX.
 *
 * Comunicación: serial (COM8, 115200 baud, 8N1) o TCP (puerto 1001).
 * Este módulo solo hace encode/decode de tramas — sin estado, sin I/O.
 *
 * Formato de comando (PC → balanza):
 *   STX (0x02) + "C01" + cmd(4) + datos + checksum(2 ASCII) + ETX (0x04)
 *
 * Formato de respuesta (balanza → PC):
 *   STX_RESP (0x07) + equipo(1) + id(2) + grupo(2) + código(2) + datos + checksum(2) + ETX (0x04)
 *
 * Códigos de respuesta relevantes:
 *   01 OK, 02 comando no existe, 10 checksum error, 11 longitud error,
 *   20 registro inexistente, 30 último registro, 40 tabla vacía, 60 error ejecución.
 */

const STX = 0x02
const STX_RESP = 0x07
const ETX = 0x04

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/**
 * Suma todos los bytes del buffer y devuelve el byte bajo como 2 dígitos ASCII
 * sumados con 0x30 (ej. 0xAB → "AB" → chars 'A','B').
 */
function checksumBytes(buf: Buffer): string {
  let sum = 0
  for (const b of buf) sum = (sum + b) & 0xffff
  const low = sum & 0xff
  const hi = (low >> 4) & 0x0f
  const lo = low & 0x0f
  return String.fromCharCode(0x30 + hi, 0x30 + lo)
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Construye y devuelve la trama completa lista para escribir al puerto. */
export function encodeFrame(command: string, data = ''): Buffer {
  const cmd = command.padStart(4, '0').slice(-4)
  const body = `C01${cmd}${data}`
  const bodyBuf = Buffer.from(body, 'ascii')
  const prefix = Buffer.from([STX])
  const chk = checksumBytes(Buffer.concat([prefix, bodyBuf]))
  const suffix = Buffer.from(chk + String.fromCharCode(ETX), 'ascii')
  return Buffer.concat([prefix, bodyBuf, suffix])
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export type ParsedResponse = {
  raw: string
  equipment: string
  id: string
  group: string
  responseCode: string
  data: string
}

const RESP_MEANING: Record<string, string> = {
  '01': 'OK',
  '02': 'Comando inexistente o no disponible',
  '10': 'Error de checksum recibido',
  '11': 'Error de longitud de datos',
  '20': 'Registro inexistente',
  '30': 'Último registro leído',
  '31': 'Último registro borrado',
  '40': 'Sin registros / tabla vacía',
  '41': 'Sin registros para borrar',
  '50': 'Capacidad máxima superada',
  '60': 'Error al ejecutar el comando',
}

export function explainResponseCode(code: string): string {
  return RESP_MEANING[code] ?? `Código desconocido ${code}`
}

/**
 * Intenta extraer una trama de respuesta completa del buffer acumulado.
 * Devuelve [trama, resto] o null si todavía no hay trama completa.
 */
export function takeResponseFrame(buf: Buffer): [Buffer, Buffer] | null {
  const start = buf.indexOf(STX_RESP)
  if (start === -1) return null
  const end = buf.indexOf(ETX, start + 1)
  if (end === -1) return null
  const frame = buf.subarray(start, end + 1)
  const rest = buf.subarray(end + 1)
  return [frame, rest]
}

function verifyChecksum(frame: Buffer): boolean {
  if (frame.length < 6) return false
  if (frame[0] !== STX_RESP || frame[frame.length - 1] !== ETX) return false
  const core = frame.subarray(0, frame.length - 3)
  const chkAscii = frame.subarray(frame.length - 3, frame.length - 1).toString('ascii')
  return chkAscii === checksumBytes(core)
}

export function parseResponse(frame: Buffer): ParsedResponse {
  if (!verifyChecksum(frame)) {
    throw new Error('Checksum inválido en respuesta de la balanza')
  }
  const inner = frame.subarray(1, frame.length - 3).toString('ascii')
  if (inner.length < 8) throw new Error('Respuesta de balanza demasiado corta')
  return {
    raw: inner,
    equipment: inner[0]!,
    id: inner.slice(1, 3),
    group: inner.slice(3, 5),
    responseCode: inner.slice(5, 7),
    data: inner.slice(7),
  }
}

// ---------------------------------------------------------------------------
// Comandos específicos — parse de datos
// ---------------------------------------------------------------------------

/**
 * Comando 1524 — estado actual (peso en vivo).
 * Datos: PLU(6) + peso(6) + precio(9) + importe(9) + unidades(4)
 */
export function parseState1524(data: string): {
  plu: string
  weightRaw: string
  priceRaw: string
  amountRaw: string
  unitsRaw: string
} {
  let o = 0
  const take = (n: number) => { const s = data.slice(o, o + n); o += n; return s }
  return {
    plu: take(6),
    weightRaw: take(6),
    priceRaw: take(9),
    amountRaw: take(9),
    unitsRaw: take(4),
  }
}

// ---------------------------------------------------------------------------
// PLU — tipos públicos
// ---------------------------------------------------------------------------

export type PluType = 'pesable' | 'normal'

export type PluRow = {
  number: string   // 6 dígitos
  name: string
  code: string     // 5 dígitos (código interno de artículo)
  price: string    // precio como string según priceDigits
  type: PluType
}

// ---------------------------------------------------------------------------
// Comando 2005 — crear/actualizar PLU
// ---------------------------------------------------------------------------

export type SendPluArgs = {
  pluNumber: string
  department: string
  family: string
  name: string
  description: string
  articleCode: string
  pesable: boolean
  priceCents: number
  /** 6 para KRETZ REPORT NX; usar 7 si el equipo muestra precios de 7 dígitos */
  priceDigits?: 6 | 7
}

/** Construye el payload de datos para el comando 2005 (crear/actualizar PLU). */
export function buildPlu2005Data(args: SendPluArgs): string {
  const priceDigits = args.priceDigits ?? 6
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n, ' ')
  const dig = (s: string, n: number) => s.replace(/\D/g, '').slice(-n).padStart(n, '0')

  const plu = dig(args.pluNumber, 6)
  const dep = dig(args.department, 3)
  const fam = dig(args.family, 3)
  const nm = pad(args.name, 26)
  const desc = pad(args.description, 26)
  const code = dig(args.articleCode, 5)
  const tipo = args.pesable ? 'P' : 'N'
  const priceInt = Math.max(0, Math.round(args.priceCents))
  const priceStr = String(priceInt).padStart(priceDigits, '0').slice(-priceDigits)
  const priceAlt = '0'.repeat(priceDigits)
  const priceOld = '0'.repeat(priceDigits)

  return (
    plu + dep + fam + nm + desc + code + tipo +
    '0000000' +   // valor fijo
    priceStr + priceAlt + priceOld +
    '000000' +    // imp1
    '000000' +    // imp2
    '00000' +     // tara preempacado
    '00000' +     // tara publicada
    '01' +        // código etiqueta
    '0000' +      // código receta
    '0000' +      // código nutrición
    '0' +         // fecha envase
    '000' +       // vencimiento
    '0000'        // código imagen
  )
}

// ---------------------------------------------------------------------------
// Comando 5005 — leer PLU
// ---------------------------------------------------------------------------

/** Parsea la respuesta de datos del comando 5005 (leer PLU). */
export function parsePlu5005(data: string, priceDigits: 6 | 7 = 6): PluRow {
  let o = 0
  const take = (n: number) => { const s = data.slice(o, o + n); o += n; return s.trim() }
  const number = take(6)
  take(3)              // departamento
  take(3)              // familia
  const name = take(26)
  take(26)             // descripción
  const code = take(5)
  const typeChar = take(1)
  take(7)              // valor fijo
  const price = take(priceDigits)
  return {
    number,
    name,
    code,
    price,
    type: typeChar === 'P' ? 'pesable' : 'normal',
  }
}
