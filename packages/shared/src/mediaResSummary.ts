/**
 * Medias reses del resumen. Se filtra por rubro, no por el formato de la línea:
 * otro rubro puede pesar pieza por pieza y no ser media res.
 */
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'
import { WEEKDAY_SHORT_LABELS, WEEKDAY_UI_ORDER, weekdayFromYmd } from './storeHours'
import type { Weekday } from './storeHours'

export const MEDIA_RES_RUBRO_ID = 'rubro_media_res'

export interface MediaResLineInput {
  rubroId: string
  count: number
  netKg: number | null
  weightsKg: number[]
}

export interface MediaResIntakeInput {
  id: string
  createdAt: string
  providerName: string | null
  receivedByName: string
  lines: MediaResLineInput[]
}

export interface MediaResPiece {
  kg: number
}

export interface MediaResVisit {
  id: string
  createdAt: string
  ymd: string
  providerName: string
  receivedByName: string
  pieces: MediaResPiece[]
  count: number
  kg: number
}

export interface MediaResDay {
  ymd: string
  count: number
  kg: number
  visits: MediaResVisit[]
}

export interface MediaResWeekdayBar {
  weekday: Weekday
  label: string
  count: number
  kg: number
}

function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000
}

function linePieces(line: MediaResLineInput): { pieces: MediaResPiece[]; count: number; kg: number } {
  const weights = line.weightsKg.filter(weight => Number.isFinite(weight) && weight > 0)
  if (weights.length > 0) {
    const pieces = weights.map(kg => ({ kg: roundKg(kg) }))
    const kg = roundKg(pieces.reduce((sum, piece) => sum + piece.kg, 0))
    return { pieces, count: pieces.length, kg }
  }
  const count = Number.isFinite(line.count) && line.count > 0 ? Math.round(line.count) : 0
  const kg = line.netKg != null && Number.isFinite(line.netKg) && line.netKg > 0 ? roundKg(line.netKg) : 0
  if (count === 0 && kg === 0) return { pieces: [], count: 0, kg: 0 }
  const pieces = kg > 0 && count <= 1 ? [{ kg }] : []
  return { pieces, count: count > 0 ? count : pieces.length, kg }
}

export function mediaResVisits(
  intakes: MediaResIntakeInput[],
  timeZone = DISPLAY_TIMEZONE,
): MediaResVisit[] {
  const visits: MediaResVisit[] = []
  for (const intake of intakes) {
    const pieces: MediaResPiece[] = []
    let count = 0
    let kg = 0
    for (const line of intake.lines) {
      if (line.rubroId !== MEDIA_RES_RUBRO_ID) continue
      const part = linePieces(line)
      pieces.push(...part.pieces)
      count += part.count
      kg = roundKg(kg + part.kg)
    }
    if (count === 0 && kg === 0) continue
    visits.push({
      id: intake.id,
      createdAt: intake.createdAt,
      ymd: civilYmd(new Date(intake.createdAt), timeZone),
      providerName: intake.providerName?.trim() || 'Sin proveedor',
      receivedByName: intake.receivedByName.trim() || 'Sin nombre',
      pieces,
      count,
      kg,
    })
  }
  visits.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return visits
}

export function filterMediaResProvider(visits: MediaResVisit[], provider: string | null): MediaResVisit[] {
  if (!provider) return visits
  return visits.filter(visit => visit.providerName === provider)
}

export function mediaResProviders(visits: MediaResVisit[]): string[] {
  return [...new Set(visits.map(visit => visit.providerName))].sort((a, b) => a.localeCompare(b, 'es'))
}

export function groupMediaResByDay(visits: MediaResVisit[]): MediaResDay[] {
  const byDay = new Map<string, MediaResDay>()
  for (const visit of visits) {
    const day = byDay.get(visit.ymd) ?? { ymd: visit.ymd, count: 0, kg: 0, visits: [] }
    day.visits.push(visit)
    day.count += visit.count
    day.kg = roundKg(day.kg + visit.kg)
    byDay.set(visit.ymd, day)
  }
  return [...byDay.values()].sort((a, b) => a.ymd.localeCompare(b.ymd))
}

/**
 * Kilos por pieza que tiene kilo (las que arma linePieces).
 * Si no hay ninguna, no hay promedio.
 */
export function mediaResAverageKg(visits: MediaResVisit[]): number | null {
  let pieces = 0
  let kg = 0
  for (const visit of visits) {
    for (const piece of visit.pieces) {
      pieces += 1
      kg += piece.kg
    }
  }
  if (pieces === 0) return null
  return roundKg(kg / pieces)
}

export function mediaResTotals(visits: MediaResVisit[]): { count: number; kg: number } {
  return visits.reduce(
    (acc, visit) => ({ count: acc.count + visit.count, kg: roundKg(acc.kg + visit.kg) }),
    { count: 0, kg: 0 },
  )
}

/** Siete barras, lunes a domingo. En el mes, los lunes se suman entre sí. */
export function mediaResWeekdayBars(visits: MediaResVisit[]): MediaResWeekdayBar[] {
  const buckets = new Map<Weekday, { count: number; kg: number }>()
  for (const weekday of WEEKDAY_UI_ORDER) buckets.set(weekday, { count: 0, kg: 0 })
  for (const visit of visits) {
    const weekday = weekdayFromYmd(visit.ymd)
    const bucket = buckets.get(weekday) ?? { count: 0, kg: 0 }
    bucket.count += visit.count
    bucket.kg = roundKg(bucket.kg + visit.kg)
    buckets.set(weekday, bucket)
  }
  return WEEKDAY_UI_ORDER.map(weekday => {
    const bucket = buckets.get(weekday) ?? { count: 0, kg: 0 }
    return { weekday, label: WEEKDAY_SHORT_LABELS[weekday], count: bucket.count, kg: bucket.kg }
  })
}

export function onCivilDay(iso: string, ymd: string, timeZone = DISPLAY_TIMEZONE): boolean {
  return civilYmd(new Date(iso), timeZone) === ymd
}
