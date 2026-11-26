import { describe, expect, it } from 'vitest'
import type { MerchIntakeLineSnapshot } from '@carniceria/shared'
import { historyVisitLinesFromSnapshots } from '../historyVisitLines'

function line(partial: Partial<MerchIntakeLineSnapshot> & Pick<MerchIntakeLineSnapshot, 'id' | 'rubroName'>): MerchIntakeLineSnapshot {
  return {
    rubroId: partial.rubroId ?? partial.id,
    template: 'weight',
    sortOrder: 0,
    packLabel: null,
    count: 1,
    packContents: null,
    packTareKg: null,
    hasIce: false,
    grossKg: partial.netKg ?? null,
    netKg: partial.netKg ?? null,
    unitCount: null,
    kgPerUnit: null,
    weightsKg: [],
    productId: null,
    nameKey: partial.rubroName.toLowerCase(),
    costUnit: 'kg',
    unitCost: partial.unitCost ?? 0,
    costTotal: partial.costTotal ?? 0,
    packCount: null,
    weighMode: null,
    moneyRole: 'payable',
    notForSale: false,
    ...partial,
  }
}

describe('historyVisitLinesFromSnapshots', () => {
  it('la cajera no ve el precio de la media res', () => {
    const lines = historyVisitLinesFromSnapshots([
      line({ id: 'a', rubroName: 'Bondiola', netKg: 2, unitCost: 2500, costTotal: 5000 }),
      line({
        id: 'b',
        rubroId: 'rubro_media_res',
        rubroName: 'Media res',
        template: 'pieces_weight',
        netKg: 90,
        unitCost: 2500,
        costTotal: 225000,
        moneyRole: 'informed',
      }),
    ], true)
    expect(lines[0]).toMatchObject({ name: 'Bondiola', unitPrice: 2500, subtotal: 5000 })
    expect(lines[1]).toMatchObject({ name: 'Media res', unitPrice: 0, subtotal: 0 })
  })

  it('el admin ve el monto informado de la media res', () => {
    const lines = historyVisitLinesFromSnapshots([
      line({
        id: 'b',
        rubroId: 'rubro_media_res',
        rubroName: 'Media res',
        unitCost: 2500,
        costTotal: 225000,
        moneyRole: 'informed',
      }),
    ], false)
    expect(lines[0]?.subtotal).toBe(225000)
  })
})