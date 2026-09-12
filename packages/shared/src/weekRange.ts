/**
 * Semana laboral lun–dom en el timezone de presentación.
 * Los instantes ISO son UTC; el corte civil es medianoche de Buenos Aires.
 */
import { DISPLAY_TIMEZONE, civilYmd } from './pickupHours'
import type { Weekday } from './storeHours'

export function addDaysYmd(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weekStartMondayYmd(fromYmd: string): string {
  const d = new Date(`${fromYmd}T12:00:00.000Z`)
  const day = d.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return addDaysYmd(fromYmd, mondayOffset)
}

export function weekdayInTimeZone(
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): Weekday {
  const ymd = civilYmd(now, timeZone)
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0)).getUTCDay() as Weekday
}

export interface MondayWeekRange {
  startYmd: string
  endInclusiveYmd: string
  endYmdExclusive: string
  startIso: string
  endIso: string
  weekOffset: number
}

/** Medianoche civil AR → ISO UTC. Argentina no usa DST. */
function ymdMidnightArIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00.000-03:00`).toISOString()
}

export function mondayWeekRange(
  weekOffset = 0,
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): MondayWeekRange {
  const startYmd = addDaysYmd(weekStartMondayYmd(civilYmd(now, timeZone)), weekOffset * 7)
  const endInclusiveYmd = addDaysYmd(startYmd, 6)
  const endYmdExclusive = addDaysYmd(startYmd, 7)
  return {
    startYmd,
    endInclusiveYmd,
    endYmdExclusive,
    startIso: ymdMidnightArIso(startYmd),
    endIso: ymdMidnightArIso(endYmdExclusive),
    weekOffset,
  }
}

export function formatWeekRangeLabel(startYmd: string, endInclusiveYmd: string): string {
  const fmt = (ymd: string): string => {
    const parts = ymd.split('-')
    const d = parts[2] ?? ''
    const m = parts[1] ?? ''
    return `${d}/${m}`
  }
  return `Semana ${fmt(startYmd)} – ${fmt(endInclusiveYmd)}`
}
