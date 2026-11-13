import { describe, expect, it } from 'vitest'
import { chickenTotals, chickenVisits, isChickenCrateLine } from '../chickenSummary'
import type { ChickenLineInput } from '../chickenSummary'

function line(partial: Partial<ChickenLineInput> & Pick<ChickenLineInput, 'rubroId' | 'rubroName'>): ChickenLineInput {
  return {
    nameKey: null,
    costUnit: null,
    packCount: null,
    count: null,
    netKg: null,
    grossKg: null,
    weightsKg: [],
    ...partial,
  }
}

describe('pollo en cajones', () => {
  it('suma el caso real Cajón de Pollo: 15 cajones y 304,3 kg brutos', () => {
    const visits = chickenVisits([{
      id: 'real-pollo',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Granja',
      receivedByName: 'Luis',
      storeName: 'Norte',
      lines: [line({
        rubroId: 'custom:cajon de pollo',
        rubroName: 'Cajón de Pollo',
        nameKey: 'cajon de pollo',
        costUnit: 'pack',
        packCount: 15,
        count: 15,
        netKg: 304.3,
        grossKg: 304.3,
        weightsKg: [20, 20, 20, 21, 20, 20.7, 20.5, 20.5, 20, 21, 20.3, 20.3, 20, 20, 20],
      })],
    }])
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ crates: 15, grossKg: 304.3 })
    expect(chickenTotals(visits)).toEqual({ crates: 15, grossKg: 304.3 })
  })

  it('no toma un corte por kilo aunque el nombre diga pollo', () => {
    const milanesa = line({
      rubroId: 'prod-mila',
      rubroName: 'Milanesa de pollo',
      nameKey: 'milanesa de pollo',
      costUnit: 'kg',
      netKg: 4,
    })
    expect(isChickenCrateLine(milanesa)).toBe(false)
    expect(chickenVisits([{
      id: 'mila',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Granja',
      receivedByName: 'Luis',
      lines: [milanesa],
    }])).toEqual([])
  })

  it('no toma un maple en cajones', () => {
    const maple = line({
      rubroId: 'prod-maple',
      rubroName: 'Maple',
      nameKey: 'maple',
      costUnit: 'pack',
      packCount: 3,
    })
    expect(isChickenCrateLine(maple)).toBe(false)
    expect(chickenVisits([{
      id: 'maple',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Granja',
      receivedByName: 'Luis',
      lines: [maple],
    }])).toEqual([])
  })

  it('en una visita mixta ignora la otra mercadería', () => {
    const visits = chickenVisits([{
      id: 'mixta',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Granja',
      receivedByName: 'Luis',
      lines: [
        line({
          rubroId: 'custom:pollo',
          rubroName: 'Pollo',
          nameKey: 'pollo',
          costUnit: 'pack',
          packCount: 2,
          weightsKg: [18, 19],
        }),
        line({
          rubroId: 'prod-bondiola',
          rubroName: 'Bondiola',
          nameKey: 'bondiola',
          costUnit: 'kg',
          netKg: 40,
          weightsKg: [40],
        }),
        line({
          rubroId: 'prod-maple',
          rubroName: 'Maple',
          nameKey: 'maple',
          costUnit: 'pack',
          packCount: 3,
        }),
      ],
    }])
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ crates: 2, grossKg: 37, crateKg: [18, 19] })
  })
})
