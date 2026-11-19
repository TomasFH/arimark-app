import { describe, expect, it } from 'vitest'
import { weekdayFromYmd } from '../storeHours'
import { tallyShiftMoney } from '../summaryMoney'
import {
  averageCompleteShiftDays,
  averageSoldHours,
  confirmedSaleHourStamps,
  parseSoldHoursJson,
  peakSoldHour,
  soldHourAmounts,
  soldHourChartBars,
  soldHoursAmount,
  soldHoursFromAmounts,
  soldHoursJson,
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

  it('en un turno normal la suma de las 24 horas es el total vendido', () => {
    const ymd = '2026-11-18'
    const sales = [
      {
        status: 'confirmed',
        total: 10000,
        payments: [{ method: 'cash', amount: 7000 }],
        createdAt: '2026-11-18T13:00:00.000Z',
      },
      {
        status: 'confirmed',
        total: 4500,
        payments: [{ method: 'debit', amount: 4500 }],
        createdAt: '2026-11-18T21:00:00.000Z',
      },
      {
        status: 'cancelled',
        total: 99999,
        payments: [{ method: 'cash', amount: 99999 }],
        createdAt: '2026-11-18T14:00:00.000Z',
      },
    ]
    const money = tallyShiftMoney({
      sales: sales.map(({ status, total, payments }) => ({ status, total, payments })),
      deposits: [{ method: 'cash', amount: 3000 }],
      debtEvents: [
        { eventType: 'created', amount: 3000, paymentMethod: null },
        { eventType: 'payment', amount: 2000, paymentMethod: 'cash' },
      ],
      movements: [],
    })
    const hours = summarySoldByHour(confirmedSaleHourStamps(sales), ymd)
    expect(soldHoursAmount(hours)).toBe(money.soldTotal)
    expect(money.soldTotal).toBe(14500)
  })

  it('guarda veinticuatro montos y el vacío sigue siendo sin dato', () => {
    const hours = summarySoldByHour([
      at('2026-11-18T13:00:00.000Z', 1000),
      at('2026-11-18T13:10:00.000Z', 500),
    ], YMD)
    const raw = soldHoursJson(hours)
    expect(JSON.parse(raw ?? 'null')).toHaveLength(24)
    expect(soldHoursAmount(parseSoldHoursJson(raw) ?? [])).toBe(1500)
    const zeros = soldHoursFromAmounts(Array.from({ length: 24 }, () => 0))
    expect(zeros).toHaveLength(24)
    expect(soldHoursAmount(zeros ?? [])).toBe(0)
    expect(soldHourAmounts(zeros)?.[10]).toBe(0)
    expect(parseSoldHoursJson(null)).toBeNull()
    expect(parseSoldHoursJson('')).toBeNull()
    expect(parseSoldHoursJson('no-es-json')).toBeNull()
    expect(soldHoursFromAmounts([1, 2, 3])).toBeNull()
    expect(soldHoursJson(hours?.slice(0, 3) ?? null)).toBeNull()
  })

  it('el domingo con un solo turno cuenta', () => {
    const ymd = '2026-11-15'
    expect(weekdayFromYmd(ymd)).toBe(0)
    const morning = summarySoldByHour([at('2026-11-15T13:00:00.000Z', 4000)], ymd)
    const result = averageCompleteShiftDays([
      { ymd, open: false, hours: morning },
    ])
    expect(result.countedDayCount).toBe(1)
    expect(result.incompleteDayCount).toBe(0)
    expect(result.average[10]?.amount).toBe(4000)
  })

  it('la mañana con horas y la tarde sin horas queda afuera', () => {
    const ymd = '2026-11-18'
    const morning = summarySoldByHour([at('2026-11-18T13:00:00.000Z', 4000)], ymd)
    const result = averageCompleteShiftDays([
      { ymd, open: false, hours: morning },
      { ymd, open: false, hours: null },
    ])
    expect(result.countedDayCount).toBe(0)
    expect(result.incompleteDayCount).toBe(1)
    expect(result.average).toEqual([])
  })

  it('un turno cerrado y otro abierto deja el día afuera', () => {
    const ymd = '2026-11-18'
    const morning = summarySoldByHour([at('2026-11-18T13:00:00.000Z', 4000)], ymd)
    const result = averageCompleteShiftDays([
      { ymd, open: false, hours: morning },
      { ymd, open: true, hours: null },
    ])
    expect(result.countedDayCount).toBe(0)
    expect(result.incompleteDayCount).toBe(1)
    expect(result.average).toEqual([])
  })

  it('un día incompleto no entra al promedio como cero', () => {
    const monday = '2026-11-16'
    const tuesday = '2026-11-17'
    const wednesday = '2026-11-18'
    const mondayHours = summarySoldByHour([at('2026-11-16T13:00:00.000Z', 2000)], monday)
    const zeros = soldHoursFromAmounts(Array.from({ length: 24 }, () => 0))
    const result = averageCompleteShiftDays([
      { ymd: monday, open: false, hours: mondayHours },
      { ymd: tuesday, open: false, hours: zeros },
      { ymd: wednesday, open: false, hours: summarySoldByHour([at('2026-11-18T13:00:00.000Z', 9000)], wednesday) },
      { ymd: wednesday, open: false, hours: null },
    ])
    expect(result.countedDayCount).toBe(2)
    expect(result.incompleteDayCount).toBe(1)
    expect(result.average[10]?.amount).toBe(1000)
  })

  it('dos turnos completos del mismo día se suman y el día cuenta una vez', () => {
    const ymd = '2026-11-18'
    const morning = summarySoldByHour([at('2026-11-18T13:00:00.000Z', 1000)], ymd)
    const afternoon = summarySoldByHour([at('2026-11-18T21:00:00.000Z', 500)], ymd)
    const result = averageCompleteShiftDays([
      { ymd, open: false, hours: morning },
      { ymd, open: false, hours: afternoon },
    ])
    expect(result.countedDayCount).toBe(1)
    expect(result.incompleteDayCount).toBe(0)
    expect(result.average[10]?.amount).toBe(1000)
    expect(result.average[18]?.amount).toBe(500)
    expect(peakSoldHour(result.average)?.hour).toBe(10)
  })
})
