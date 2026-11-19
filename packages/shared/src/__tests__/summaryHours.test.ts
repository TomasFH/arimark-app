import { describe, expect, it } from 'vitest'
import {
  averageSoldHours,
  peakSoldHour,
  soldHourChartBars,
  summarySoldByHour,
} from '../summaryHours'

const YMD = '2026-11-18'

function at(iso: string, total: number) {
  return { createdAt: iso, total }
}

describe('ventas por hora', () => {
  it('suma la misma hora civil y deja en cero las horas del medio', () => {
    const buckets = summarySoldByHour([
      at('2026-11-18T15:00:00.000Z', 1000),
      at('2026-11-18T15:40:00.000Z', 500),
      at('2026-11-18T22:30:00.000Z', 800),
      at('2026-11-17T15:00:00.000Z', 9999),
      at('no-es-fecha', 50),
    ], YMD)

    expect(buckets).toHaveLength(24)
    expect(buckets[12]).toEqual({ hour: 12, amount: 1500, saleCount: 2 })
    expect(buckets[19]).toEqual({ hour: 19, amount: 800, saleCount: 1 })
    expect(buckets[15]).toEqual({ hour: 15, amount: 0, saleCount: 0 })
    const bars = soldHourChartBars(buckets)
    expect(bars[0]).toMatchObject({ label: '12h', amount: 1500 })
    expect(bars.at(-1)).toMatchObject({ label: '19h', amount: 800 })
    expect(bars).toHaveLength(8)
    expect(bars[3]).toMatchObject({ label: '15h', amount: 0 })
  })

  it('el pico promedio es la hora con más plata, no el promedio de los relojes', () => {
    const quiet = summarySoldByHour([], YMD)
    const monday = summarySoldByHour([at('2026-11-18T13:00:00.000Z', 1000)], YMD)
    const tuesday = summarySoldByHour([at('2026-11-18T22:00:00.000Z', 100)], YMD)
    const average = averageSoldHours([monday, tuesday, quiet.slice(0, 3)])
    expect(average[10]?.amount).toBe(500)
    expect(average[19]?.amount).toBe(50)
    expect(peakSoldHour(average)?.hour).toBe(10)
  })
})
