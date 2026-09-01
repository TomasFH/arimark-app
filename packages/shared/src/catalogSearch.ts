/**
 * Búsqueda de catálogo para typeahead (POS, vales, entrada manual).
 * Exacto / prefijo primero; sin tope de cantidad (la lista scrollea).
 */

export function normalizeCatalogSearch(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function nameRank(normalizedName: string, normalizedQuery: string): number | null {
  if (normalizedName === normalizedQuery) return 0
  if (normalizedName.startsWith(normalizedQuery)) return 1
  if (normalizedName.includes(normalizedQuery)) return 2
  return null
}

export function filterAndRankByName<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  const q = normalizeCatalogSearch(query)
  if (!q) return [...items]

  const scored: Array<{ item: T; rank: number; len: number; name: string }> = []
  for (const item of items) {
    const name = nameOf(item)
    const n = normalizeCatalogSearch(name)
    const rank = nameRank(n, q)
    if (rank === null) continue
    scored.push({ item, rank, len: n.length, name })
  }
  scored.sort((a, b) => a.rank - b.rank || a.len - b.len || a.name.localeCompare(b.name, 'es'))
  return scored.map(s => s.item)
}

/** Dígitos → PLU; texto → nombre (exacto, luego empieza con, luego contiene). */
export function searchProductsByQuery<T>(
  items: readonly T[],
  query: string,
  opts: { nameOf: (item: T) => string; pluOf: (item: T) => number },
): T[] {
  const raw = query.trim()
  if (!raw) return []
  const digits = raw.replace(/\./g, '')
  if (/^\d+$/.test(digits)) {
    return [...items]
      .filter(item => String(opts.pluOf(item)).startsWith(digits))
      .sort((a, b) => opts.pluOf(a) - opts.pluOf(b))
  }
  return filterAndRankByName(items, raw, opts.nameOf)
}
