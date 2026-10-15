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

/**
 * Lo que falta para vender: PLU (global) o precio de venta en un local donde el producto está disponible.
 * Si en ese local está no disponible, no hay marca.
 */
export function catalogPendingGap(row: {
  pluNumber: number | null
  price: number | null
  available: boolean
}): 'plu' | 'price' | 'both' | null {
  if (!row.available) return null
  const missingPlu = row.pluNumber == null
  const missingPrice = row.price == null
  if (!missingPlu && !missingPrice) return null
  if (missingPlu && missingPrice) return 'both'
  return missingPlu ? 'plu' : 'price'
}

export function catalogPendingLabel(gap: 'plu' | 'price' | 'both' | null): string | null {
  if (gap === 'both') return 'Falta PLU y precio'
  if (gap === 'plu') return 'Falta PLU'
  if (gap === 'price') return 'Falta precio'
  return null
}

/** Los incompletos quedan arriba. El desempate es el orden que ya eligió la pantalla. */
export function compareWithCatalogPending<T>(
  a: T,
  b: T,
  gapOf: (row: T) => 'plu' | 'price' | 'both' | null,
  tie: (a: T, b: T) => number,
): number {
  const ag = gapOf(a) == null ? 1 : 0
  const bg = gapOf(b) == null ? 1 : 0
  if (ag !== bg) return ag - bg
  return tie(a, b)
}

const VISIT_MERCH_MATCH_LIMIT = 8

/**
 * Sugerencias de mercadería en la visita: coincidencia parcial y tope de 8.
 * Sin texto muestra los primeros 8, en el orden recibido.
 * El PLU se compara como substring del texto tipeado.
 */
export function matchVisitMerchProducts<T extends { name: string; pluNumber: number | string | null }>(
  products: readonly T[],
  query: string,
): T[] {
  const pluQuery = query.trim()
  if (!pluQuery) return products.slice(0, VISIT_MERCH_MATCH_LIMIT)
  const nameQuery = normalizeCatalogSearch(pluQuery)
  return products
    .filter(product =>
      (nameQuery.length > 0 && normalizeCatalogSearch(product.name).includes(nameQuery))
      || (product.pluNumber != null && String(product.pluNumber).includes(pluQuery)),
    )
    .slice(0, VISIT_MERCH_MATCH_LIMIT)
}
