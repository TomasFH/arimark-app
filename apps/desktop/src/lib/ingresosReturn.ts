export type IngresosReturnTo = 'providers' | 'history'

export type IngresosBackTarget = 'history' | 'providers' | 'cashier' | 'hub'

/**
 * A dónde vuelve Mercadería recibida.
 * El historial gana aunque se haya entrado desde Consultas del POS:
 * si no, «Ver visita» deja la caja y pierde el turno abierto.
 */
export function ingresosBackTarget(input: {
  returnTo?: IngresosReturnTo
  fromCashier: boolean
}): IngresosBackTarget {
  if (input.returnTo === 'history') return 'history'
  if (input.returnTo === 'providers') return 'providers'
  if (input.fromCashier) return 'cashier'
  return 'hub'
}
