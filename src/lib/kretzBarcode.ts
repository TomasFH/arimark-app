/**
 * Parser de códigos de barras de tickets físicos de la balanza KRETZ REPORT NX.
 *
 * Formato (13 dígitos, EAN-13):
 *   [20] [PLU 3 dígitos] [precio_centavos 7 dígitos] [check EAN-13]
 *
 * Configuración de la balanza: "2-3-7"
 *   - 2 dígitos de prefijo fijo (siempre "20")
 *   - 3 dígitos de número de PLU (ej. PLU 5 → "005")
 *   - 7 dígitos del precio total en centavos (ej. $17535.00 → "1753500")
 *   - 1 dígito de verificación EAN-13
 *
 * El precio en el barcode es el PRECIO TOTAL del ítem impreso:
 *   - Productos por unidad: precio unitario × cantidad
 *   - Productos por peso: precio/kg × kg
 * El precio máximo soportado es $99.999,99 (9.999.999 centavos = 7 dígitos).
 */

export const KRETZ_BARCODE_PREFIX = '20'
export const KRETZ_BARCODE_LENGTH = 13

export interface KretzTicketBarcode {
  /** Número de PLU, 3 dígitos con ceros a la izquierda. Ej: "005" */
  pluNumber: string
  /** Precio total en centavos. Ej: 1753500 = $17535.00 */
  totalCents: number
}

/**
 * Parsea un barcode EAN-13 de ticket KRETZ.
 * Retorna null si el barcode no es válido (longitud, prefijo o check digit incorrectos).
 *
 * Compatible con lectoras USB que emiten la cadena de dígitos como teclado.
 */
export function parseKretzBarcode(rawInput: string): KretzTicketBarcode | null {
  const digits = rawInput.replace(/\D/g, '')

  if (digits.length !== KRETZ_BARCODE_LENGTH) return null
  if (!digits.startsWith(KRETZ_BARCODE_PREFIX)) return null
  if (!verifyEan13CheckDigit(digits)) return null

  const pluNumber = digits.slice(2, 5)
  const totalCents = parseInt(digits.slice(5, 12), 10)

  return { pluNumber, totalCents }
}

/**
 * Verifica el dígito de control EAN-13 estándar.
 *
 * Algoritmo:
 *   - Posiciones impares (1,3,5,...,11) × 1
 *   - Posiciones pares  (2,4,6,...,12) × 3
 *   - check = (10 − (suma mod 10)) mod 10
 */
export function verifyEan13CheckDigit(digits: string): boolean {
  if (digits.length !== KRETZ_BARCODE_LENGTH) return false

  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits[i]!, 10)
    sum += i % 2 === 0 ? d : d * 3
  }
  const computed = (10 - (sum % 10)) % 10
  return computed === parseInt(digits[12]!, 10)
}

/**
 * Convierte centavos a pesos con 2 decimales para mostrar en UI.
 * Ej: 1753500 → 17535.00
 */
export function centsToARS(cents: number): number {
  return cents / 100
}
