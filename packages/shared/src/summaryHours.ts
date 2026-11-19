/**
 * Ventas confirmadas de un día, cortadas por hora civil.
 * El promedio de varios días se hace hora por hora.
 * El horario pico es la hora con más plata en ese promedio,
 * no el promedio de los relojes pico.
 */
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'
import type { SoldDayBar } from './summaryMoney'

export interface SaleHourStamp {
  createdAt: string
  total: number
}

export interface SoldHourBucket {
  /** 0–23 en el huso del negocio. El índice es la hora. */
  hour: number
  amount: number
  saleCount: number
}

export function civilHour(at: Date, timeZone = DISPLAY_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const raw = Number(parts.find(part => part.type === 'hour')?.value ?? '0')
  if (!Number.isInteger(raw)) return 0
  if (raw === 24) return 0
  if (raw < 0 || raw > 23) return 0
  return raw
}

function emptyDay(): SoldHourBucket[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0, saleCount: 0 }))
}

/** 24 baldes. Una venta de otro día no entra. Una hora sin ventas queda en cero. */
export function summarySoldByHour(
  sales: SaleHourStamp[],
  ymd: string,
  timeZone = DISPLAY_TIMEZONE,
): SoldHourBucket[] {
  const buckets = emptyDay()
  for (const sale of sales) {
    if (!Number.isFinite(sale.total)) continue
    const at = new Date(sale.createdAt)
    if (Number.isNaN(at.getTime())) continue
    if (civilYmd(at, timeZone) !== ymd) continue
    const bucket = buckets[civilHour(at, timeZone)]
    if (!bucket) continue
    bucket.amount += sale.total
    bucket.saleCount += 1
  }
  return buckets
}

/**
 * De la primera hora con ventas a la última, con los ceros del medio.
 * Esas horas quietas son parte del pico: no se recortan.
 */
export function soldHourChartBars(buckets: SoldHourBucket[]): SoldDayBar[] {
  let start = -1
  let end = -1
  for (const bucket of buckets) {
    if (bucket.saleCount <= 0) continue
    if (start < 0) start = bucket.hour
    end = bucket.hour
  }
  if (start < 0 || end < start) return []
  return buckets.slice(start, end + 1).map(bucket => ({
    ymd: `hour-${String(bucket.hour).padStart(2, '0')}`,
    label: `${bucket.hour}h`,
    amount: bucket.amount,
  }))
}

/** Hora con más plata. Si empatan, queda la más temprana. */
export function peakSoldHour(buckets: SoldHourBucket[]): SoldHourBucket | null {
  let best: SoldHourBucket | null = null
  for (const bucket of buckets) {
    if (bucket.saleCount <= 0 && bucket.amount <= 0) continue
    if (!best || bucket.amount > best.amount) best = bucket
  }
  return best
}

/**
 * Promedio de la misma hora a través de días.
 * Cada día tiene que traer las 24 horas, aunque estén en cero.
 */
export function averageSoldHours(days: SoldHourBucket[][]): SoldHourBucket[] {
  const totals = emptyDay()
  let counted = 0
  for (const day of days) {
    if (day.length !== 24) continue
    counted += 1
    for (const bucket of day) {
      const slot = totals[bucket.hour]
      if (!slot) continue
      slot.amount += bucket.amount
      slot.saleCount += bucket.saleCount
    }
  }
  if (counted === 0) return totals
  return totals.map(slot => ({
    hour: slot.hour,
    amount: slot.amount / counted,
    saleCount: slot.saleCount / counted,
  }))
}
