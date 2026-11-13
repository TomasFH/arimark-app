/**
 * Estado de la caja al cierre. La misma cuenta en la PC y en el celu.
 *
 * Vacío no es cero. «Cerró bien» solo con los dos montos escritos y cuadrados
 * contra el efectivo esperado. Si solo está «quedó», no se inventa diferencia.
 */

export function isWrittenAmount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Total contado. Null si falta «quedó» o «se retiró». */
export function closingCashFromParts(
  cashLeft: number | null | undefined,
  withdrawn: number | null | undefined,
): number | null {
  if (!isWrittenAmount(cashLeft) || !isWrittenAmount(withdrawn)) return null
  return cashLeft + withdrawn
}

/**
 * Campo vacío (null) no se manda. 0 se manda.
 * El que no está en el resultado no se escribe.
 */
export function amountPatch(
  cashLeft: number | null,
  withdrawn: number | null,
): { cashLeft?: number; withdrawn?: number } {
  const patch: { cashLeft?: number; withdrawn?: number } = {}
  if (cashLeft != null) patch.cashLeft = cashLeft
  if (withdrawn != null) patch.withdrawn = withdrawn
  return patch
}

export interface ShiftCloseBoxInput {
  /** Null o ausente = no se escribió. 0 es un dato. */
  cashLeft: number | null | undefined
  withdrawn: number | null | undefined
  /**
   * Efectivo esperado en la registradora.
   * Null si la plata del turno todavía no llegó: no se dice «cerró bien».
   */
  expectedCash: number | null | undefined
}

export type ShiftCloseBox =
  | { kind: 'unnoted' }
  | { kind: 'left_only'; cashLeft: number }
  | { kind: 'matched' }
  | { kind: 'difference'; difference: number }
  | { kind: 'pending' }

function pesos(value: number): number {
  return Math.round(value)
}

/**
 * Diferencia = esperado − quedó − se retiró.
 * Positivo: faltó plata. Negativo: sobró.
 */
export function shiftCloseBox(input: ShiftCloseBoxInput): ShiftCloseBox {
  if (!isWrittenAmount(input.expectedCash)) return { kind: 'pending' }
  const left = isWrittenAmount(input.cashLeft) ? input.cashLeft : null
  const withdrawn = isWrittenAmount(input.withdrawn) ? input.withdrawn : null
  if (left == null && withdrawn == null) return { kind: 'unnoted' }
  if (left != null && withdrawn == null) return { kind: 'left_only', cashLeft: left }
  if (left == null || withdrawn == null) return { kind: 'unnoted' }
  const difference = pesos(input.expectedCash) - pesos(left) - pesos(withdrawn)
  if (difference === 0) return { kind: 'matched' }
  return { kind: 'difference', difference }
}

const TALLY_LABEL: Record<ShiftCloseBox['kind'], string> = {
  matched: 'cerró bien',
  difference: 'con diferencia',
  unnoted: 'sin anotar',
  left_only: 'retiro sin anotar',
  pending: 'todavía no llegó',
}

const TALLY_ORDER: ShiftCloseBox['kind'][] = [
  'matched',
  'difference',
  'unnoted',
  'left_only',
  'pending',
]

/** Conteos de arriba. El texto de cada fila sigue siendo shiftCloseBoxText. */
export function summaryBoxTally(
  boxes: ShiftCloseBox[],
): { kind: ShiftCloseBox['kind']; label: string; count: number }[] {
  const counts = new Map<ShiftCloseBox['kind'], number>()
  for (const box of boxes) counts.set(box.kind, (counts.get(box.kind) ?? 0) + 1)
  return TALLY_ORDER.flatMap(kind => {
    const count = counts.get(kind) ?? 0
    if (count === 0) return []
    return [{ kind, label: TALLY_LABEL[kind], count }]
  })
}

export function shiftCloseBoxText(
  box: ShiftCloseBox,
  formatMoney: (amount: number) => string,
): string {
  switch (box.kind) {
    case 'unnoted':
      return 'sin anotar'
    case 'left_only':
      return `${formatMoney(box.cashLeft)} · retiro sin anotar`
    case 'matched':
      return 'cerró bien'
    case 'difference':
      return formatMoney(box.difference)
    case 'pending':
      return 'todavía no llegó'
  }
}
