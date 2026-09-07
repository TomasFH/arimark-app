/**
 * Horarios de retiro vs franjas de atención del local.
 *
 * El admin carga rangos de apertura (campos morning_* / afternoon_*).
 * El nombre del turno no se etiqueta a mano: una franja es "mañana" si
 * empieza antes de las 14:00, y "tarde" si empieza a las 14:00 o después.
 * Un horario de retiro cae en el turno de la franja que lo contiene,
 * aunque esa franja cierre ya entrada la tarde (p. ej. 13:30 / 14:00).
 */

export const DISPLAY_TIMEZONE = 'America/Argentina/Buenos_Aires'

/** Minutos antes del cierre que el status `near_close` marca (código reutilizable). */
export const NEAR_CLOSE_MINUTES = 60

/**
 * Aviso al registrar un retiro en la última hora de la franja.
 * Desactivado 2026-09-06: esa hora es la del retiro, no la de preparación.
 * El pedido tiene que estar listo para entonces. El status `near_close` sigue
 * calculándose por si se vuelve a usar el aviso.
 */
export const NEAR_CLOSE_WARNING_ENABLED = false

/** Si falta como máximo esto para el retiro pactado, el pedido va arriba. */
export const DUE_SOON_MINUTES = 60

/** Inicio < 14:00 → turno mañana. Inicio ≥ 14:00 → turno tarde. */
export const AFTERNOON_START_CUTOFF_MINUTES = 14 * 60

const MINUTES_PER_DAY = 24 * 60

export interface StoreShiftHours {
  morningStart?: string | null
  morningEnd?: string | null
  afternoonStart?: string | null
  afternoonEnd?: string | null
}

export type ShiftWindowKind = 'morning' | 'afternoon'

export interface OpenShiftWindow {
  kind: ShiftWindowKind
  startMinutes: number
  endMinutes: number
}

export type PickupTimeStatus = 'ok' | 'near_close' | 'closed' | 'no_hours'

export interface PickupTimeCheck {
  status: PickupTimeStatus
  window: ShiftWindowKind | null
}

export type ListTimeSlot = 'dueSoon' | 'morning' | 'afternoon' | 'specific' | 'noSlot'

export const PICKUP_CLOSED_MESSAGE =
  'En ese horario el local está cerrado. Elegí un horario dentro de la franja de atención.'

export const PICKUP_NO_HOURS_MESSAGE =
  'Este local no tiene horarios de atención cargados. Cargalos en Locales antes de usar un horario específico.'

export const PICKUP_NEAR_CLOSE_MESSAGE =
  'Ese horario está a menos de una hora del cierre. No es recomendable aceptar el pedido para esa hora.'

export const PICKUP_SPECIFIC_HINT =
  'Usalo solo si el cliente tiene que retirar a esa hora sí o sí. No es lo mismo que marcar el pedido como prioritario.'

export function timeToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

export function storeHoursFromRecord(
  row: StoreShiftHours | null | undefined,
): StoreShiftHours {
  return {
    morningStart: row?.morningStart ?? null,
    morningEnd: row?.morningEnd ?? null,
    afternoonStart: row?.afternoonStart ?? null,
    afternoonEnd: row?.afternoonEnd ?? null,
  }
}

function windowKindFromStart(startMinutes: number): ShiftWindowKind {
  return startMinutes < AFTERNOON_START_CUTOFF_MINUTES ? 'morning' : 'afternoon'
}

function parseWindow(start: string | null | undefined, end: string | null | undefined): OpenShiftWindow | null {
  if (!start || !end) return null
  const startMinutes = timeToMinutes(start)
  const endMinutes = timeToMinutes(end)
  if (startMinutes == null || endMinutes == null || startMinutes === endMinutes) return null
  return {
    kind: windowKindFromStart(startMinutes),
    startMinutes,
    endMinutes,
  }
}

export function openWindowsFromStoreHours(
  hours: StoreShiftHours | null | undefined,
): OpenShiftWindow[] {
  const windows: OpenShiftWindow[] = []
  const morning = parseWindow(hours?.morningStart, hours?.morningEnd)
  const afternoon = parseWindow(hours?.afternoonStart, hours?.afternoonEnd)
  if (morning) windows.push(morning)
  if (afternoon) windows.push(afternoon)
  windows.sort((a, b) => a.startMinutes - b.startMinutes)
  return windows
}

export function minutesInWindow(now: number, start: number, end: number): boolean {
  if (end >= start) return now >= start && now <= end
  return now >= start || now <= end
}

