/**
 * Publicación del catálogo de productos a Firestore.
 *
 * La PC publica un snapshot del catálogo vigente por local al iniciar y al
 * loguear una cajera. La PWA móvil lo descarga y lo cachea en IndexedDB,
 * permitiendo armar ventas sin conexión.
 *
 * Ruta en Firestore: licenses/{licenseKey}/catalog/{storeId}
 * Estructura: { products: [...], updatedAt: ISO }
 *
 * Nota: base para el panel de administración de precios por local (Fase 4),
 * donde los admins podrán editar esta lista eligiendo el local primero y
 * sincronizar los cambios tanto a Firestore (para el móvil) como a la balanza.
 */
import { getFirestore, doc, setDoc } from 'firebase/firestore'
import log from 'electron-log'
import { getDb } from '../db/client'
import { products, productPrices } from '../db/schema'
import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

interface CatalogProduct {
  productId: string
  pluNumber: number
  name: string
  category: string
  unit: string
  price: number
}

/**
 * Publica el catálogo vigente del local indicado a Firestore.
 * No-op en modo dev.
 */
export async function publishCatalog(licenseKey: string, storeId: string): Promise<void> {
  if (!isFirebaseAvailable()) {
    log.info('[catalogPublish] Firebase no disponible (dev) — publicación omitida')
    return
  }

  try {
    const db = getDb()
    const now = new Date().toISOString()

    // Productos activos con PLU y precio vigente en el local.
    const productRows = db
      .select({
        productId: products.id,
        pluNumber: products.pluNumber,
        name: products.name,
        category: products.category,
        unit: products.unit,
      })
      .from(products)
      .where(isNotNull(products.pluNumber))
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

    // Precio más reciente por producto.
    const priceMap = new Map<string, number>()
    for (const row of priceRows) {
      const existing = priceMap.get(row.productId)
      if (existing === undefined) {
        priceMap.set(row.productId, row.price)
      }
    }

    const catalogProducts: CatalogProduct[] = productRows
      .filter(r => r.pluNumber !== null && priceMap.has(r.productId))
      .map(r => ({
        productId: r.productId,
        pluNumber: r.pluNumber as number,
        name: r.name,
        category: r.category,
        unit: r.unit,
        price: priceMap.get(r.productId) ?? 0,
      }))

    // Si no hay productos con PLU y precio, este SQLite es una instancia remota
    // o el catálogo todavía no fue configurado. No publicar para no sobrescribir
    // el catálogo válido que ya existe en Firestore.
    if (catalogProducts.length === 0) {
      log.info('[catalogPublish] Sin productos con PLU y precio — publicación omitida', { storeId })
      return
    }

    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)

    await setDoc(catalogRef, {
      products: catalogProducts,
      updatedAt: now,
    })

    log.info('[catalogPublish] Catálogo publicado', {
      storeId,
      products: catalogProducts.length,
    })
  } catch (err) {
    // No es fatal — la PC sigue funcionando aunque falle la publicación.
    log.error('[catalogPublish] Error al publicar catálogo', err)
  }
}
