/**
 * Pollo en cajones del resumen. Se decide por renglón, no por la visita:
 * una visita mixta puede tener un renglón de pollo y otros que no lo son.
 */
import { merchNameKey } from './merchIntake'
import { civilYmd, DISPLAY_TIMEZONE } from './pickupHours'

export const CHICKEN_FACTORY_RUBRO_ID = 'rubro_pollo_entero'

export interface ChickenLineInput {
  rubroId: string
  rubroName: string
  nameKey?: string | null
  costUnit?: string | null
  packCount?: number | null
  count?: number | null
  netKg?: number | null
  grossKg?: number | null
  weightsKg?: number[] | null
}

export interface ChickenIntakeInput {
  id: string
  createdAt: string
  providerName: string | null
  receivedByName: string
  storeName?: string | null
  lines: ChickenLineInput[]
}

export interface ChickenVisit {
  id: string
  createdAt: string
  ymd: string
  providerName: string
  receivedByName: string
  storeName: string | null
  crates: number
  grossKg: number
  crateKg: number[]
}

export interface ChickenDay {
  ymd: string
  crates: number
  grossKg: number
  visits: ChickenVisit[]
}

function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000
}

function lineNameKey(line: ChickenLineInput): string {
  const stored = line.nameKey?.trim()
  if (stored) return merchNameKey(stored)
  return merchNameKey(line.rubroName)
}

function mentionsPollo(key: string): boolean {
  return key === 'pollo' || key.includes('pollo')
}

function measuredInCrates(line: ChickenLineInput): boolean {
  if (line.costUnit === 'pack') return true
  return typeof line.packCount === 'number' && Number.isFinite(line.packCount) && line.packCount > 0
}

/** Renglón de pollo medido en cajones. Un corte por kilo, aunque diga pollo, no. */
export function isChickenCrateLine(line: ChickenLineInput): boolean {
  if (line.rubroId === CHICKEN_FACTORY_RUBRO_ID) return true
  return mentionsPollo(lineNameKey(line)) && measuredInCrates(line)
}

function positiveWeights(line: ChickenLineInput): number[] {
  return (line.weightsKg ?? []).filter(weight => Number.isFinite(weight) && weight > 0).map(roundKg)
}

function lineGross(line: ChickenLineInput): { grossKg: number; crateKg: number[] } {
  const weights = positiveWeights(line)
  if (weights.length > 0) {
    return {
      grossKg: roundKg(weights.reduce((sum, kg) => sum + kg, 0)),
      crateKg: weights,
    }
  }
  const gross = line.grossKg
  const net = line.netKg
  const kg = gross != null && Number.isFinite(gross) && gross > 0
    ? roundKg(gross)
    : net != null && Number.isFinite(net) && net > 0
      ? roundKg(net)
      : 0
  return { grossKg: kg, crateKg: [] }
}

function lineCrates(line: ChickenLineInput): number {
  if (typeof line.packCount === 'number' && Number.isFinite(line.packCount) && line.packCount > 0) {
    return Math.round(line.packCount)
  }
  if (typeof line.count === 'number' && Number.isFinite(line.count) && line.count > 0) {
    return Math.round(line.count)
  }
  return positiveWeights(line).length
}

export function chickenVisits(
  intakes: ChickenIntakeInput[],
  timeZone = DISPLAY_TIMEZONE,
): ChickenVisit[] {
  const visits: ChickenVisit[] = []
  for (const intake of intakes) {
    let crates = 0
    let grossKg = 0
    const crateKg: number[] = []
    for (const line of intake.lines) {
      if (!isChickenCrateLine(line)) continue
      const part = lineGross(line)
      crates += lineCrates(line)
      grossKg = roundKg(grossKg + part.grossKg)
      crateKg.push(...part.crateKg)
    }
    if (crates === 0 && grossKg === 0) continue
    visits.push({
      id: intake.id,
      createdAt: intake.createdAt,
      ymd: civilYmd(new Date(intake.createdAt), timeZone),
      providerName: intake.providerName?.trim() || 'Sin proveedor',
      receivedByName: intake.receivedByName.trim() || 'Sin nombre',
      storeName: intake.storeName?.trim() || null,
      crates,
      grossKg,
      crateKg,
    })
  }
  visits.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return visits
}

export function chickenTotals(visits: ChickenVisit[]): { crates: number; grossKg: number } {
  let crates = 0
  let grossKg = 0
  for (const visit of visits) {
    crates += visit.crates
    grossKg = roundKg(grossKg + visit.grossKg)
  }
  return { crates, grossKg }
}

export function groupChickenByDay(visits: ChickenVisit[]): ChickenDay[] {
  const byDay = new Map<string, ChickenDay>()
  for (const visit of visits) {
    const day = byDay.get(visit.ymd) ?? { ymd: visit.ymd, crates: 0, grossKg: 0, visits: [] }
    day.visits.push(visit)
    day.crates += visit.crates
    day.grossKg = roundKg(day.grossKg + visit.grossKg)
    byDay.set(visit.ymd, day)
  }
  return [...byDay.values()].sort((a, b) => a.ymd.localeCompare(b.ymd))
}
