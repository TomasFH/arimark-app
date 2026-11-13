import { describe, expect, it } from 'vitest'
import {
  groupMediaResByDay,
  mediaResAverageKg,
  mediaResTotals,
  mediaResVisits,
  mediaResWeekdayBars,
} from '../mediaResSummary'

describe('mediaResVisits', () => {
  it('cuenta solo el rubro media res, con el kilo de cada pieza', () => {
    const visits = mediaResVisits([{
      id: 'v1',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Frigorífico',
      receivedByName: 'Luis',
      lines: [
        { rubroId: 'rubro_media_res', count: 2, netKg: 180, weightsKg: [90, 90] },
        { rubroId: 'rubro_pollo_entero', count: 4, netKg: 40, weightsKg: [10, 10, 10, 10] },
      ],
    }, {
      id: 'v2',
      createdAt: '2026-10-26T18:00:00.000Z',
      providerName: null,
      receivedByName: 'Ana',
      lines: [
        { rubroId: 'rubro_otro', count: 3, netKg: 30, weightsKg: [10, 10, 10] },
      ],
    }])
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({
      providerName: 'Frigorífico',
      receivedByName: 'Luis',
      count: 2,
      kg: 180,
    })
    expect(visits[0]?.pieces).toEqual([{ kg: 90 }, { kg: 90 }])
    expect(mediaResTotals(visits)).toEqual({ count: 2, kg: 180 })
    const days = groupMediaResByDay(visits)
    expect(days).toHaveLength(1)
    const bars = mediaResWeekdayBars(visits)
    expect(bars).toHaveLength(7)
    expect(bars.reduce((sum, bar) => sum + bar.count, 0)).toBe(2)
    expect(bars.find(bar => bar.count === 2)?.label).toBe('Lun')
  })

  it('toma el caso real custom:media res: 2 piezas y 188 kg, y no el otro renglón', () => {
    const visits = mediaResVisits([{
      id: 'real-media',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Mercedino',
      receivedByName: 'Luis',
      lines: [
        { rubroId: 'custom:media res', count: 2, netKg: 188, weightsKg: [] },
        { rubroId: 'prod-bondiola', count: 1, netKg: 40, weightsKg: [40] },
      ],
    }])
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ providerName: 'Mercedino', count: 2, kg: 188 })
    expect(mediaResTotals(visits)).toEqual({ count: 2, kg: 188 })
  })

  it('con 2 piezas y 188 kg, sin peso de cada pieza, no inventa kilos ni un promedio en cero', () => {
    const visits = mediaResVisits([{
      id: 'real-media',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Mercedino',
      receivedByName: 'Luis',
      lines: [
        { rubroId: 'custom:media res', count: 2, netKg: 188, weightsKg: [] },
      ],
    }])
    expect(visits).toHaveLength(1)
    expect(visits[0]?.pieces).toEqual([])
    expect(visits[0]).toMatchObject({ count: 2, kg: 188 })
    expect(mediaResAverageKg(visits)).toBeNull()
    expect(mediaResTotals(visits)).toEqual({ count: 2, kg: 188 })
  })

  it('toma un producto del catálogo llamado Media res medido en piezas', () => {
    const visits = mediaResVisits([{
      id: 'catalogo',
      createdAt: '2026-10-27T15:00:00.000Z',
      providerName: 'Frigorífico',
      receivedByName: 'Ana',
      lines: [
        {
          rubroId: 'prod-media-res',
          rubroName: 'Media res',
          nameKey: 'media res',
          count: 2,
          netKg: 176,
          weightsKg: [88, 88],
        },
      ],
    }])
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ count: 2, kg: 176 })
    expect(visits[0]?.pieces).toEqual([{ kg: 88 }, { kg: 88 }])
  })

  it('no toma un corte por kilo aunque el nombre incluya media res', () => {
    const visits = mediaResVisits([{
      id: 'corte',
      createdAt: '2026-10-27T16:00:00.000Z',
      providerName: 'Frigorífico',
      receivedByName: 'Ana',
      lines: [
        {
          rubroId: 'prod-asado',
          rubroName: 'Asado media res',
          nameKey: 'asado media res',
          template: 'weight',
          count: 1,
          netKg: 6.5,
          weightsKg: [6.5],
        },
      ],
    }])
    expect(visits).toEqual([])
    expect(mediaResTotals(visits)).toEqual({ count: 0, kg: 0 })
  })
})
