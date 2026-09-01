/**
 * Gestión del catálogo de productos en el celular.
 *
 * El catálogo se descarga de Firestore al loguear (si hay internet) y se
 * cachea en IndexedDB. El POS usa siempre el cache local, de modo que
 * funciona sin conexión una vez descargado.
 *
 * Ruta en Firestore: licenses/{licenseKey}/catalog/{storeId}
 */
import { getFirestore, doc, getDoc, getDocs, collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { db } from './db'
import type { CatalogProduct } from '../types/pos'
import { searchProductsByQuery } from '@carniceria/shared'

const firestore = getFirestore(firebaseApp)

export interface CatalogSnapshotData {
  products?: unknown
  updatedAt?: unknown
  deletedProductIds?: unknown
}

/** Aplica un snapshot de catálogo (sin Firebase) para tests y para el listener. */
export function productsFromCatalogSnapshot(data: CatalogSnapshotData): CatalogProduct[] {
  const deletedIds = new Set(
    Array.isArray(data.deletedProductIds)
      ? data.deletedProductIds.filter((id): id is string => typeof id === 'string')
      : [],
  )
  const raw = Array.isArray(data.products) ? data.products : []
  return (raw as CatalogProduct[]).filter(p => p?.productId && !deletedIds.has(p.productId))
}

export async function persistCatalogSnapshot(
  storeId: string,
  data: CatalogSnapshotData,
): Promise<CatalogProduct[]> {
  const products = productsFromCatalogSnapshot(data)
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString()
  await db.catalog.put({ storeId, products, updatedAt })
  return products
}

/**
 * Descarga el catálogo del local desde Firestore y lo guarda en IndexedDB.
 * Si falla la descarga, el cache existente sigue siendo válido.
 */
export async function syncCatalog(storeId: string): Promise<void> {
  try {
    const catalogRef = doc(firestore, 'licenses', LICENSE_KEY, 'catalog', storeId)
    const snap = await getDoc(catalogRef)
    if (!snap.exists()) return
    await persistCatalogSnapshot(storeId, snap.data() as CatalogSnapshotData)
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

/** Búsqueda por nombre (normaliza tildes y mayúsculas) o PLU. Exacto primero. */
export function searchCatalog(
  catalog: CatalogProduct[],
  query: string
): CatalogProduct[] {
  return searchProductsByQuery(catalog, query, {
    nameOf: p => p.name,
    pluOf: p => p.pluNumber,
  })
}

export function sortCatalogByPlu(products: CatalogProduct[]): CatalogProduct[] {
  return [...products].sort((a, b) => a.pluNumber - b.pluNumber)
}

/** Une productos de varios locales por productId (el primero gana). Orden: PLU asc.
 *  `deletedIds` son bajas globales publicadas en cualquier local: no deben reaparecer.
 *  Si dos IDs distintos quedan con el mismo PLU (ficha vieja + alta nueva), gana el
 *  que tenga `updatedAt` más reciente. */
export function mergeCatalogProducts(
  groups: CatalogProduct[][],
  deletedIds: string[] = [],
): CatalogProduct[] {
  const deleted = new Set(deletedIds)
  const byId = new Map<string, CatalogProduct>()
  for (const group of groups) {
    for (const p of group) {
      if (!p?.productId || deleted.has(p.productId)) continue
      if (!byId.has(p.productId)) byId.set(p.productId, p)
    }
  }

  const byPlu = new Map<number, CatalogProduct>()
  for (const p of byId.values()) {
    const existing = byPlu.get(p.pluNumber)
    if (!existing) {
      byPlu.set(p.pluNumber, p)
      continue
    }
    const pAt = productUpdatedAt(p)
    const eAt = productUpdatedAt(existing)
    if (pAt >= eAt) byPlu.set(p.pluNumber, p)
  }
  return sortCatalogByPlu(Array.from(byPlu.values()))
}

function productUpdatedAt(p: CatalogProduct): string {
  const extra = p as CatalogProduct & { updatedAt?: string }
  return extra.updatedAt ?? ''
}

/**
 * Typeahead de catálogo (Clientes especiales, etc.): todos los productos,
 * PLU de menor a mayor. Sin tope de cantidad — la lista scrollea.
 */
export function catalogTypeaheadMatches(
  catalog: CatalogProduct[],
  query: string,
  excludeIds: string[] = [],
): CatalogProduct[] {
  const available = sortCatalogByPlu(
    catalog.filter(p => !excludeIds.includes(p.productId)),
  )
  const q = query.trim()
  if (!q) return available
  return searchCatalog(available, q)
}

/** Catálogo mergeado de todos los locales (para autocomplete admin). */
export async function fetchMergedCatalogFromFirestore(): Promise<CatalogProduct[]> {
  const snap = await getDocs(collection(firestore, 'licenses', LICENSE_KEY, 'catalog'))
  const groups: CatalogProduct[][] = []
  const deletedIds: string[] = []
  for (const d of snap.docs) {
    const data = d.data()
    groups.push((data['products'] ?? []) as CatalogProduct[])
    const deleted = data['deletedProductIds']
    if (Array.isArray(deleted)) {
      for (const id of deleted) {
        if (typeof id === 'string') deletedIds.push(id)
      }
    }
  }
  return mergeCatalogProducts(groups, deletedIds)
}

let catalogLiveUnsub: Unsubscribe | null = null
let catalogLiveStoreId: string | null = null

/**
 * Listener en vivo del doc `licenses/{LICENSE_KEY}/catalog/{storeId}`.
 * Offline: el cache IndexedDB sigue; los errores se loguean.
 */
export function startCatalogLiveListener(storeId: string, onUpdate: () => void): void {
  stopCatalogLiveListener()
  catalogLiveStoreId = storeId

  try {
    const catalogRef = doc(firestore, 'licenses', LICENSE_KEY, 'catalog', storeId)
    catalogLiveUnsub = onSnapshot(
      catalogRef,
      snapshot => {
        void (async () => {
          try {
            if (!snapshot.exists()) return
            await persistCatalogSnapshot(storeId, snapshot.data() as CatalogSnapshotData)
            if (catalogLiveStoreId === storeId) onUpdate()
          } catch (err) {
            console.error('[catalog] Error aplicando snapshot', err)
          }
        })()
      },
      err => {
        console.error('[catalog] Error en listener de catálogo', err)
      },
    )
  } catch (err) {
    catalogLiveUnsub = null
    catalogLiveStoreId = null
    console.error('[catalog] No se pudo iniciar el listener de catálogo', err)
  }
}

export function stopCatalogLiveListener(): void {
  catalogLiveStoreId = null
  if (!catalogLiveUnsub) return
  try {
    catalogLiveUnsub()
  } catch (err) {
    console.error('[catalog] Error al detener listener de catálogo', err)
  }
  catalogLiveUnsub = null
}
