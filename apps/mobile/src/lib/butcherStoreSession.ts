/**
 * Local activo del carnicero.
 *
 * El id se recuerda para preseleccionar. Confirmar "estoy en este local"
 * es por proceso JS (cierre total / kill) y se vence si el día cambió o
 * la app estuvo en segundo plano bastante rato — no en cada minimize.
 */
export const BACKGROUND_RECONFIRM_MS = 2 * 60 * 60 * 1000

const STORE_KEY = 'carniceria.butcherCurrentStore'

let confirmedYmd: string | null = null

export function readPersistedStore(): string | null {
  try { return localStorage.getItem(STORE_KEY) } catch { return null }
}

export function writePersistedStore(id: string): void {
  try { localStorage.setItem(STORE_KEY, id) } catch { /* quota */ }
}

export function clearPersistedStore(): void {
  try { localStorage.removeItem(STORE_KEY) } catch { /* noop */ }
}

export function isStoreSessionConfirmed(todayYmd: string): boolean {
  return confirmedYmd === todayYmd
}

export function markStoreSessionConfirmed(todayYmd: string): void {
  confirmedYmd = todayYmd
}

export function clearStoreSessionConfirmed(): void {
  confirmedYmd = null
}

export function shouldReconfirmStore(args: {
  authorizedCount: number
  todayYmd: string
  hiddenForMs: number
}): boolean {
  if (args.authorizedCount <= 1) return false
  if (!isStoreSessionConfirmed(args.todayYmd)) return true
  return args.hiddenForMs >= BACKGROUND_RECONFIRM_MS
}

export function initialButcherStore(args: {
  authorizedStores: string[]
  persistedId: string | null
  todayYmd: string
}): { storeId: string; showPicker: boolean } {
  const authorized = args.authorizedStores.filter(id => id.trim().length > 0)
  if (authorized.length === 0) return { storeId: '', showPicker: true }

  const persistedOk =
    args.persistedId != null && authorized.includes(args.persistedId)

  if (authorized.length === 1) {
    return {
      storeId: persistedOk ? args.persistedId! : authorized[0]!,
      showPicker: false,
    }
  }

  if (isStoreSessionConfirmed(args.todayYmd) && persistedOk) {
    return { storeId: args.persistedId!, showPicker: false }
  }

  return { storeId: '', showPicker: true }
}

/** Nunca mostrar el id crudo en el encabezado. */
export function displayStoreName(
  option: { id: string; name: string } | undefined,
  loading: boolean,
): string {
  const name = option?.name.trim() ?? ''
  if (name && option && name !== option.id) return name
  if (loading) return 'Cargando…'
  if (name) return name
  return 'Elegí local'
}
