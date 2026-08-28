/**
 * Caché en memoria de getRemoteSalaryWeek por weekStart (mientras el modal vive).
 */
import type { RemoteSalaryWeek } from '../types/hw-api'
import { weekStartMondayLocalYmd } from './datetime'

const cache = new Map<string, RemoteSalaryWeek>()

export function getSalaryWeekRemoteCache(weekStart: string): RemoteSalaryWeek | undefined {
  return cache.get(weekStart)
}

export function setSalaryWeekRemoteCache(weekStart: string, data: RemoteSalaryWeek): void {
  cache.set(weekStart, data)
}

export function invalidateSalaryWeekRemoteCache(weekStart: string): void {
  cache.delete(weekStart)
}

export function clearSalaryWeekRemoteCache(): void {
  cache.clear()
}

/** Semana actual: siempre refrescar (puede entrar un vale). Pasado: usar caché. */
export function shouldRefetchSalaryWeek(weekStart: string, force: boolean): boolean {
  if (force) return true
  if (weekStart === weekStartMondayLocalYmd()) return true
  return !cache.has(weekStart)
}
