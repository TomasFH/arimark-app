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
 * Convierte el valor formateado del input a número entero.
 * Retorna null si el campo está vacío.
 */
export function parseNumericInput(formatted: string): number | null {
  const digits = stripNonDigits(formatted)
  if (!digits) return null
  const value = Number.parseInt(digits, 10)
  return Number.isNaN(value) ? null : value
}
