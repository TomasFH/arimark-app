/**
 * Wipe total de datos operativos locales + catálogo limpio.
 *
 * Conserva:
 *   - stores (mismos ids — importantes para authorizedStores / Firestore)
 *   - __drizzle_migrations
 *
 * Borra: productos, precios, ventas, turnos, fiados, pedidos, empleados,
 *        vales, gastos, proveedores, conteos, etc.
 *
 * Luego carga scripts/catalog-2026-08.json en todos los locales activos.
 *
 * Uso (apps/desktop):
 *   pnpm run db:wipe:prod
 *   pnpm run db:wipe:dev
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ENV = process.env['APP_ENV'] ?? 'dev'
const CATALOG_PATH = path.join(__dirname, 'catalog-2026-08.json')

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
  'products',
  'admin_devices',
  'users',
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

  const storeCols = db.prepare(`PRAGMA table_info(stores)`).all()
  const hasArchived = storeCols.some(c => c.name === 'archived_at')
  const stores = hasArchived
    ? db.prepare(`SELECT * FROM stores WHERE archived_at IS NULL`).all()
    : db.prepare(`SELECT * FROM stores`).all()

  if (stores.length === 0) {
    console.error('[db:wipe] No hay locales — abortando.')
    db.close()
    process.exit(1)
  }

  console.log(`[db:wipe] Locales a conservar (${stores.length}):`)
  for (const s of stores) console.log(`  - ${s.id} · ${s.name}`)

  const seedUserId =
    APP_ENV === 'dev' ? 'dev-cashier-cajera1@dev.local' : 'seed-system-user-production-0000001'

  // SQLite ignora PRAGMA foreign_keys dentro de una transacción: hay que
  // apagarlas fuera del BEGIN, vaciar, y recién ahí reinsertar.
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
      VALUES (?, ?, ?, ?, 'cashier', 1, ?)
    `).run(seedUserId, stores[0].id, 'Sistema (catálogo)', seedUserId, now)

    const insertProduct = db.prepare(`
      INSERT INTO products (id, name, category, unit, plu_number, active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `)
    const insertPrice = db.prepare(`
      INSERT INTO product_prices (id, product_id, store_id, price, valid_from, valid_to, created_by)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `)
    const insertStoreProduct = db.prepare(`
      INSERT INTO store_products (store_id, product_id, available)
      VALUES (?, ?, 1)
    `)

    for (const p of catalog.products) {
      const id = productIdForPlu(p.plu)
      insertProduct.run(id, p.name, p.category, p.unit, p.plu, now)
      for (const store of stores) {
        insertPrice.run(randomUUID(), id, store.id, p.price, catalog.pricesValidFrom, seedUserId)
        insertStoreProduct.run(store.id, id)
      }
    }

    const fallbackId = '00000000-0000-0000-0002-000000000099'
    insertProduct.run(fallbackId, 'Producto sin identificar', 'other', 'kg', null, now)

    console.log(`[db:wipe] Catálogo cargado: ${catalog.products.length} productos (+ fallback)`)
  })

  seed()

  const check = db.prepare(`SELECT active, COUNT(*) c FROM products GROUP BY active`).all()
  console.log('[db:wipe] products por active:', check)
  console.log('[db:wipe] ✓ Listo. Reiniciá la app.')
  console.log('  Firestore: al loguear cajera / elegir local como admin se republica el catálogo nuevo.')
  console.log('  (Los docs viejos en Firestore no se borran solos; el publish sobrescribe por store.)')

  db.close()
}

main()
