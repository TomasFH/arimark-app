/**
 * Locales activos para que una cajera elija al abrir turno.
 * No se filtra por authorizedStores: pueden operar en cualquiera.
 *
 * Con internet: lee Firestore una vez y cachea en localStorage (para offline).
 * Sin internet: usa el cache; si no hay, cae a authorizedStores del perfil.
 */
import { fetchAllStores } from './adminFirestore'
import type { StoreHoursBlock } from '@carniceria/shared'

const CACHE_KEY = 'carniceria.cashierActiveStores'

export interface CashierStoreOption {
  id: string
  name: string
  morningStart?: string | null
  morningEnd?: string | null
  afternoonStart?: string | null
  afternoonEnd?: string | null
  hoursSchedule?: StoreHoursBlock[] | null
}

function readCache(): CashierStoreOption[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is CashierStoreOption =>
      Boolean(row)
      && typeof row === 'object'
      && typeof (row as { id?: unknown }).id === 'string'
      && typeof (row as { name?: unknown }).name === 'string',
    )
  } catch {
    return []
  }
}

function writeCache(stores: CashierStoreOption[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(stores))
  } catch {
    /* quota / modo privado */
  }
}

function toStoreOption(s: {
  id: string
  name: string
  morningStart?: string | null
  morningEnd?: string | null
  afternoonStart?: string | null
  afternoonEnd?: string | null
  hoursSchedule?: StoreHoursBlock[] | null
}): CashierStoreOption {
  return {
    id: s.id,
    name: s.name.trim() || s.id,
    morningStart: s.morningStart ?? null,
    morningEnd: s.morningEnd ?? null,
    afternoonStart: s.afternoonStart ?? null,
    afternoonEnd: s.afternoonEnd ?? null,
    hoursSchedule: s.hoursSchedule ?? null,
  }
}

export async function loadCashierStoreOptions(
  authorizedFallback: string[],
): Promise<CashierStoreOption[]> {
  try {
    const all = await fetchAllStores()
    const active = all
      .filter(s => !s.archivedAt)
      .map(toStoreOption)
    if (active.length > 0) {
      writeCache(active)
      return active
    }
  } catch {
    /* sin internet o reglas — usar cache */
  }

  const cached = readCache()
  if (cached.length > 0) return cached

  return authorizedFallback.map(id => ({ id, name: id }))
}

function filterAuthorized(
  stores: CashierStoreOption[],
  wanted: Set<string>,
): CashierStoreOption[] {
  return stores
    .filter(s => wanted.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Nombres ya cacheados (cold start, sin esperar Firestore). */
export function peekAuthorizedStoreOptions(
  authorizedIds: string[],
): CashierStoreOption[] {
  const wanted = new Set(authorizedIds.filter(id => id.trim().length > 0))
  if (wanted.size === 0) return []
  return filterAuthorized(readCache(), wanted)
}

/**
 * Locales autorizados con el nombre de Firestore (no el id).
 * Si un id no está en la colección o está archivado, no se lista.
 * Si Firestore falla, usa el cache (mismos nombres que la última vez online).
 */
export async function loadAuthorizedStoreOptions(
  authorizedIds: string[],
): Promise<CashierStoreOption[]> {
  const wanted = new Set(authorizedIds.filter(id => id.trim().length > 0))
  if (wanted.size === 0) return []

  try {
    const all = await fetchAllStores()
    const active = all
      .filter(s => !s.archivedAt)
      .map(toStoreOption)
    if (active.length > 0) writeCache(active)
    const matched = filterAuthorized(active, wanted)
    if (matched.length > 0) return matched
  } catch {
    /* sin internet o reglas — usar cache */
  }

  const cached = peekAuthorizedStoreOptions(authorizedIds)
  if (cached.length > 0) return cached

  throw new Error('No se pudieron cargar los locales.')
}
