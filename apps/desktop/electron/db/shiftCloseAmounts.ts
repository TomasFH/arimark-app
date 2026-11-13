/**
 * Montos del cierre ajeno.
 *
 * `closingCash` es el total (quedó + se retiró) y solo existe cuando los dos
 * fueron escritos. Guardar «quedó» ahí con «se retiró» vacío haría que la
 * resta lo tome como que no se retiró nada.
 * Null = no se escribió. 0 es un dato.
 */

/** Total contado. Null si falta «quedó» o «se retiró». */
export function closingCashFromParts(
  cashLeft: number | null,
  withdrawn: number | null,
): number | null {
  if (cashLeft == null || withdrawn == null) return null
  if (!Number.isFinite(cashLeft) || !Number.isFinite(withdrawn)) return null
  return cashLeft + withdrawn
}

export function finiteAmount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}
