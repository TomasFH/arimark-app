/**
 * Campos numéricos enteros con separador de miles (es-AR: 1.000).
 * Misma regla que desktop (AGENTS.md): nunca type="number" ni parseFloat
 * sobre el string formateado.
 */

export function stripNonDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function formatIntegerWithDots(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function formatNumericInputValue(raw: string): string {
  return formatIntegerWithDots(stripNonDigits(raw))
}

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
      if (count === digitsBeforeCursor) return i + 1
    }
  }
  return formatted.length
}

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
   * Modo peso: punto como decimal además de coma, y auto-coma tras cero inicial.
   */
  weightMode?: boolean
}

/**
 * Formatea un monto con separador de miles (.) y decimales opcionales con coma (,).
 * Estilo es-AR: "17535,50" → "17.535,50"
 */
export function formatDecimalInputValue(raw: string, maxDecimals = 2, options: FormatDecimalOptions = {}): string {
  let preprocessed = raw

  if (options.weightMode) {
    if (!raw.includes(',') && raw.includes('.')) {
      const lastDot = raw.lastIndexOf('.')
      preprocessed = raw.slice(0, lastDot) + ',' + raw.slice(lastDot + 1)
    }
  }

  const withoutDots = preprocessed.replace(/\./g, '')
  let cleaned = withoutDots.replace(/[^\d,]/g, '')

  if (options.weightMode) {
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

/** Suma/resta kg al texto es-AR del DecimalInput (mínimo 0; vacío si queda 0). */
export function adjustKgInputValue(current: string, delta: number): string {
  const parsed = parseDecimalInput(current) ?? 0
  const next = Math.max(0, Math.round((parsed + delta) * 1000) / 1000)
  if (next === 0) return ''
  return formatDecimalInputValue(String(next).replace('.', ','), 3, { weightMode: true })
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
