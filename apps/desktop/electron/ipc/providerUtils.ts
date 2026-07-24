/**
 * Utilidades compartidas de proveedor.
 * Usadas por providerSync, providers.handler y expense.handler.
 */

/**
 * Calcula el ID determinístico de un proveedor a partir de su nombre.
 *
 * Algoritmo: lower(hex(nameKey)) donde nameKey = lower(trim(name)).
 * Equivalente a la expresión SQLite de la migración 0015, por lo que
 * los backfills de BD y la creación desde código convergen al mismo ID.
 *
 * Esto garantiza dedup offline sin coordinación entre PCs:
 * si dos locales crean "Oso" sin conexión, ambos obtienen el mismo id.
 */
export function providerIdFromName(name: string): string {
  const nameKey = name.toLowerCase().trim()
  return Buffer.from(nameKey, 'utf8').toString('hex')
}

/**
 * Devuelve el nameKey normalizado a partir de un nombre de display.
 */
export function providerNameKey(name: string): string {
  return name.toLowerCase().trim()
}
