import { describe, expect, it } from 'vitest'
import {
  estimateKgFromPiece,
  impliedPieceKg,
  pieceWeightDecisions,
} from '../pieceWeight'

describe('pieceWeight', () => {
  it('saca el peso por unidad de un pedido', () => {
    expect(impliedPieceKg(0.8, 4)).toBe(0.2)
    expect(estimateKgFromPiece(5, 0.2)).toBe(1)
  })

  it('guarda la primera vez sin tratarla como cambio', () => {
    const decisions = pieceWeightDecisions(
      [{ productId: 'm', name: 'Morcilla', totalKg: 0.8, units: 4 }],
      {},
    )
    expect(decisions.first).toEqual([{ productId: 'm', kgPerUnit: 0.2 }])
    expect(decisions.changes).toEqual([])
  })

  it('pregunta solo si el peso por unidad cambió', () => {
    const same = pieceWeightDecisions(
      [{ productId: 'm', name: 'Morcilla', totalKg: 1, units: 5 }],
      { m: 0.2 },
    )
    expect(same.changes).toEqual([])
    expect(same.first).toEqual([])

    const changed = pieceWeightDecisions(
      [{ productId: 'm', name: 'Morcilla', totalKg: 1.25, units: 5 }],
      { m: 0.2 },
    )
    expect(changed.changes).toEqual([{
      productId: 'm',
      name: 'Morcilla',
      previous: 0.2,
      kgPerUnit: 0.25,
    }])
  })

  it('ignora una línea sin unidades o sin kilos', () => {
    expect(pieceWeightDecisions(
      [{ productId: 'm', name: 'Morcilla', totalKg: 1, units: 0 }],
      {},
    ).first).toEqual([])
  })
})
