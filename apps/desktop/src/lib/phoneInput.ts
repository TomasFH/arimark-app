/**
 * Utilidades para el manejo de números de teléfono argentinos.
 *
 * Reglas de negocio:
 * - Se almacena el número limpio de exactamente 10 dígitos (área + abonado).
 * - Se remueven prefijos comunes antes de normalizar: +54, 9, 15 inicial, 0 de discado.
 * - El formateo dinámico solo aplica cuando el número limpio tiene 10 dígitos.
 *
 * Formatos de salida según prefijo de área:
 *   11 (CABA)             → "11 XXXX-XXXX"
 *   Área de 3 dígitos     → "XXX XXX-XXXX"     (ej. 341, 351, 261)
 *   Área de 4 dígitos     → "XXXX XX-XXXX"     (ej. 2944, 3364)
 */

/** Extrae solo los dígitos de una cadena. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Quita prefijos argentinos del string limpio de dígitos:
 *   +54  → ""
 *   549  → "9…" (deja el 9)
 *   54   → ""
 *   9    → "" cuando el resto tiene ≥ 10 dígitos
 *   15   → "" cuando precede a 8 dígitos de abonado (zonas con "15" móvil)
 *   0    → "" inicial (prefijo de discado)
 */
function stripArgentinePrefixes(digits: string): string {
  // +54 o 54 al inicio
  if (digits.startsWith('54')) {
    digits = digits.slice(2)
  }
  // 0 inicial de discado (ej. "011 4...")
  if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }
  // 9 inicial cuando lo que sigue tiene ≥ 10 dígitos (número completo con móvil)
  if (digits.startsWith('9') && digits.length > 10) {
    digits = digits.slice(1)
  }
  // 15 al inicio del abonado después del área (ej. área 11 → "11 15 XXXX-XXXX")
  // Solo cuando tenemos más de 10 dígitos y empieza con área conocida + 15
  if (digits.length === 12 && digits.slice(2, 4) === '15') {
    digits = digits.slice(0, 2) + digits.slice(4)
  }
  if (digits.length === 13 && digits.slice(3, 5) === '15') {
    digits = digits.slice(0, 3) + digits.slice(5)
  }
  if (digits.length === 14 && digits.slice(4, 6) === '15') {
    digits = digits.slice(0, 4) + digits.slice(6)
  }
  return digits
}

/**
 * Devuelve el número limpio de 10 dígitos para guardar en base de datos.
 * Si el valor no tiene exactamente 10 dígitos tras la limpieza, devuelve null.
 */
export function parsePhoneNumber(value: string): string | null {
  const digits = stripArgentinePrefixes(digitsOnly(value))
  return digits.length === 10 ? digits : null
}

/**
 * Formatea dinámicamente el input del usuario mientras escribe.
 * - No modifica el texto si el número limpio aún no llega a 10 dígitos
 *   (para no interrumpir la escritura).
 * - Si el número limpio tiene exactamente 10 dígitos, aplica el formato
 *   correspondiente al área.
 * - Siempre devuelve el texto tal como debe mostrarse en el input.
 */
export function formatPhoneInput(value: string): string {
  const digits = stripArgentinePrefixes(digitsOnly(value))

  if (digits.length < 10) {
    // Aún incompleto: devolver solo los dígitos sin formato para no confundir
    return digits
  }

  const d = digits.slice(0, 10)
  const area2 = d.slice(0, 2)
  const area3 = d.slice(0, 3)
  const area4 = d.slice(0, 4)

  if (area2 === '11') {
    // CABA: "11 XXXX-XXXX"
    return `11 ${d.slice(2, 6)}-${d.slice(6, 10)}`
  }

  // Heurística: áreas de 3 dígitos son las de capitales de provincia grandes
  // (2xx, 3xx excepto 380–399 que son de 4, etc.). Usamos la longitud del abonado
  // como criterio: área 3 → abonado de 7 → no puede ser (solo 10 total); entonces:
  //   área 3 → abonado 7 dígitos → formato "XXX XXX-XXXX"  (3+7=10, ej. 341-XXXXXXX)
  //   área 4 → abonado 6 dígitos → formato "XXXX XX-XXXX"  (4+6=10, ej. 2944-XXXXXX)
  // Determinamos por la inicial del prefijo:
  //   Áreas conocidas de 3 dígitos empiezan en 2xx o 3xx (excluyendo 11 ya tratado)
  //   y los abonados tienen 7 dígitos.
  // Como no tenemos un catálogo completo, usamos la siguiente heurística segura:
  //   Si el primer dígito es 1 (solo CABA=11, ya tratada) → no llegaremos aquí.
  //   Para los demás, si el área candidata de 4 cifras inicia con prefijos conocidos de
  //   interior chico (2944, 2902, 2972, 3364, etc.) asumimos 4 dígitos.
  //   De lo contrario, 3 dígitos.
  // Aproximación práctica: si d[3] == '5' | '6' | '7' | '8' | '9' (abonado 7 dígitos
  // no empieza con esos en la mayoría de áreas de 4 dígitos), asumir área 3.
  // Para simplificar y ser robusto: usamos área de 3 si el área candidata está entre
  // 200–399 excluyendo rangos de 4 dígitos obvios; de lo contrario área 4.
  // El enfoque más práctico: asumir área de 3 por defecto y área de 4 cuando
  // los primeros 4 dígitos son claramente un código de área (empieza con 2 o 3
  // y el abonado restante tiene solo 6 dígitos → forzar 4 dígitos de área).

  // Como área 3 + 7 abonado = 10 y área 4 + 6 abonado = 10, la única forma de
  // distinguirlos con certeza es un catálogo. Usamos la regla práctica:
  // si el 4to dígito forma parte de un número bajo (0–4), es probablemente parte
  // del área (área de 4); si el 4to dígito es 5–9, el abonado empieza ahí (área de 3).
  const fourthDigit = parseInt(d[3], 10)
  if (fourthDigit <= 4) {
    // Área de 4 dígitos: "XXXX XX-XXXX"
    return `${area4} ${d.slice(4, 6)}-${d.slice(6, 10)}`
  }

  // Área de 3 dígitos: "XXX XXX-XXXX"
  return `${area3} ${d.slice(3, 6)}-${d.slice(6, 10)}`
}
