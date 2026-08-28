/**
 * Utilidades para el manejo de números de teléfono argentinos.
 *
 * Reglas de limpieza (solo casos inequívocos):
 * - +54  → se elimina el prefijo internacional (el `+` no se puede teclear,
 *           solo puede llegar al pegar desde el portapapeles)
 * - 0 inicial → se elimina el prefijo de discado (ej. `011 4567-8901`)
 *
 * NO se eliminan prefijos ambiguos como `54`, `9` o `15` porque podrían
 * ser parte legítima de un número que realmente comienza con esas cifras.
 *
 * Formatos de salida si el número limpio tiene exactamente 10 dígitos:
 *   11 (CABA)             → "11-XXXX-XXXX"
 *   Área de 3 dígitos     → "XXX XXX-XXXX"     (ej. 341, 351, 261)
 *   Área de 4 dígitos     → "XXXX XX-XXXX"     (ej. 2944, 3364)
 */

/** Extrae solo los dígitos de una cadena. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Quita únicamente los prefijos inequívocos:
 *   +54  → vacío (el `+` no se teclea; indica número pegado desde contacto)
 *   0 inicial → vacío (prefijo de discado local)
 *
 * Todo lo demás se deja intacto para evitar borrar números que
 * genuinamente comiencen con esas cifras.
 */
/**
 * Quita prefijos y devuelve dígitos limpios.
 * Para el caso especial de +54 pegado desde contacto (llega como "54XXXXXXXXXX",
 * 12 dígitos), lo detectamos aquí: si hay exactamente 12 dígitos y empieza en
 * "54" seguido de un código de área válido (11, 2xx, 3xx), se considera +54.
 */
function normalize(raw: string): string {
  let digits = digitsOnly(raw)

  // 0 inicial → discado, siempre seguro de quitar
  if (digits.startsWith('0')) digits = digits.slice(1)

  // +54 pegado: exactamente 12 dígitos que empiezan en "54" y el tercer dígito es 1, 2 o 3
  // → asumimos que es el prefijo internacional y quitamos los dos primeros dígitos
  if (
    digits.length === 12 &&
    digits.startsWith('54') &&
    /^[123]/.test(digits[2])
  ) {
    digits = digits.slice(2)
  }

  return digits
}

/**
 * Devuelve el número limpio de 10 dígitos para guardar en base de datos.
 * Si el valor no tiene exactamente 10 dígitos tras la limpieza, devuelve null.
 */
export function parsePhoneNumber(value: string): string | null {
  const digits = normalize(value)
  return digits.length === 10 ? digits : null
}

/**
 * Formatea dinámicamente el input del usuario mientras escribe.
 * - No modifica el texto si el número limpio aún no llega a 10 dígitos.
 * - Si el número limpio tiene exactamente 10 dígitos, aplica el formato
 *   correspondiente al área detectado.
 */
export function formatPhoneInput(value: string): string {
  const digits = normalize(value)

  if (digits.length < 10) {
    // Aún incompleto: mostrar solo los dígitos sin formato
    return digits
  }

  const d = digits.slice(0, 10)
  const area2 = d.slice(0, 2)
  const area4 = d.slice(0, 4)
  const area3 = d.slice(0, 3)

  if (area2 === '11') {
    return `11-${d.slice(2, 6)}-${d.slice(6, 10)}`
  }

  // Heurística área 3 vs 4 dígitos: si el 4to dígito es ≤ 4 → área 4
  const fourthDigit = parseInt(d[3], 10)
  if (fourthDigit <= 4) {
    return `${area4} ${d.slice(4, 6)}-${d.slice(6, 10)}`
  }

  return `${area3} ${d.slice(3, 6)}-${d.slice(6, 10)}`
}
