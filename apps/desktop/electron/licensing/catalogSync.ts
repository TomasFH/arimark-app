/**
 * Descarga el snapshot del catálogo publicado en Firestore y lo vuelca a la
 * base de datos SQLite local. Usado principalmente en instancias "remote"
 * (otra PC o sesión de admin) que no tienen productos cargados localmente.
 *
 * Ruta en Firestore: licenses/{licenseKey}/catalog/{storeId}
 * Escribe en: products (upsert) y product_prices (invalida vigente + inserta nuevo).
 */
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { products, productPrices } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getActiveSession } from '../activeSession'

interface CatalogProduct {
  productId: string
  pluNumber: number
  name: string
  category: string
  unit: string
  price: number
}

/**
 * Descarga el catálogo del local indicado desde Firestore y lo persiste en
 * SQLite. No-op si Firebase no está disponible (modo dev) o si el documento
 * aún no fue publicado.
 */
export async function pullCatalogFromFirestore(licenseKey: string, storeId: string): Promise<void> {
  if (!isFirebaseAvailable()) {
    log.info('[catalogSync] Firebase no disponible — pull omitido')
    return
  }

  const session = getActiveSession()
  if (!session) {
    log.warn('[catalogSync] Sin sesión activa — pull omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const catalogRef = doc(firestore, 'licenses', licenseKey, 'catalog', storeId)
    const snap = await getDoc(catalogRef)

    if (!snap.exists()) {
      log.info('[catalogSync] Catálogo aún no publicado para el local', { storeId })
      return
    }

    const data = snap.data() as { products: CatalogProduct[]; updatedAt: string }
    if (!Array.isArray(data.products) || data.products.length === 0) {
      log.info('[catalogSync] Catálogo publicado está vacío', { storeId })
      return
    }

    const db = getDb()
    const now = new Date().toISOString()
    const userId = session.userId

    db.transaction(tx => {
      for (const p of data.products) {
        // Upsert del producto — actualiza nombre/PLU si ya existe
        tx.insert(products)
          .values({
            id: p.productId,
            name: p.name,
            category: p.category as 'beef_cut' | 'poultry' | 'pork' | 'other',
            unit: p.unit as 'kg' | 'unit',
            pluNumber: p.pluNumber,
            active: true,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: products.id,
            set: {
              name: p.name,
              pluNumber: p.pluNumber,
              category: p.category as 'beef_cut' | 'poultry' | 'pork' | 'other',
              unit: p.unit as 'kg' | 'unit',
              active: true,
            },
          })
          .run()

        // Invalidar el precio vigente anterior para productId + storeId
        tx.update(productPrices)
          .set({ validTo: now })
          .where(
            and(
              eq(productPrices.productId, p.productId),
              eq(productPrices.storeId, storeId),
              isNull(productPrices.validTo),
            ),
          )
          .run()

        // Insertar precio actualizado
        tx.insert(productPrices)
          .values({
            id: uuidv4(),
            productId: p.productId,
            storeId,
            price: p.price,
            validFrom: now,
            validTo: null,
            createdBy: userId,
          })
          .run()
      }
    })

    log.info('[catalogSync] Catálogo sincronizado desde Firestore', {
      storeId,
      count: data.products.length,
    })
  } catch (err) {
    log.error('[catalogSync] Error al sincronizar catálogo', err)
    // No se propaga — es no bloqueante para el flujo de login.
  }
}
