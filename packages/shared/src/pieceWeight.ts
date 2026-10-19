/**
 * Referencia de peso por unidad para pedidos (morcilla, chorizo, costillar).
 * Se guarda un solo kg por pieza. El peso del ticket al cobrar no entra acá.
 */

const PIECE_KG_DECIMALS = 3

export function roundPieceKg(kg: number): number {
  if (!Number.isFinite(kg)) return Number.NaN
  const factor = 10 ** PIECE_KG_DECIMALS
  return Math.round(kg * factor) / factor
}

/** Kilos por unidad a partir del peso total de N piezas. */
export function impliedPieceKg(totalKg: number, units: number): number | null {
  if (!Number.isFinite(totalKg) || !Number.isFinite(units) || units <= 0 || totalKg <= 0) return null
  const piece = roundPieceKg(totalKg / units)
  return piece > 0 ? piece : null
}

/** Peso estimado de N piezas según la referencia guardada. */
export function estimateKgFromPiece(units: number, kgPerUnit: number): number | null {
  if (!Number.isFinite(units) || !Number.isFinite(kgPerUnit) || units <= 0 || kgPerUnit <= 0) return null
  const total = roundPieceKg(units * kgPerUnit)
  return total > 0 ? total : null
}

export interface PieceWeightLine {
  productId: string
  name: string
  totalKg: number
  units: number
}

export interface PieceWeightUpdate {
  productId: string
  kgPerUnit: number
}

export interface PieceWeightChange extends PieceWeightUpdate {
  name: string
  previous: number
}

export interface PieceWeightDecisions {
  /** Primera vez: se guarda sin preguntar. */
  first: PieceWeightUpdate[]
  /** Distinto al guardado: la cajera elige si lo recuerda. */
  changes: PieceWeightChange[]
}

/**
 * La última línea de cada producto gana.
 * Sin referencia previa → first. Con referencia distinta → changes.
 */
export function pieceWeightDecisions(
  lines: readonly PieceWeightLine[],
  storedKgByProduct: Readonly<Record<string, number>>,
): PieceWeightDecisions {
  const last = new Map<string, PieceWeightLine & { piece: number }>()
  for (const line of lines) {
    const piece = impliedPieceKg(line.totalKg, line.units)
    if (!line.productId || piece == null) continue
    last.set(line.productId, { ...line, piece })
  }

  const first: PieceWeightUpdate[] = []
  const changes: PieceWeightChange[] = []
  for (const line of last.values()) {
    const previousRaw = storedKgByProduct[line.productId]
    const previous = previousRaw == null ? null : roundPieceKg(previousRaw)
    if (previous == null || !Number.isFinite(previous) || previous <= 0) {
      first.push({ productId: line.productId, kgPerUnit: line.piece })
      continue
    }
    if (previous !== line.piece) {
      changes.push({
        productId: line.productId,
        name: line.name,
        previous,
        kgPerUnit: line.piece,
      })
    }
  }
  return { first, changes }
}
