/**
 * Utilidades para campos numéricos enteros con separador de miles (es-AR: 1.000).
 * Solo dígitos — sin decimales ni signos.
 *
 * Usar junto con NumericInput. No combinar con pattern HTML ni parseFloat
 * sobre el string formateado (ver AGENTS.md — UI campos numéricos).
 */

/** Elimina todo lo que no sea dígito. */
export function stripNonDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Formatea una cadena de dígitos con puntos como separador de miles.
 * Ej: "1000" → "1.000", "1000000" → "1.000.000"
 */
export function formatIntegerWithDots(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/**
 * Toma el valor crudo del input, lo sanitiza y devuelve la cadena formateada para mostrar.
 */
export function formatNumericInputValue(raw: string): string {
  return formatIntegerWithDots(stripNonDigits(raw))
}

/**
 * Calcula la nueva posición del cursor en el string ya formateado,
 * preservando el conteo de dígitos que había antes del cursor en el
 * string crudo (tal como lo entrega el evento del input, antes de formatear).
 *
 * Uso típico: onChange captura rawCursor = e.target.selectionStart, formatea
 * el valor y llama a esta función para obtener dónde poner el cursor después
 * del reformateo.
 *
 * @param rawValue  - Valor tal como llegó en el evento (puede tener separadores
 *                    parciales o ninguno; e.g. "1.00.000" tras borrar un dígito).
 * @param rawCursor - Posición del cursor en rawValue (selectionStart).
 * @param formatted - Valor ya formateado con separadores de miles.
 */
export function calcCursorPosition(
  rawValue: string,
  rawCursor: number,
  formatted: string,
): number {
  const digitsBeforeCursor = rawValue.slice(0, rawCursor).replace(/\D/g, '').length

  if (digitsBeforeCursor === 0) return 0

  let count = 0
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      count++
      if (count === digitsBeforeCursor) {
        return i + 1
      }
    }
  }
  return formatted.length
}

/**
 * Convierte el valor formateado del input a número entero.
 * Retorna null si el campo está vacío.
 */
export function parseNumericInput(formatted: string): number | null {
  const digits = stripNonDigits(formatted)
  if (!digits) return null
  const value = Number.parseInt(digits, 10)
  return Number.isNaN(value) ? null : value
}

export interface FormatDecimalOptions {
  /** Máximo de decimales permitidos (default 2). */
  maxDecimals?: number
  /**
   * Modo peso: activa dos comportamientos específicos para campos de peso en kg.
   *  1. Trata el punto (.) como separador decimal además de la coma (ej. 0.490 → 0,490).
   *  2. Auto-inserta coma después del cero inicial: si el usuario escribe "04" → "0,4"
   *     (un peso < 1 kg siempre tiene decimales).
   */
  weightMode?: boolean
}

/**
 * Formatea un monto con separador de miles (.) y decimales opcionales con coma (,).
 * Estilo es-AR: "17535,50" → "17.535,50"
 *
 * Permite escribir la coma mientras se tipea (ej. "17.535,").
 */
export function formatDecimalInputValue(raw: string, maxDecimals = 2, options: FormatDecimalOptions = {}): string {
  let preprocessed = raw

  if (options.weightMode) {
    // Normalizar punto decimal a coma si no hay coma ya (0.490 → 0,490)
    if (!raw.includes(',') && raw.includes('.')) {
      const lastDot = raw.lastIndexOf('.')
      preprocessed = raw.slice(0, lastDot) + ',' + raw.slice(lastDot + 1)
    }
  }

  // Quitar puntos de miles previos antes de sanitizar (evita duplicar dígitos al re-formatear)
  const withoutDots = preprocessed.replace(/\./g, '')
  let cleaned = withoutDots.replace(/[^\d,]/g, '')

  if (options.weightMode) {
    // Auto-coma después de cero inicial: "04" → "0,4"
    if (/^0\d/.test(cleaned)) {
      cleaned = '0,' + cleaned.slice(1)
    }
  }

  const commaIndex = cleaned.indexOf(',')

  let intPart: string
  let decPart: string
  let hasTrailingComma = false

  if (commaIndex === -1) {
    intPart = cleaned
    decPart = ''
  } else {
    intPart = cleaned.slice(0, commaIndex)
    decPart = cleaned.slice(commaIndex + 1).replace(/,/g, '').slice(0, maxDecimals)
    hasTrailingComma = cleaned.endsWith(',') && decPart.length === 0
  }

  const formattedInt = intPart ? formatIntegerWithDots(intPart) : ''

  if (hasTrailingComma) {
    return `${formattedInt},`
  }
  if (decPart.length > 0) {
    return `${formattedInt},${decPart}`
  }
  return formattedInt
}

/**
 * Convierte un monto formateado es-AR (1.234,56) a número.
 * Retorna null si el campo está vacío o es inválido.
 */
export function parseDecimalInput(formatted: string): number | null {
  const trimmed = formatted.trim()
  if (!trimmed || trimmed === ',') return null

  const normalized = trimmed.replace(/\./g, '').replace(',', '.')
  const value = Number.parseFloat(normalized)
  return Number.isNaN(value) ? null : value
}
