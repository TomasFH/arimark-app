/**
 * Locales activos para que una cajera elija al abrir turno.
 * No se filtra por authorizedStores: pueden operar en cualquiera.
 *
 * Con internet: lee Firestore una vez y cachea en localStorage (para offline).
 * Sin internet: usa el cache; si no hay, cae a authorizedStores del perfil.
 */
import { fetchAllStores } from './adminFirestore'

const CACHE_KEY = 'carniceria.cashierActiveStores'

export interface CashierStoreOption {
  id: string
  name: string
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

export async function loadCashierStoreOptions(
  authorizedFallback: string[],
): Promise<CashierStoreOption[]> {
  try {
    const all = await fetchAllStores()
    const active = all
      .filter(s => !s.archivedAt)
      .map(s => ({ id: s.id, name: s.name.trim() || s.id }))
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
