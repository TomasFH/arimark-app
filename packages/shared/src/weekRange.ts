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

export interface CalendarMonthRange {
  startYmd: string
  endInclusiveYmd: string
  endYmdExclusive: string
  startIso: string
  endIso: string
  monthOffset: number
  year: number
  month: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Mes civil AR. monthOffset 0 = mes actual; negativo = meses anteriores. */
export function calendarMonthRange(
  monthOffset = 0,
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): CalendarMonthRange {
  const ymd = civilYmd(now, timeZone)
  const [ys, ms] = ymd.split('-')
  const y0 = Number(ys)
  const m0 = Number(ms)
  const idx = y0 * 12 + (m0 - 1) + monthOffset
  const year = Math.floor(idx / 12)
  const month = ((idx % 12) + 12) % 12 + 1
  const startYmd = `${year}-${pad2(month)}-01`
  const nextIdx = idx + 1
  const nextYear = Math.floor(nextIdx / 12)
  const nextMonth = (nextIdx % 12) + 1
  const endYmdExclusive = `${nextYear}-${pad2(nextMonth)}-01`
  const endInclusiveYmd = addDaysYmd(endYmdExclusive, -1)
  return {
    startYmd,
    endInclusiveYmd,
    endYmdExclusive,
    startIso: ymdMidnightArIso(startYmd),
    endIso: ymdMidnightArIso(endYmdExclusive),
    monthOffset,
    year,
    month,
  }
}

/** Medianoche civil AR → ISO UTC. Argentina no usa DST. */
function ymdMidnightArIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00.000-03:00`).toISOString()
}

/** Del día civil inclusive al siguiente exclusive, en medianoche de Argentina. */
export function inclusiveCivilSpan(
  startYmd: string,
  endInclusiveYmd: string,
): { startIso: string; endIso: string } {
  return {
    startIso: ymdMidnightArIso(startYmd),
    endIso: ymdMidnightArIso(addDaysYmd(endInclusiveYmd, 1)),
  }
}

/** Semana en curso y la anterior, lunes a domingo. */
export function cashierHistoryWindow(
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): { fromYmd: string; toYmd: string } {
  return {
    fromYmd: mondayWeekRange(-1, now, timeZone).startYmd,
    toYmd: mondayWeekRange(0, now, timeZone).endInclusiveYmd,
  }
}

export function mondayWeekRange(
  weekOffset = 0,
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): MondayWeekRange {
  const startYmd = addDaysYmd(weekStartMondayYmd(civilYmd(now, timeZone)), weekOffset * 7)
  return mondayWeekFromStart(startYmd, weekOffset)
}

/** Semana lun–dom que contiene ese instante. */
export function mondayWeekContaining(
  at: Date | string,
  timeZone = DISPLAY_TIMEZONE,
): MondayWeekRange {
  const when = typeof at === 'string' ? new Date(at) : at
  const startYmd = weekStartMondayYmd(civilYmd(when, timeZone))
  return mondayWeekFromStart(startYmd, 0)
}

function mondayWeekFromStart(startYmd: string, weekOffset: number): MondayWeekRange {
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

const SUMMARY_MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

/**
 * Mes del resumen: la semana entera pertenece al mes de su lunes.
 * El rango va del primer lunes de ese mes al domingo del último lunes.
 */
export interface SummaryMonthSpan {
  year: number
  month: number
  name: string
  startYmd: string
  endInclusiveYmd: string
  endYmdExclusive: string
  startIso: string
  endIso: string
}

export function summaryMonthName(month: number): string {
  return SUMMARY_MONTH_NAMES[month - 1] ?? ''
}

/** Mes civil del lunes. `mondayYmd` tiene que ser un lunes. */
export function monthOfWeekMonday(mondayYmd: string): { year: number; month: number } {
  const [ys, ms] = mondayYmd.split('-')
  return { year: Number(ys), month: Number(ms) }
}

/** Primer lunes que cae dentro del mes. El 1, si no es lunes, queda en el mes anterior. */
export function firstMondayOfMonth(year: number, month: number): string {
  const first = `${year}-${pad2(month)}-01`
  const monday = weekStartMondayYmd(first)
  return monday < first ? addDaysYmd(monday, 7) : monday
}

/** Último lunes que cae dentro del mes. Su domingo puede caer en el mes siguiente. */
export function lastMondayOfMonth(year: number, month: number): string {
  const next = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${pad2(month + 1)}-01`
  return weekStartMondayYmd(addDaysYmd(next, -1))
}

