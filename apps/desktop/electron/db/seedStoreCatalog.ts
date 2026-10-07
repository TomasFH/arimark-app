/**
 * Catálogo maestro embebido (JSON) → SQLite.
 * Al crear un local vacío, copia productos activos y les pone precio de lista
 * (o el precio vigente de otro local si el JSON no tiene ese PLU).
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, ne } from 'drizzle-orm'
import log from 'electron-log'
import { getDb } from './client'
import { productPrices, products, storeProducts, users } from './schema'

export const CATALOG_SEED_USER_ID = 'seed-system-user-production-0000001'
export const FALLBACK_PRODUCT_ID = '00000000-0000-0000-0002-000000000099'
export const MASTER_CATALOG_FILENAME = 'catalog-2026-08.json'

const CATEGORIES = new Set(['beef_cut', 'poultry', 'pork', 'other', 'bags'] as const)
const UNITS = new Set(['kg', 'unit'] as const)

type ProductCategory = 'beef_cut' | 'poultry' | 'pork' | 'other' | 'bags'
type ProductUnit = 'kg' | 'unit'

export interface MasterCatalogProduct {
  plu: number
  name: string
  category: ProductCategory
  unit: ProductUnit
  /** Ausente o null: el PLU está en la lista, pero no hay precio de lista para copiar. */
  price: number | null
}

export interface MasterCatalogFile {
  pricesValidFrom?: string
  products: MasterCatalogProduct[]
}

export function productIdForPlu(plu: number): string {
  return `00000000-0000-0000-0002-${String(plu).padStart(12, '0')}`
}

export function catalogJsonCandidates(): string[] {
  const paths: string[] = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    paths.push(path.join(process.resourcesPath, MASTER_CATALOG_FILENAME))
  }
  paths.push(
    path.resolve(__dirname, '../../scripts', MASTER_CATALOG_FILENAME),
    path.resolve(__dirname, '../../../scripts', MASTER_CATALOG_FILENAME),
  )
  return paths
}

export function resolveMasterCatalogPath(filePath?: string): string | null {
  const candidates = filePath ? [filePath] : catalogJsonCandidates()
  return candidates.find(p => fs.existsSync(p)) ?? null
}

export function loadMasterCatalog(filePath?: string): MasterCatalogFile | null {
  const found = resolveMasterCatalogPath(filePath)
  if (!found) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(found, 'utf-8')) as {
      pricesValidFrom?: string
      products?: unknown
    }
    if (!Array.isArray(parsed.products)) return { products: [] }
    const productsOut: MasterCatalogProduct[] = []
    for (const raw of parsed.products) {
      if (!raw || typeof raw !== 'object') continue
      const p = raw as Record<string, unknown>
      if (typeof p['plu'] !== 'number' || typeof p['name'] !== 'string') continue
      const price = typeof p['price'] === 'number' ? p['price'] : null
      const category = p['category']
      const unit = p['unit']
      if (typeof category !== 'string' || !CATEGORIES.has(category as ProductCategory)) continue
      if (typeof unit !== 'string' || !UNITS.has(unit as ProductUnit)) continue
      productsOut.push({
        plu: p['plu'],
        name: p['name'],
        category: category as ProductCategory,
        unit: unit as ProductUnit,
        price,
      })
    }
    return { pricesValidFrom: parsed.pricesValidFrom, products: productsOut }
  } catch (err) {
    log.error('[seedStoreCatalog] No se pudo leer el catálogo maestro', err)
    return null
  }
}

export function loadMasterCatalogPricesByPlu(filePath?: string): Map<number, number> {
  const map = new Map<number, number>()
  const catalog = loadMasterCatalog(filePath)
  if (!catalog) return map
  for (const p of catalog.products) {
    if (typeof p.price !== 'number') continue
    map.set(p.plu, p.price)
  }
  return map
}

/**
 * Inserta en `products` los ítems del JSON que aún no existen (por id de PLU).
 * No pisa fichas ya editadas. Idempotente.
 */
