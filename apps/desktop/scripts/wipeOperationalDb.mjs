/**
 * Wipe total de datos operativos locales + catálogo limpio, sin locales.
 *
 * Conserva:
 *   - __drizzle_migrations
 *
 * Borra: locales, productos, precios, ventas, turnos, fiados, pedidos,
 *        empleados, vales, gastos, proveedores, conteos, usuarios, etc.
 *
 * Luego carga scripts/catalog-2026-08.json en `products` (sin precios:
 * al crear un local, seedCatalogOntoStore copia la lista).
 *
 * Uso (apps/desktop):
 *   pnpm run db:wipe:prod
 *   pnpm run db:wipe:dev
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ENV = process.env['APP_ENV'] ?? 'dev'
const CATALOG_PATH = path.join(__dirname, 'catalog-2026-08.json')
const CATALOG_SEED_USER_ID = 'seed-system-user-production-0000001'

/** Tablas a vaciar (orden irrelevante con foreign_keys=OFF). */
const WIPE_TABLES = [
  'stock_count_items',
  'stock_counts',
  'stock_entries',
  'sale_items',
  'sale_payments',
  'sales',
  'bill_denominations',
  'expenses',
  'employee_vales',
  'salary_payments',
  'attendance',
  'employees',
  'orders',
  'debt_events',
  'customer_prices',
  'customers',
  'special_customer_prices',
  'special_customers',
  'provider_debt_events',
  'providers',
  'shifts',
  'scale_tickets',
  'store_products',
  'product_prices',
  'catalog_audit_events',
  'products',
  'admin_devices',
  'users',
  'stores',
]

function getDbPath() {
  const appData =
    process.env['APPDATA'] ||
    process.env['HOME'] ||
    process.env['USERPROFILE'] ||
    ''
  const base = path.join(appData, '@carniceria', 'desktop')
  return APP_ENV === 'dev'
    ? path.join(base, 'dev', 'app.sqlite')
    : path.join(base, 'app.sqlite')
}

function productIdForPlu(plu) {
  return `00000000-0000-0000-0002-${String(plu).padStart(12, '0')}`
}

function main() {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) {
    console.error(`[db:wipe] No existe la DB: ${dbPath}`)
    process.exit(1)
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'))
  const now = new Date().toISOString()

  const backupPath = `${dbPath}.bak-wipe-${now.replace(/[:.]/g, '-')}`
  fs.copyFileSync(dbPath, backupPath)
  for (const suf of ['-wal', '-shm']) {
    const side = dbPath + suf
    if (fs.existsSync(side)) fs.copyFileSync(side, backupPath + suf)
  }
  console.log(`[db:wipe] Backup: ${backupPath}`)
  console.log(`[db:wipe] APP_ENV=${APP_ENV} → ${dbPath}`)

  const db = new Database(dbPath)

  const existingTables = new Set(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name),
  )

  db.pragma('foreign_keys = OFF')
  for (const table of WIPE_TABLES) {
    if (!existingTables.has(table)) continue
    const r = db.prepare(`DELETE FROM ${table}`).run()
    console.log(`[db:wipe] ${table}: ${r.changes} filas`)
  }
  db.pragma('foreign_keys = ON')

  const seed = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, store_id, name, firebase_uid, role, active, created_at)
      VALUES (?, NULL, ?, ?, 'cashier', 1, ?)
    `).run(CATALOG_SEED_USER_ID, 'Sistema (catálogo)', CATALOG_SEED_USER_ID, now)

    const insertProduct = db.prepare(`
      INSERT INTO products (id, name, category, unit, plu_number, active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `)

    for (const p of catalog.products) {
      const id = productIdForPlu(p.plu)
      insertProduct.run(id, p.name, p.category, p.unit, p.plu, now)
    }

    const fallbackId = '00000000-0000-0000-0002-000000000099'
    insertProduct.run(fallbackId, 'Producto sin identificar', 'other', 'kg', null, now)

    console.log(`[db:wipe] Catálogo maestro: ${catalog.products.length} productos (+ fallback). Sin locales.`)
  })

  seed()

  const check = db.prepare(`SELECT active, COUNT(*) c FROM products GROUP BY active`).all()
  const storeCount = db.prepare(`SELECT COUNT(*) c FROM stores`).get()
  console.log('[db:wipe] products por active:', check)
  console.log('[db:wipe] stores:', storeCount)
  console.log('[db:wipe] ✓ Listo. Reiniciá la app (admin). Al crear un local se copian productos y precios de la lista.')
  console.log('  Firestore: hay que limpiar aparte (scripts/firestoreDay0Wipe.mjs --apply).')

  db.close()
}

main()
