/**
 * Preselección de turno al abrir caja.
 * Si está en horario (o hasta 90 min antes de la apertura), elige ese turno.
 * Si no encaja en ninguno, Mañana.
 */

export type DetectedShiftType = 'morning' | 'evening'

/** Minutos antes del inicio en los que ya se asume ese turno (cajera que llega temprano). */
export const SHIFT_EARLY_WINDOW_MINUTES = 90

const MINUTES_PER_DAY = 24 * 60

export function timeToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number)
  return (hh ?? 0) * 60 + (mm ?? 0)
}

function inShiftHours(now: number, start: number, end: number): boolean {
  if (end >= start) return now >= start && now <= end
  return now >= start || now <= end
}

function inEarlyWindow(now: number, start: number): boolean {
  const early = start - SHIFT_EARLY_WINDOW_MINUTES
  if (early >= 0) return now >= early && now < start
  return now >= MINUTES_PER_DAY + early || now < start
}

export function detectShiftType(
  nowMinutes: number,
  morningStart: string | null | undefined,
  morningEnd: string | null | undefined,
  afternoonStart: string | null | undefined,
  afternoonEnd: string | null | undefined,
): DetectedShiftType {
  const morningStartMin = morningStart && morningEnd ? timeToMinutes(morningStart) : null
  const morningEndMin = morningStart && morningEnd ? timeToMinutes(morningEnd) : null
  const afternoonStartMin = afternoonStart && afternoonEnd ? timeToMinutes(afternoonStart) : null
  const afternoonEndMin = afternoonStart && afternoonEnd ? timeToMinutes(afternoonEnd) : null

  if (morningStartMin != null && morningEndMin != null && inShiftHours(nowMinutes, morningStartMin, morningEndMin)) {
    return 'morning'
  }
  if (afternoonStartMin != null && afternoonEndMin != null && inShiftHours(nowMinutes, afternoonStartMin, afternoonEndMin)) {
    return 'evening'
  }

  const early: { type: DetectedShiftType; start: number }[] = []
  if (afternoonStartMin != null && inEarlyWindow(nowMinutes, afternoonStartMin)) {
    early.push({ type: 'evening', start: afternoonStartMin })
  }
  if (morningStartMin != null && inEarlyWindow(nowMinutes, morningStartMin)) {
    early.push({ type: 'morning', start: morningStartMin })
  }
  if (early.length === 1) return early[0].type
  if (early.length > 1) {
    early.sort((a, b) => a.start - b.start)
    return early[0].type
  }

  return 'morning'
}
