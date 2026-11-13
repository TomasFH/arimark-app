import { describe, expect, it } from 'vitest'
import {
  groupMediaResByDay,
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
})
