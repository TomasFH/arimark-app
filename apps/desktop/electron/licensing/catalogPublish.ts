/**
 * Publicación del catálogo de productos a Firestore.
 *
 * Ruta: licenses/{licenseKey}/catalog/{storeId}
 * Estructura: { products: [...], deletedProductIds: [...], updatedAt: ISO }
 *
 * Antes de sobrescribir, se guarda el snapshot anterior en
 * licenses/{licenseKey}/catalog/{storeId}/revisions/{id} (últimos 10).
 */
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  deleteDoc,
} from 'firebase/firestore'
import log from 'electron-log'
import { getDb } from '../db/client'
import { products, productPrices, storeProducts, stores } from '../db/schema'
import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

const MAX_CATALOG_REVISIONS = 10

interface CatalogProduct {
  productId: string
  pluNumber: number
  name: string
  category: string
  unit: string
  price: number
  updatedAt: string
  priceUpdatedAt: string
  /** Visibilidad en este local. Ausente = disponible (compat con snapshots viejos). */
  available: boolean
}

export interface CatalogRevisionRow {
  id: string
  archivedAt: string
  updatedAt: string | null
  productCount: number
}

function revisionsCol(licenseKey: string, storeId: string) {
  const firestore = getFirestore(getFirebaseApp())
  return collection(firestore, 'licenses', licenseKey, 'catalog', storeId, 'revisions')
}

async function archiveCurrentCatalog(
  licenseKey: string,
  storeId: string,
  archivedAt: string,
): Promise<void> {
  const firestore = getFirestore(getFirebaseApp())
  const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
  const snap = await getDoc(catalogRef)
  if (!snap.exists()) return

  const data = snap.data() as { products?: unknown[]; updatedAt?: string; deletedProductIds?: string[] }
  if (!Array.isArray(data.products) || data.products.length === 0) return

  const revRef = doc(revisionsCol(licenseKey, storeId))
  await setDoc(revRef, {
    products: data.products,
    deletedProductIds: data.deletedProductIds ?? [],
    updatedAt: data.updatedAt ?? null,
    archivedAt,
    productCount: data.products.length,
  })

  try {
    const q = query(revisionsCol(licenseKey, storeId), orderBy('archivedAt', 'desc'))
    const docs = await getDocs(q)
    const extra = docs.docs.slice(MAX_CATALOG_REVISIONS)
    for (const d of extra) {
      await deleteDoc(d.ref)
    }
  } catch (err) {
    log.warn('[catalogPublish] No se pudieron podar revisiones viejas', { storeId, err })
  }
}

/**
 * Publica el catálogo vigente del local indicado a Firestore.
 * No-op en modo dev. Archiva el snapshot previo si existía.
 */
export async function publishCatalog(licenseKey: string, storeId: string): Promise<void> {
  if (!isFirebaseAvailable()) {
    log.info('[catalogPublish] Firebase no disponible (dev) — publicación omitida')
    return
  }

  try {
    const db = getDb()
    const now = new Date().toISOString()

    const productRows = db
      .select({
        productId: products.id,
        pluNumber: products.pluNumber,
        name: products.name,
        category: products.category,
        unit: products.unit,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .where(and(eq(products.active, true), isNotNull(products.pluNumber)))
      .all()

    const priceRows = db
      .select({
        productId: productPrices.productId,
        price: productPrices.price,
        validFrom: productPrices.validFrom,
      })
      .from(productPrices)
      .where(
        and(
          eq(productPrices.storeId, storeId),
          lte(productPrices.validFrom, now),
          or(isNull(productPrices.validTo), gt(productPrices.validTo, now))
        )
      )
      .all()

    const priceMap = new Map<string, { price: number; validFrom: string }>()
    for (const row of priceRows) {
      const existing = priceMap.get(row.productId)
      if (!existing || row.validFrom > existing.validFrom) {
        priceMap.set(row.productId, { price: row.price, validFrom: row.validFrom })
      }
    }

    const availRows = db
      .select({ productId: storeProducts.productId, available: storeProducts.available })
      .from(storeProducts)
      .where(eq(storeProducts.storeId, storeId))
      .all()
    const availMap = new Map(availRows.map(r => [r.productId, r.available]))

    const catalogProducts: CatalogProduct[] = productRows
      .filter(r => r.pluNumber !== null && priceMap.has(r.productId))
      .map(r => {
        const priceMeta = priceMap.get(r.productId)
        return {
          productId: r.productId,
          pluNumber: r.pluNumber as number,
          name: r.name,
          category: r.category,
          unit: r.unit,
          price: priceMeta?.price ?? 0,
          updatedAt: r.updatedAt ?? r.createdAt,
          priceUpdatedAt: priceMeta?.validFrom ?? r.updatedAt ?? r.createdAt,
          available: availMap.get(r.productId) ?? true,
        }
      })

    const deletedProductIds = db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.active, false))
      .all()
      .map(r => r.id)

    if (catalogProducts.length === 0) {
      log.info('[catalogPublish] Sin productos con PLU y precio — publicación omitida', { storeId })
      return
    }

    await archiveCurrentCatalog(licenseKey, storeId, now)

    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)

    await setDoc(catalogRef, {
      products: catalogProducts,
      deletedProductIds,
      updatedAt: now,
    })

    log.info('[catalogPublish] Catálogo publicado', {
      storeId,
      products: catalogProducts.length,
    })
  } catch (err) {
    log.error('[catalogPublish] Error al publicar catálogo', err)
  }
}

export async function publishCatalogForAllStores(licenseKey: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const rows = db
    .select({ id: stores.id })
    .from(stores)
    .where(isNull(stores.archivedAt))
    .all()

  for (const row of rows) {
    await publishCatalog(licenseKey, row.id)
  }
}

export async function listCatalogRevisions(
  licenseKey: string,
  storeId: string,
): Promise<CatalogRevisionRow[]> {
  if (!isFirebaseAvailable()) return []

  const q = query(revisionsCol(licenseKey, storeId), orderBy('archivedAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const data = d.data() as { archivedAt?: string; updatedAt?: string | null; productCount?: number; products?: unknown[] }
    const count = data.productCount ?? (Array.isArray(data.products) ? data.products.length : 0)
    return {
      id: d.id,
      archivedAt: data.archivedAt ?? '',
      updatedAt: data.updatedAt ?? null,
      productCount: count,
    }
  })
}

/**
 * Restaura un snapshot archivado como catálogo vigente (y archiva el actual antes).
 */
export async function restoreCatalogRevision(
  licenseKey: string,
  storeId: string,
  revisionId: string,
): Promise<{ productCount: number }> {
  if (!isFirebaseAvailable()) {
    throw new Error('Firebase no disponible.')
  }

  const firestore = getFirestore(getFirebaseApp())
  const revRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId, 'revisions', revisionId)
  const revSnap = await getDoc(revRef)
  if (!revSnap.exists()) {
    throw new Error('Versión de catálogo no encontrada.')
  }

  const data = revSnap.data() as { products?: CatalogProduct[]; updatedAt?: string; deletedProductIds?: string[] }
  if (!Array.isArray(data.products) || data.products.length === 0) {
    throw new Error('La versión archivada está vacía.')
  }

  const now = new Date().toISOString()
  await archiveCurrentCatalog(licenseKey, storeId, now)

  const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
  await setDoc(catalogRef, {
    products: data.products,
    deletedProductIds: data.deletedProductIds ?? [],
    updatedAt: now,
  })

  log.info('[catalogPublish] Catálogo restaurado desde revisión', {
    storeId,
    revisionId,
    products: data.products.length,
  })

  return { productCount: data.products.length }
}
