/**
 * Horarios de atención por grupos de días.
 *
 * Un local puede tener varios bloques: cada bloque lista los días que
 * comparten las mismas franjas (mañana y, si hay, tarde). Un día solo
 * puede estar en un bloque. Un día sin bloque está cerrado.
 *
 * Sin hoursSchedule (locales viejos): los cuatro campos de mañana/tarde
 * valen los 7 días.
 */

import {
  checkPickupTime,
  openWindowsFromStoreHours,
  pickupHoursLiveError,
  pickupTimeRegistrationError,
  storeHoursFromRecord,
  timeToMinutes,
  type PickupTimeCheck,
  type StoreShiftHours,
} from './pickupHours'

/** getUTCDay(): 0 domingo … 6 sábado. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface StoreHoursBlock {
  days: Weekday[]
  morningStart: string | null
  morningEnd: string | null
  afternoonStart: string | null
  afternoonEnd: string | null
}

export interface StoreHoursSource extends StoreShiftHours {
  hoursSchedule?: StoreHoursBlock[] | string | null
}

export const ALL_WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

/** Lun → Dom, para chips y resúmenes. */
export const WEEKDAY_UI_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
}

export const SHIFT_HOURS_OVERLAP_MESSAGE =
  'Los turnos de mañana y tarde se pisan. Dejá un solo turno corrido o separalos.'

export const SHIFT_HOURS_INVERTED_MESSAGE =
  'La hora de cierre tiene que ser después de la de apertura.'

export const SHIFT_HOURS_INCOMPLETE_MESSAGE =
  'Completá el inicio y el cierre de cada turno que cargues.'

export const WEEK_SCHEDULE_DUPLICATE_DAY_MESSAGE =
  'Un mismo día no puede estar en dos horarios distintos.'

export const WEEK_SCHEDULE_DAYS_WITHOUT_HOURS_MESSAGE =
  'Completá el horario de ese grupo de días, o desmarcá los días.'

export const WEEK_SCHEDULE_HOURS_WITHOUT_DAYS_MESSAGE =
  'Marcá al menos un día para ese horario.'

const EMPTY_HOURS: StoreShiftHours = {
  morningStart: null,
  morningEnd: null,
  afternoonStart: null,
  afternoonEnd: null,
}

export function emptyHoursBlock(days: Weekday[] = []): StoreHoursBlock {
  return {
    days: [...days],
    morningStart: null,
    morningEnd: null,
    afternoonStart: null,
    afternoonEnd: null,
  }
}

export function isWeekday(value: unknown): value is Weekday {
  return value === 0 || value === 1 || value === 2 || value === 3
    || value === 4 || value === 5 || value === 6
}

