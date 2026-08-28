/**
 * Caché de una semana de liquidación en memoria (sesión de la pantalla).
 * No es el historial entero: 1 entrada por weekStart visitado.
 */
import type { PayrollPayment, PayrollVale } from './payroll'

export interface PayrollWeekCacheEntry {
  weekStart: string
  vales: PayrollVale[]
  payments: PayrollPayment[]
}

const cache = new Map<string, PayrollWeekCacheEntry>()

export function getPayrollWeekCache(weekStart: string): PayrollWeekCacheEntry | undefined {
  return cache.get(weekStart)
}

export function setPayrollWeekCache(entry: PayrollWeekCacheEntry): void {
  cache.set(entry.weekStart, entry)
}

export function invalidatePayrollWeekCache(weekStart: string): void {
  cache.delete(weekStart)
}

export function clearPayrollWeekCache(): void {
  cache.clear()
}

/**
 * Qué pintar para `weekStart` en este frame.
 *
 * Si React todavía tiene los vales de la semana anterior (`dataWeekStart`
 * distinto), no hay que usarlos: se filtran a la semana nueva, las tarjetas
 * salen chicas y al llegar la caché se agrandan (parpadeo).
 * Reusar en otras listas: no mezclar filtro de pantalla con datos de otra clave.
 */
export function resolveWeekView(
  weekStart: string,
  dataWeekStart: string | null,
  liveVales: PayrollVale[],
  livePayments: PayrollPayment[],
): { vales: PayrollVale[]; payments: PayrollPayment[]; waiting: boolean } {
  if (dataWeekStart === weekStart) {
    return { vales: liveVales, payments: livePayments, waiting: false }
  }
  const cached = cache.get(weekStart)
  if (cached) {
    return { vales: cached.vales, payments: cached.payments, waiting: false }
  }
  return { vales: [], payments: [], waiting: true }
}

/**
 * Cómo pedir esa semana:
 * - cache-only: ya la vimos (pasado) — no tocar Firebase
 * - cache-then-live: semana actual, mostrar lo guardado y seguir escuchando
 * - fetch-once: pasado sin caché — getDocs de esa semana y guardar
 * - live: semana actual sin caché — onSnapshot recortado
 */
export function weekQueryPlan(
  weekStart: string,
  currentWeekStart: string,
  hasCache: boolean,
  forceRefresh: boolean,
): 'cache-only' | 'cache-then-live' | 'fetch-once' | 'live' {
  const isCurrent = weekStart === currentWeekStart
  if (forceRefresh) return isCurrent ? 'live' : 'fetch-once'
  if (isCurrent) return hasCache ? 'cache-then-live' : 'live'
  return hasCache ? 'cache-only' : 'fetch-once'
}
