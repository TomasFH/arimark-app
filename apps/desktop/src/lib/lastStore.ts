/**
 * Último local elegido por este usuario en esta PC.
 * Vive en localStorage del renderer (por máquina, no viaja al celu).
 */
const KEY_PREFIX = 'carniceria.lastStore.'

export function lastStoreStorageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`
}

export function readLastStoreId(userId: string): string | null {
  const id = userId.trim()
  if (!id) return null
  try {
    const raw = localStorage.getItem(lastStoreStorageKey(id))
    const trimmed = raw?.trim() ?? ''
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export function writeLastStoreId(userId: string, storeId: string): void {
  const uid = userId.trim()
  const sid = storeId.trim()
  if (!uid || !sid) return
  try {
    localStorage.setItem(lastStoreStorageKey(uid), sid)
  } catch {
    /* quota / private mode */
  }
}

export function preferredStoreIdFrom(
  availableStores: Array<{ id: string }>,
  lastStoreId: string | null,
): string | null {
  if (!lastStoreId) return null
  return availableStores.some(s => s.id === lastStoreId) ? lastStoreId : null
}
