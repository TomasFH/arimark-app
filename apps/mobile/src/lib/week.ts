/**
 * Semana laboral lun–dom en el timezone de presentación.
 * Misma regla que desktop (`datetime.ts`): persistido UTC, civil en local.
 */
export const DISPLAY_TIMEZONE = 'America/Argentina/Buenos_Aires'

export function todayLocalYmd(timeZone = DISPLAY_TIMEZONE): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}

export function addDaysYmd(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weekStartMondayLocalYmd(fromYmd?: string, timeZone = DISPLAY_TIMEZONE): string {
  const ymd = fromYmd ?? todayLocalYmd(timeZone)
  const d = new Date(`${ymd}T12:00:00.000Z`)
  const day = d.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return addDaysYmd(ymd, mondayOffset)
}

export function formatYmd(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd)
  if (!m) return yyyyMmDd
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Día civil `YYYY-MM-DD` (retiro de pedido, vencimientos) sin timezone.
 * `new Date('2026-08-30')` es UTC medianoche y en AR muestra el día anterior.
 * Timestamps con hora siguen yendo por `toLocaleDateString`.
 */
export function formatDisplayDate(iso: string): string {
  const trimmed = iso.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return formatYmd(trimmed)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function utcToLocalYmd(utc: string, timeZone = DISPLAY_TIMEZONE): string {
  if (!utc) return ''
  return new Date(utc).toLocaleDateString('en-CA', { timeZone })
}

export function valeInLocalWeek(
  paidAt: string,
  weekStart: string,
  weekEnd: string,
  timeZone = DISPLAY_TIMEZONE,
): boolean {
  const ymd = utcToLocalYmd(paidAt, timeZone)
  return ymd !== '' && ymd >= weekStart && ymd <= weekEnd
}

/** Rango UTC holgado (1 día a cada lado) para query Firestore; el filtro civil es `valeInLocalWeek`. */
export function firestorePaidAtBounds(weekStart: string, weekEnd: string): { from: string; to: string } {
  return {
    from: `${addDaysYmd(weekStart, -1)}T00:00:00.000Z`,
    to: `${addDaysYmd(weekEnd, 1)}T23:59:59.999Z`,
  }
}