function nullHhmm(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function blockHours(
  block: Pick<StoreHoursBlock, 'morningStart' | 'morningEnd' | 'afternoonStart' | 'afternoonEnd'> | StoreShiftHours,
): Omit<StoreHoursBlock, 'days'> {
  return {
    morningStart: nullHhmm(block.morningStart),
    morningEnd: nullHhmm(block.morningEnd),
    afternoonStart: nullHhmm(block.afternoonStart),
    afternoonEnd: nullHhmm(block.afternoonEnd),
  }
}

function uniqueSortedDays(days: Weekday[]): Weekday[] {
  return [...new Set(days.filter(isWeekday))].sort((a, b) => a - b) as Weekday[]
}

export function weekdayFromYmd(ymd: string): Weekday {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return 0
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  // Mediodía UTC: en America/Argentina (UTC−3) sigue siendo el mismo día civil.
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return date.getUTCDay() as Weekday
}

function isCompletePair(start: string | null | undefined, end: string | null | undefined): boolean {
  return Boolean(start && end)
}

function isPartialPair(start: string | null, end: string | null): boolean {
  return Boolean(start) !== Boolean(end)
}

function pairMinutes(start: string, end: string): { start: number; end: number } | null {
  const startMin = timeToMinutes(start)
  const endMin = timeToMinutes(end)
  if (startMin == null || endMin == null) return null
  return { start: startMin, end: endMin }
}

/** true si los intervalos se superponen; tocarse en el extremo no cuenta. */
export function shiftWindowsOverlap(hours: StoreShiftHours): boolean {
  const morning = isCompletePair(hours.morningStart ?? null, hours.morningEnd ?? null)
    ? pairMinutes(hours.morningStart!, hours.morningEnd!)
    : null
  const afternoon = isCompletePair(hours.afternoonStart ?? null, hours.afternoonEnd ?? null)
    ? pairMinutes(hours.afternoonStart!, hours.afternoonEnd!)
    : null
  if (!morning || !afternoon) return false
  if (morning.end <= morning.start || afternoon.end <= afternoon.start) return false
  return morning.start < afternoon.end && afternoon.start < morning.end
}

export function validateShiftHours(hours: StoreShiftHours): string | null {
  const morningStart = nullHhmm(hours.morningStart)
  const morningEnd = nullHhmm(hours.morningEnd)
  const afternoonStart = nullHhmm(hours.afternoonStart)
  const afternoonEnd = nullHhmm(hours.afternoonEnd)

  if (isPartialPair(morningStart, morningEnd) || isPartialPair(afternoonStart, afternoonEnd)) {
    return SHIFT_HOURS_INCOMPLETE_MESSAGE
  }

  if (isCompletePair(morningStart, morningEnd)) {
    const pair = pairMinutes(morningStart!, morningEnd!)
    if (!pair || pair.end <= pair.start) return SHIFT_HOURS_INVERTED_MESSAGE
  }
  if (isCompletePair(afternoonStart, afternoonEnd)) {
    const pair = pairMinutes(afternoonStart!, afternoonEnd!)
    if (!pair || pair.end <= pair.start) return SHIFT_HOURS_INVERTED_MESSAGE
  }

  if (shiftWindowsOverlap({
    morningStart, morningEnd, afternoonStart, afternoonEnd,
  })) {
    return SHIFT_HOURS_OVERLAP_MESSAGE
  }

  return null
}

function hasConfiguredWindow(hours: StoreShiftHours): boolean {
  return isCompletePair(nullHhmm(hours.morningStart), nullHhmm(hours.morningEnd))
    || isCompletePair(nullHhmm(hours.afternoonStart), nullHhmm(hours.afternoonEnd))
}

export function normalizeWeekSchedule(blocks: StoreHoursBlock[]): StoreHoursBlock[] {
  return blocks
    .map(block => ({
      days: uniqueSortedDays(block.days),
      ...blockHours(block),
    }))
    .filter(block => block.days.length > 0 || hasConfiguredWindow(block))
}

export function parseHoursSchedule(raw: unknown): StoreHoursBlock[] | null {
  if (raw == null || raw === '') return null
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (!Array.isArray(value)) return null
  const blocks: StoreHoursBlock[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null
    const rec = item as {
      days?: unknown
      morningStart?: unknown
      morningEnd?: unknown
      afternoonStart?: unknown
      afternoonEnd?: unknown
    }
    if (!Array.isArray(rec.days) || !rec.days.every(isWeekday)) return null
    const hhmm = (field: unknown): string | null | undefined => {
      if (field == null || field === '') return null
      if (typeof field !== 'string') return undefined
      if (timeToMinutes(field) == null) return undefined
      return field
    }
    const morningStart = hhmm(rec.morningStart)
    const morningEnd = hhmm(rec.morningEnd)
    const afternoonStart = hhmm(rec.afternoonStart)
    const afternoonEnd = hhmm(rec.afternoonEnd)
    if (
      morningStart === undefined || morningEnd === undefined
      || afternoonStart === undefined || afternoonEnd === undefined
    ) {
      return null
    }
    blocks.push({
      days: uniqueSortedDays(rec.days),
      morningStart,
      morningEnd,
      afternoonStart,
      afternoonEnd,
    })
  }
  return blocks
}

export function serializeHoursSchedule(blocks: StoreHoursBlock[] | null | undefined): string | null {
  const normalized = normalizeWeekSchedule(blocks ?? [])
    .filter(block => block.days.length > 0)
  if (normalized.length === 0) return null
  return JSON.stringify(normalized)
}

export function validateWeekSchedule(blocks: StoreHoursBlock[]): string | null {
  const normalized = normalizeWeekSchedule(blocks)
  const anyHours = normalized.some(b => hasConfiguredWindow(b))
  if (!anyHours) return null

  const seen = new Set<Weekday>()
  for (const block of normalized) {
    for (const day of block.days) {
      if (seen.has(day)) return WEEK_SCHEDULE_DUPLICATE_DAY_MESSAGE
      seen.add(day)
    }
    const hasDays = block.days.length > 0
    const hasHours = hasConfiguredWindow(block)
    if (hasDays && !hasHours) return WEEK_SCHEDULE_DAYS_WITHOUT_HOURS_MESSAGE
    if (!hasDays && hasHours) return WEEK_SCHEDULE_HOURS_WITHOUT_DAYS_MESSAGE
    const hoursError = validateShiftHours(blockHours(block))
    if (hoursError) return hoursError
  }
  return null
}

/** Los 4 campos legacy: el bloque del lunes, o el que más días cubre. */
export function legacyHoursFromSchedule(blocks: StoreHoursBlock[]): StoreShiftHours {
  const withDays = normalizeWeekSchedule(blocks).filter(b => b.days.length > 0)
  if (withDays.length === 0) return { ...EMPTY_HOURS }
  const monday = withDays.find(b => b.days.includes(1))
  const picked = monday ?? [...withDays].sort((a, b) => b.days.length - a.days.length)[0]
  if (!picked) return { ...EMPTY_HOURS }
  return blockHours(picked)
}

export function hoursFieldsForSave(blocks: StoreHoursBlock[]): StoreShiftHours & {
  hoursSchedule: StoreHoursBlock[]
} {
  const hoursSchedule = normalizeWeekSchedule(blocks)
    .filter(b => b.days.length > 0 && hasConfiguredWindow(b))
  return {
    hoursSchedule,
    ...legacyHoursFromSchedule(hoursSchedule),
  }
}

export function storeHasAnyHours(source: StoreHoursSource | null | undefined): boolean {
  const schedule = parseHoursSchedule(source?.hoursSchedule)
  if (schedule && schedule.length > 0) {
    return schedule.some(b => b.days.length > 0 && hasConfiguredWindow(b))
  }
  return openWindowsFromStoreHours(storeHoursFromRecord(source)).length > 0
}

export function storeHoursSourceFromRecord(
  row: StoreHoursSource | null | undefined,
): StoreHoursSource {
  return {
    ...storeHoursFromRecord(row),
    hoursSchedule: parseHoursSchedule(row?.hoursSchedule) ?? row?.hoursSchedule ?? null,
  }
}

/**
 * Franjas vigentes ese día civil.
 * Con schedule: día ausente = cerrado (vacío).
 * Sin schedule: los 4 campos para cualquier día.
 */
export function hoursForDate(
  source: StoreHoursSource | null | undefined,
  ymd: string,
): StoreShiftHours {
  const schedule = parseHoursSchedule(source?.hoursSchedule)
  if (schedule && schedule.length > 0) {
    const day = weekdayFromYmd(ymd)
    const block = schedule.find(b => b.days.includes(day))
    if (!block) return { ...EMPTY_HOURS }
    return blockHours(block)
  }
  return storeHoursFromRecord(source)
}

export const PICKUP_NO_AFTERNOON_MESSAGE = 'Ese día no hay turno tarde.'
export const PICKUP_NO_MORNING_MESSAGE = 'Ese día no hay turno mañana.'

export function pickupSlotAvailability(
  source: StoreHoursSource | null | undefined,
  ymd: string,
): { morning: boolean; afternoon: boolean } {
  if (!ymd || !storeHasAnyHours(source)) {
    return { morning: true, afternoon: true }
  }
  const hours = hoursForDate(source, ymd)
  return {
    morning: Boolean(hours.morningStart && hours.morningEnd),
    afternoon: Boolean(hours.afternoonStart && hours.afternoonEnd),
  }
}

export function pickupSlotRegistrationError(
  timeSlot: string | null | undefined,
  source: StoreHoursSource | null | undefined,
  ymd: string,
): string | null {
  if (timeSlot !== 'morning' && timeSlot !== 'afternoon') return null
  const available = pickupSlotAvailability(source, ymd)
  if (timeSlot === 'morning' && !available.morning) return PICKUP_NO_MORNING_MESSAGE
  if (timeSlot === 'afternoon' && !available.afternoon) return PICKUP_NO_AFTERNOON_MESSAGE
  return null
}

export function checkPickupTimeOnDate(
  hhmm: string,
  source: StoreHoursSource | null | undefined,
  ymd: string,
): PickupTimeCheck {
  const hours = hoursForDate(source, ymd)
  const check = checkPickupTime(hhmm, hours)
  if (check.status === 'no_hours' && storeHasAnyHours(source)) {
    return { status: 'closed', window: null }
  }
  return check
}

export function pickupHoursLiveErrorOnDate(
  timeSlot: string | null | undefined,
  pickupTime: string | null | undefined,
  source: StoreHoursSource | null | undefined,
  ymd: string,
): string | null {
  if (timeSlot !== 'specific' || !pickupTime) return null
  if (!ymd) return pickupHoursLiveError(timeSlot, pickupTime, hoursForDate(source, ymd))
  return pickupTimeRegistrationError(checkPickupTimeOnDate(pickupTime, source, ymd))
}

export function isPickupOutsideHoursOnDate(
  order: { timeSlot?: string | null; pickupTime?: string | null; pickupDate?: string | null },
  source: StoreHoursSource | null | undefined,
): boolean {
  if (order.timeSlot !== 'specific' || !order.pickupTime) return false
  if (!order.pickupDate) {
    return checkPickupTime(order.pickupTime, storeHoursFromRecord(source)).status === 'closed'
  }
  return checkPickupTimeOnDate(order.pickupTime, source, order.pickupDate).status === 'closed'
}

export function editorScheduleFromStore(
  source: StoreHoursSource | null | undefined,
): StoreHoursBlock[] {
  const parsed = parseHoursSchedule(source?.hoursSchedule)
  if (parsed && parsed.some(b => b.days.length > 0)) {
    return parsed.map(b => ({
      days: [...b.days],
      ...blockHours(b),
    }))
  }
  const legacy = storeHoursFromRecord(source)
  if (hasConfiguredWindow(legacy) || isPartialPair(nullHhmm(legacy.morningStart), nullHhmm(legacy.morningEnd))
    || isPartialPair(nullHhmm(legacy.afternoonStart), nullHhmm(legacy.afternoonEnd))) {
    return [{
      days: [...ALL_WEEKDAYS],
      morningStart: nullHhmm(legacy.morningStart),
      morningEnd: nullHhmm(legacy.morningEnd),
      afternoonStart: nullHhmm(legacy.afternoonStart),
      afternoonEnd: nullHhmm(legacy.afternoonEnd),
    }]
  }
  return [emptyHoursBlock([...ALL_WEEKDAYS])]
}

export function toggleDayInSchedule(
  schedule: StoreHoursBlock[],
  blockIndex: number,
  day: Weekday,
): StoreHoursBlock[] {
  if (!schedule[blockIndex]) return schedule
  return schedule.map((block, i) => {
    const without = block.days.filter(d => d !== day)
    if (i !== blockIndex) return { ...block, days: without }
    const already = block.days.includes(day)
    return {
      ...block,
      days: already ? without : uniqueSortedDays([...without, day]),
    }
  })
}

export function addHoursBlock(schedule: StoreHoursBlock[]): StoreHoursBlock[] {
  return [...schedule, emptyHoursBlock()]
}

export function removeHoursBlock(
  schedule: StoreHoursBlock[],
  blockIndex: number,
): StoreHoursBlock[] {
  if (schedule.length <= 1) return [emptyHoursBlock([...ALL_WEEKDAYS])]
  return schedule.filter((_, i) => i !== blockIndex)
}

export function updateHoursBlock(
  schedule: StoreHoursBlock[],
  blockIndex: number,
  patch: Partial<Pick<StoreHoursBlock, 'morningStart' | 'morningEnd' | 'afternoonStart' | 'afternoonEnd'>>,
): StoreHoursBlock[] {
  return schedule.map((block, i) => {
    if (i !== blockIndex) return block
    return {
      ...block,
      morningStart: patch.morningStart !== undefined ? nullHhmm(patch.morningStart) : block.morningStart,
      morningEnd: patch.morningEnd !== undefined ? nullHhmm(patch.morningEnd) : block.morningEnd,
      afternoonStart: patch.afternoonStart !== undefined ? nullHhmm(patch.afternoonStart) : block.afternoonStart,
      afternoonEnd: patch.afternoonEnd !== undefined ? nullHhmm(patch.afternoonEnd) : block.afternoonEnd,
    }
  })
}

function formatDayRanges(days: Weekday[]): string {
  const ordered = WEEKDAY_UI_ORDER.filter(d => days.includes(d))
  if (ordered.length === 0) return ''
  const ranges: string[] = []
  let start = ordered[0]!
  let prev = ordered[0]!
  const flush = (from: Weekday, to: Weekday) => {
    if (from === to) ranges.push(WEEKDAY_SHORT_LABELS[from])
    else ranges.push(`${WEEKDAY_SHORT_LABELS[from]}–${WEEKDAY_SHORT_LABELS[to]}`)
  }
  for (let i = 1; i < ordered.length; i++) {
    const day = ordered[i]!
    const prevIdx = WEEKDAY_UI_ORDER.indexOf(prev)
    const dayIdx = WEEKDAY_UI_ORDER.indexOf(day)
    if (dayIdx === prevIdx + 1) {
      prev = day
      continue
    }
    flush(start, prev)
    start = day
    prev = day
  }
  flush(start, prev)
  return ranges.join(', ')
}

function formatBlockHours(block: StoreHoursBlock): string {
  const hours = blockHours(block)
  const parts: string[] = []
  if (isCompletePair(hours.morningStart, hours.morningEnd)) {
    parts.push(`${hours.morningStart}–${hours.morningEnd}`)
  }
  if (isCompletePair(hours.afternoonStart, hours.afternoonEnd)) {
    parts.push(`${hours.afternoonStart}–${hours.afternoonEnd}`)
  }
  return parts.join(' / ')
}

export function formatWeekScheduleSummary(source: StoreHoursSource | null | undefined): string {
  const parsed = parseHoursSchedule(source?.hoursSchedule)
  const blocks: StoreHoursBlock[] = parsed && parsed.some(b => b.days.length > 0)
    ? parsed.filter(b => b.days.length > 0)
    : hasConfiguredWindow(storeHoursFromRecord(source))
      ? [{ days: [...ALL_WEEKDAYS], ...blockHours(storeHoursFromRecord(source)) }]
      : []
  if (blocks.length === 0) return ''
  return blocks
    .map(b => {
      const days = formatDayRanges(b.days)
      const hours = formatBlockHours(b)
      return hours ? `${days} ${hours}` : days
    })
    .join(' · ')
}