export function summaryMonthSpan(year: number, month: number): SummaryMonthSpan {
  const startYmd = firstMondayOfMonth(year, month)
  const lastMonday = lastMondayOfMonth(year, month)
  const endInclusiveYmd = addDaysYmd(lastMonday, 6)
  const endYmdExclusive = addDaysYmd(lastMonday, 7)
  return {
    year,
    month,
    name: summaryMonthName(month),
    startYmd,
    endInclusiveYmd,
    endYmdExclusive,
    startIso: ymdMidnightArIso(startYmd),
    endIso: ymdMidnightArIso(endYmdExclusive),
  }
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 + 1 }
}

/**
 * Mes de la semana que está en curso (el mes de su lunes), o un solo paso atrás.
 * El domingo 1 nov 2026 sigue siendo octubre. Desde el lunes 2, es noviembre.
 */
export function summaryMonthStep(
  step: 0 | 1,
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): SummaryMonthSpan {
  const week = mondayWeekRange(0, now, timeZone)
  const current = monthOfWeekMonday(week.startYmd)
  const target = step === 0 ? current : shiftMonth(current.year, current.month, -1)
  return summaryMonthSpan(target.year, target.month)
}

export type SummaryPeriod = 'today' | 'week' | 'month' | 'previous'

/**
 * Rango que se consulta. Hoy y esta semana piden la misma semana:
 * el día se filtra después, sin otra lectura.
 */
export function summaryPeriodQuery(
  period: SummaryPeriod,
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): { startIso: string; endIso: string } {
  if (period === 'month' || period === 'previous') {
    const month = summaryMonthStep(period === 'month' ? 0 : 1, now, timeZone)
    return { startIso: month.startIso, endIso: month.endIso }
  }
  const week = mondayWeekRange(0, now, timeZone)
  return { startIso: week.startIso, endIso: week.endIso }
}

/** Fechas civiles que se muestran. Hoy es el día, no la semana entera. */
export function summaryPeriodDates(
  period: SummaryPeriod,
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): { startYmd: string; endYmd: string } {
  if (period === 'today') {
    const ymd = civilYmd(now, timeZone)
    return { startYmd: ymd, endYmd: ymd }
  }
  if (period === 'week') {
    const week = mondayWeekRange(0, now, timeZone)
    return { startYmd: week.startYmd, endYmd: week.endInclusiveYmd }
  }
  const month = summaryMonthStep(period === 'month' ? 0 : 1, now, timeZone)
  return { startYmd: month.startYmd, endYmd: month.endInclusiveYmd }
}

export function ymdInRange(ymd: string, startYmd: string, endYmd: string): boolean {
  return ymd >= startYmd && ymd <= endYmd
}

export function formatSummaryRange(startYmd: string, endInclusiveYmd: string): string {
  const fmt = (ymd: string): string => {
    const parts = ymd.split('-')
    return `${parts[2] ?? ''}/${parts[1] ?? ''}`
  }
  if (startYmd === endInclusiveYmd) return fmt(startYmd)
  return `${fmt(startYmd)} – ${fmt(endInclusiveYmd)}`
}

/** Semanas lun–dom que tocan [startIso, endIso). El fin es exclusivo. */
export function mondayWeeksInRange(startIso: string, endIso: string): MondayWeekRange[] {
  if (!(startIso < endIso)) return []
  let monday = weekStartMondayYmd(civilYmd(new Date(startIso)))
  const endYmd = civilYmd(new Date(endIso))
  const weeks: MondayWeekRange[] = []
  while (monday < endYmd) {
    const endInclusiveYmd = addDaysYmd(monday, 6)
    const endYmdExclusive = addDaysYmd(monday, 7)
    weeks.push({
      startYmd: monday,
      endInclusiveYmd,
      endYmdExclusive,
      startIso: ymdMidnightArIso(monday),
      endIso: ymdMidnightArIso(endYmdExclusive),
      weekOffset: 0,
    })
    monday = endYmdExclusive
  }
  return weeks
}