/** Minutos que faltan para el cierre de esa franja (0 = está en el cierre). */
export function minutesUntilWindowEnd(now: number, start: number, end: number): number {
  if (end >= start) return end - now
  if (now >= start) return MINUTES_PER_DAY - now + end
  return end - now
}

export function checkPickupTime(
  hhmm: string,
  hours: StoreShiftHours | null | undefined,
): PickupTimeCheck {
  const minutes = timeToMinutes(hhmm)
  if (minutes == null) return { status: 'closed', window: null }

  const windows = openWindowsFromStoreHours(hours)
  if (windows.length === 0) return { status: 'no_hours', window: null }

  const hit = windows.find(w => minutesInWindow(minutes, w.startMinutes, w.endMinutes))
  if (!hit) return { status: 'closed', window: null }

  const untilEnd = minutesUntilWindowEnd(minutes, hit.startMinutes, hit.endMinutes)
  if (untilEnd <= NEAR_CLOSE_MINUTES) {
    return { status: 'near_close', window: hit.kind }
  }
  return { status: 'ok', window: hit.kind }
}

export function pickupTimeRegistrationError(check: PickupTimeCheck): string | null {
  if (check.status === 'closed') return PICKUP_CLOSED_MESSAGE
  if (check.status === 'no_hours') return PICKUP_NO_HOURS_MESSAGE
  return null
}

/** Error de horario cerrado / sin franjas, si ya hay hora específica elegida. */
export function pickupHoursLiveError(
  timeSlot: string | null | undefined,
  pickupTime: string | null | undefined,
  hours: StoreShiftHours | null | undefined,
): string | null {
  if (timeSlot !== 'specific' || !pickupTime) return null
  return pickupTimeRegistrationError(checkPickupTime(pickupTime, hours))
}

export function needsNearCloseConfirm(check: PickupTimeCheck): boolean {
  return NEAR_CLOSE_WARNING_ENABLED && check.status === 'near_close'
}

export function clockMinutes(
  now: Date = new Date(),
  timeZone = DISPLAY_TIMEZONE,
): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hh = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const mm = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return hh * 60 + mm
}

export function civilYmd(now: Date = new Date(), timeZone = DISPLAY_TIMEZONE): string {
  return now.toLocaleDateString('en-CA', { timeZone })
}

export function isPickupDueSoon(args: {
  pickupDate: string
  pickupTime: string | null | undefined
  todayYmd: string
  nowMinutes: number
  windowMinutes?: number
}): boolean {
  const { pickupDate, pickupTime, todayYmd, nowMinutes } = args
  const windowMinutes = args.windowMinutes ?? DUE_SOON_MINUTES
  if (!pickupTime || pickupDate !== todayYmd) return false
  const pickupMinutes = timeToMinutes(pickupTime)
  if (pickupMinutes == null) return false
  const until = pickupMinutes - nowMinutes
  return until > 0 && until <= windowMinutes
}

export type OrderSlotFields = {
  timeSlot?: string | null
  pickupTime?: string | null
}

/**
 * Slot de lista: un horario específico se agrupa en mañana/tarde
 * según la franja actual del local. Si ya no cae en ninguna (horarios
 * editados después), queda en "specific" para advertir.
 */
export function effectiveListSlot(
  order: OrderSlotFields,
  hours: StoreShiftHours | null | undefined,
): Exclude<ListTimeSlot, 'dueSoon'> {
  if (order.timeSlot === 'specific' && order.pickupTime) {
    const check = checkPickupTime(order.pickupTime, hours)
    if (check.window === 'morning') return 'morning'
    if (check.window === 'afternoon') return 'afternoon'
    return 'specific'
  }
  if (order.timeSlot === 'morning') return 'morning'
  if (order.timeSlot === 'afternoon') return 'afternoon'
  if (order.timeSlot === 'specific') return 'specific'
  return 'noSlot'
}

export const LIST_SLOT_ORDER: Record<Exclude<ListTimeSlot, 'dueSoon'>, number> = {
  morning: 0,
  afternoon: 1,
  specific: 2,
  noSlot: 3,
}

export function isPickupOutsideCurrentHours(
  order: OrderSlotFields,
  hours: StoreShiftHours | null | undefined,
): boolean {
  if (order.timeSlot !== 'specific' || !order.pickupTime) return false
  return checkPickupTime(order.pickupTime, hours).status === 'closed'
}
