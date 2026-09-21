import { namesMatch } from '@carniceria/shared'

/** Autocomplete: si el texto es exactamente una opción, esa queda elegida y la lista se oculta. */
export function namedSuggest<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): { exact: T | undefined; listed: T[] } {
  const exact = items.find(item => namesMatch(nameOf(item), query))
  if (exact !== undefined) return { exact, listed: [] }
  const q = query.trim().toLowerCase()
  if (!q) return { exact: undefined, listed: [...items] }
  return {
    exact: undefined,
    listed: items.filter(item => nameOf(item).toLowerCase().includes(q)),
  }
}
