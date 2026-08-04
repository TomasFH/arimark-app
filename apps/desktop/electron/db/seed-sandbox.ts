/**
 * Seed de datos de prueba para la base de datos.
 * Crea el local, catálogo de productos y precios vigentes.
 *
 * Catálogo fuente: scripts/catalog-2026-08.json
 *
 * Uso:
 *   pnpm seed:dev   → APP_ENV=dev        → userData/dev/app.sqlite
 *   pnpm seed:prod  → APP_ENV=production → userData/app.sqlite
 *
 * Para reemplazar un catálogo ya existente (soft-replace):
 *   pnpm catalog:replace:dev | catalog:replace:prod
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { runMigrations } from './migrate'
import { getDbPathForEnv } from './paths'

const APP_ENV = process.env['APP_ENV'] ?? 'dev'

function getDbPath(): string {
  return getDbPathForEnv(APP_ENV)
}

function getDefaultStoreId(): string {
  const configPath = path.resolve(process.cwd(), 'config', 'business.json')
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        default_store_id?: string
      }
      if (config.default_store_id) return config.default_store_id
    } catch {
      // fallback
    }
  }

  if (APP_ENV === 'dev') return '00000000-0000-0000-0000-000000000001'

  console.error('[seed] No se encontró config/business.json — necesario para seed:prod')
  process.exit(1)
}

function productIdForPlu(plu: number): string {
  return `00000000-0000-0000-0002-${String(plu).padStart(12, '0')}`
}

interface CatalogProduct {
  plu: number
  name: string
  category: 'beef_cut' | 'poultry' | 'pork' | 'other'
  unit: 'kg' | 'unit'
  price: number
}

interface CatalogFile {
  pricesValidFrom: string
  products: CatalogProduct[]
}

function loadCatalog(): CatalogFile {
  const catalogPath = path.resolve(process.cwd(), 'scripts', 'catalog-2026-08.json')
  if (!fs.existsSync(catalogPath)) {
    console.error('[seed] No se encontró', catalogPath)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as CatalogFile
}

const DB_PATH = getDbPath()
const DEFAULT_STORE_ID = getDefaultStoreId()
const CATALOG = loadCatalog()

const STORE = {
  id: DEFAULT_STORE_ID,
  name: APP_ENV === 'dev' ? 'Local de Prueba (Dev)' : 'Local principal',
  address: APP_ENV === 'dev' ? 'Dirección de prueba' : '',
}

const SEED_PROFILE = {
  id: APP_ENV === 'dev'
    ? 'dev-cashier-cajera1@dev.local'
    : 'seed-system-user-production-0000001',
  name: APP_ENV === 'dev' ? 'Cajera Uno (dev)' : 'Sistema (seed)',
}

async function main() {
  console.log(`[seed] Preparando DB ${APP_ENV} en:`, DB_PATH)

  if (APP_ENV !== 'dev') {
    console.warn('\n⚠️  ATENCIÓN: Estás sembrando la base de datos de PRODUCCIÓN.\n')
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

  const migrationsFolder = path.resolve(process.cwd(), 'drizzle')
  const migrate = await runMigrations(DB_PATH, migrationsFolder)
  if (!migrate.ok) {
    console.error('[seed] Error al preparar la DB:', migrate.error)
    process.exit(1)
  }

  const db = new Database(DB_PATH)
  const now = new Date().toISOString()

  const existingStore = db.prepare('SELECT id FROM stores WHERE id = ?').get(DEFAULT_STORE_ID)
  if (!existingStore) {
    db.prepare(`
      INSERT INTO stores (id, name, address, created_at)
      VALUES (?, ?, ?, ?)
    `).run(STORE.id, STORE.name, STORE.address, now)
    console.log(`[seed] Local creado: "${STORE.name}"`)
  } else {
    console.log(`[seed] Local ya existía — omitido`)
  }

  for (const product of CATALOG.products) {
    const id = productIdForPlu(product.plu)
    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id)
    if (existing) {
      db.prepare(`
        UPDATE products SET plu_number = ?, name = ?, category = ?, unit = ?, active = 1
        WHERE id = ?
      `).run(product.plu, product.name, product.category, product.unit, id)
    } else {
      db.prepare(`
        INSERT INTO products (id, name, category, unit, plu_number, active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(id, product.name, product.category, product.unit, product.plu, now)
    }
  }

  // Fallback sin PLU
  const fallbackId = '00000000-0000-0000-0002-000000000099'
  const existingFallback = db.prepare('SELECT id FROM products WHERE id = ?').get(fallbackId)
  if (!existingFallback) {
    db.prepare(`
      INSERT INTO products (id, name, category, unit, plu_number, active, created_at)
      VALUES (?, 'Producto sin identificar', 'other', 'kg', NULL, 1, ?)
    `).run(fallbackId, now)
  }

  console.log(`[seed] ${CATALOG.products.length} productos del catálogo 2026-08`)

  const existingProfile = db.prepare('SELECT id FROM users WHERE id = ?').get(SEED_PROFILE.id)
  if (!existingProfile) {
    db.prepare(`
      INSERT INTO users (id, store_id, name, firebase_uid, role, active, created_at)
      VALUES (?, ?, ?, ?, 'cashier', 1, ?)
    `).run(SEED_PROFILE.id, DEFAULT_STORE_ID, SEED_PROFILE.name, SEED_PROFILE.id, now)
    console.log(`[seed] Perfil local creado: "${SEED_PROFILE.name}"`)
  } else {
    console.log(`[seed] Perfil local ya existía — omitido`)
  }

  const seedUser = db.prepare('SELECT id FROM users WHERE id = ?').get(SEED_PROFILE.id) as
    | { id: string }
    | undefined

  if (!seedUser) {
    console.warn('[seed] No se encontró el perfil sembrado — precios omitidos')
  } else {
    let priceCount = 0
    for (const product of CATALOG.products) {
      const productId = productIdForPlu(product.plu)
      const existingPrice = db.prepare(`
        SELECT id FROM product_prices
        WHERE product_id = ? AND store_id = ? AND valid_to IS NULL
      `).get(productId, DEFAULT_STORE_ID) as { id: string } | undefined

      if (existingPrice) {
        db.prepare(`
          UPDATE product_prices SET price = ?, valid_from = ? WHERE id = ?
        `).run(product.price, CATALOG.pricesValidFrom, existingPrice.id)
      } else {
        db.prepare(`
          INSERT INTO product_prices (id, product_id, store_id, price, valid_from, valid_to, created_by)
          VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).run(uuidv4(), productId, DEFAULT_STORE_ID, product.price, CATALOG.pricesValidFrom, seedUser.id)
      }
      priceCount++
    }
    console.log(`[seed] ${priceCount} precios vigentes (desde ${CATALOG.pricesValidFrom.slice(0, 10)})`)
  }

  db.close()
  console.log('\n[seed] ✓ Seed completado.')
  if (APP_ENV === 'dev') {
    console.log('\n─── Accesos de prueba ──────────────────────────────')
    console.log('  Modo dev: cualquier email/contraseña (bypass Firebase).')
    console.log('  Cajera ejemplo: cajera1@dev.local / cajera1234')
    console.log('────────────────────────────────────────────────────\n')
  }
}

main().catch(err => {
  console.error('[seed] Error inesperado:', err)
  process.exit(1)
})
