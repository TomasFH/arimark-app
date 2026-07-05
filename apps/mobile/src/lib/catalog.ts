/**
 * Gestión del catálogo de productos en el celular.
 *
 * El catálogo se descarga de Firestore al loguear (si hay internet) y se
 * cachea en IndexedDB. El POS usa siempre el cache local, de modo que
 * funciona sin conexión una vez descargado.
 *
 * Ruta en Firestore: licenses/{licenseKey}/catalog/{storeId}
 */
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { db } from './db'
import type { CatalogProduct } from '../types/pos'

const firestore = getFirestore(firebaseApp)

/**
 * Descarga el catálogo del local desde Firestore y lo guarda en IndexedDB.
 * Si falla la descarga, el cache existente sigue siendo válido.
 */
export async function syncCatalog(storeId: string): Promise<void> {
  try {
    const catalogRef = doc(firestore, 'licenses', LICENSE_KEY, 'catalog', storeId)
    const snap = await getDoc(catalogRef)
    if (!snap.exists()) return

    const data = snap.data()
    await db.catalog.put({
      storeId,
      products: data['products'] as CatalogProduct[],
      updatedAt: data['updatedAt'] as string,
    })
  } catch {
    // Sin internet o error transitorio — el cache sigue siendo válido.
  }
}

/** Retorna el catálogo cacheado para el local dado. Vacío si no hay cache. */
export async function getCatalog(storeId: string): Promise<CatalogProduct[]> {
  const record = await db.catalog.get(storeId)
  return record?.products ?? []
}

/** Busca un producto por PLU en el catálogo local. */
export function findByPlu(
  catalog: CatalogProduct[],
  pluNumber: number
): CatalogProduct | undefined {
  return catalog.find(p => p.pluNumber === pluNumber)
}

/** Búsqueda por nombre (normaliza tildes y mayúsculas). */
export function searchCatalog(
  catalog: CatalogProduct[],
  query: string
): CatalogProduct[] {
  const q = normalize(query)
  return catalog.filter(
    p =>
      normalize(p.name).includes(q) ||
      String(p.pluNumber).startsWith(q)
  )
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