export function ensureMasterCatalogProducts(params?: {
  now?: string
  filePath?: string
}): { inserted: number; skipped: number; source: string | null } {
  const db = getDb()
  const now = params?.now ?? new Date().toISOString()
  const source = resolveMasterCatalogPath(params?.filePath)
  const catalog = loadMasterCatalog(params?.filePath)
  if (!catalog || catalog.products.length === 0) {
    log.warn('[seedStoreCatalog] Catálogo maestro ausente o vacío — products no se sembraron', { source })
    return { inserted: 0, skipped: 0, source }
  }

  let inserted = 0
  let skipped = 0
  for (const product of catalog.products) {
    const id = productIdForPlu(product.plu)
    const existing = db.select({ id: products.id }).from(products).where(eq(products.id, id)).get()
    if (existing) {
      skipped += 1
      continue
    }
    const pluOwner = db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.pluNumber, product.plu))
      .get()
    if (pluOwner && pluOwner.id !== id) {
      log.warn('[seedStoreCatalog] PLU ya usado por otra ficha — no se inserta', {
        plu: product.plu,
        ownerId: pluOwner.id,
      })
      skipped += 1
      continue
    }
    db.insert(products).values({
      id,
      name: product.name,
      category: product.category,
      unit: product.unit,
      pluNumber: product.plu,
      active: true,
      createdAt: now,
    }).run()
    inserted += 1
  }

  const fallback = db.select({ id: products.id }).from(products).where(eq(products.id, FALLBACK_PRODUCT_ID)).get()
  if (!fallback) {
    db.insert(products).values({
      id: FALLBACK_PRODUCT_ID,
      name: 'Producto sin identificar',
      category: 'other',
      unit: 'kg',
      pluNumber: null,
      active: true,
      createdAt: now,
    }).run()
    inserted += 1
  } else {
    skipped += 1
  }

  log.info('[seedStoreCatalog] Catálogo maestro en SQLite', { inserted, skipped, source })
  return { inserted, skipped, source }
}

export function ensureCatalogSeedUser(now = new Date().toISOString()): string {
  const db = getDb()
  const existing = db.select({ id: users.id }).from(users).where(eq(users.id, CATALOG_SEED_USER_ID)).get()
  if (existing) return CATALOG_SEED_USER_ID
  db.insert(users).values({
    id: CATALOG_SEED_USER_ID,
    storeId: null,
    name: 'Sistema (catálogo)',
    firebaseUid: CATALOG_SEED_USER_ID,
    role: 'cashier',
    active: true,
    createdAt: now,
  }).run()
  return CATALOG_SEED_USER_ID
}

export function seedCatalogOntoStore(params: {
  storeId: string
  createdByUserId: string
  now?: string
  listPricesByPlu?: Map<number, number>
}): number {
  const db = getDb()
  const now = params.now ?? new Date().toISOString()
  const listPrices = params.listPricesByPlu ?? loadMasterCatalogPricesByPlu()

  const active = db.select().from(products).where(eq(products.active, true)).all()
  const existingSp = db
    .select({ productId: storeProducts.productId })
    .from(storeProducts)
    .where(eq(storeProducts.storeId, params.storeId))
    .all()
  const spSet = new Set(existingSp.map(r => r.productId))

  const pricedHere = db
    .select({ productId: productPrices.productId })
    .from(productPrices)
    .where(and(eq(productPrices.storeId, params.storeId), isNull(productPrices.validTo)))
    .all()
  const pricedSet = new Set(pricedHere.map(r => r.productId))

  const otherPrices = db
    .select({
      productId: productPrices.productId,
      price: productPrices.price,
      validFrom: productPrices.validFrom,
    })
    .from(productPrices)
    .where(and(isNull(productPrices.validTo), ne(productPrices.storeId, params.storeId)))
    .all()
  const fallbackByProduct = new Map<string, number>()
  for (const row of otherPrices) {
    if (fallbackByProduct.has(row.productId)) continue
    fallbackByProduct.set(row.productId, row.price)
  }

  let seeded = 0
  for (const product of active) {
    if (product.id === FALLBACK_PRODUCT_ID) continue
    if (!spSet.has(product.id)) {
      db.insert(storeProducts).values({
        storeId: params.storeId,
        productId: product.id,
        available: true,
      }).run()
    }
    if (pricedSet.has(product.id)) continue
    const fromList = product.pluNumber != null ? listPrices.get(product.pluNumber) : undefined
    const price = fromList ?? fallbackByProduct.get(product.id)
    if (price == null) continue
    db.insert(productPrices).values({
      id: randomUUID(),
      productId: product.id,
      storeId: params.storeId,
      price,
      validFrom: now,
      validTo: null,
      createdBy: params.createdByUserId,
    }).run()
    seeded += 1
  }
  return seeded
}
