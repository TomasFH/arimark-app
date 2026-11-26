import type { ProviderAccountHistory, ProviderDebtEventRow } from '../types/hw-api'

/**
 * El historial nuevo es { openings, events }. Un proceso principal anterior
 * devolvía solo la lista de movimientos. Sin este paso, `for...of account.openings`
 * tira "account.openings is not iterable".
 */
export function normalizeProviderAccount(
  data: ProviderAccountHistory | ProviderDebtEventRow[] | null | undefined,
): ProviderAccountHistory {
  if (Array.isArray(data)) return { openings: [], events: data }
  return {
    openings: Array.isArray(data?.openings) ? data.openings : [],
    events: Array.isArray(data?.events) ? data.events : [],
  }
}
