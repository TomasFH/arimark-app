/**
 * Reemplazo seguro del catálogo de productos/precios.
 *
 * - NO borra products (protege FKs de sale_items, stock, etc.).
 * - Desactiva productos viejos y libera sus PLU.
 * - Cierra precios vigentes.
 * - Inserta el catálogo de scripts/catalog-2026-08.json.
 * - Aplica precios a TODOS los locales no archivados.
 *
 * Uso (desde apps/desktop):
 *   pnpm run catalog:replace:dev
 *   pnpm run catalog:replace:prod
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ENV = process.env['APP_ENV'] ?? 'dev'
const CATALOG_PATH = path.join(__dirname, 'catalog-2026-08.json')

function getDbPath() {
  // Misma lógica que electron/db/paths.ts (sin depender de Electron al importar).
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
    console.error(`[catalog:replace] No existe la DB: ${dbPath}`)
    process.exit(1)
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'))
  const now = new Date().toISOString()

  const backupPath = `${dbPath}.bak-catalog-${now.replace(/[:.]/g, '-')}`
  fs.copyFileSync(dbPath, backupPath)
  // También copiar -wal/-shm si existen (SQLite)
  for (const suf of ['-wal', '-shm']) {
    const side = dbPath + suf
    if (fs.existsSync(side)) fs.copyFileSync(side, backupPath + suf)
  }
  console.log(`[catalog:replace] Backup: ${backupPath}`)

  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')

  const seedUserId =
    APP_ENV === 'dev' ? 'dev-cashier-cajera1@dev.local' : 'seed-system-user-production-0000001'

  const storeCols = db.prepare(`PRAGMA table_info(stores)`).all()
  const hasArchived = storeCols.some(c => c.name === 'archived_at')
  const stores = hasArchived
    ? db.prepare(`SELECT id, name FROM stores WHERE archived_at IS NULL`).all()
    : db.prepare(`SELECT id, name FROM stores`).all()

  if (stores.length === 0) {
    console.error('[catalog:replace] No hay locales activos.')
    db.close()
    process.exit(1)
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(seedUserId)
  if (!existingUser) {
    const storeId = stores[0].id
    db.prepare(`
      INSERT INTO users (id, store_id, name, firebase_uid, role, active, created_at)
      VALUES (?, ?, ?, ?, 'cashier', 1, ?)
    `).run(seedUserId, storeId, 'Sistema (catálogo)', seedUserId, now)
  }

  const tx = db.transaction(() => {
    const deactivated = db
      .prepare(
        `UPDATE products SET active = 0, plu_number = NULL WHERE active = 1 AND plu_number IS NOT NULL`,
      )
      .run()
    console.log(`[catalog:replace] Productos desactivados / PLU liberados: ${deactivated.changes}`)

    db.prepare(`UPDATE products SET active = 0 WHERE name = 'Producto sin identificar'`).run()

    const closed = db
      .prepare(`UPDATE product_prices SET valid_to = ? WHERE valid_to IS NULL`)
      .run(now)
    console.log(`[catalog:replace] Precios cerrados: ${closed.changes}`)

    const insertProduct = db.prepare(`
      INSERT INTO products (id, name, category, unit, plu_number, active, created_at)
      VALUES (@id, @name, @category, @unit, @plu, 1, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        unit = excluded.unit,
        plu_number = excluded.plu_number,
        active = 1
    `)

    const insertPrice = db.prepare(`
      INSERT INTO product_prices (id, product_id, store_id, price, valid_from, valid_to, created_by)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `)

    const upsertStoreProduct = db.prepare(`
      INSERT INTO store_products (store_id, product_id, available)
      VALUES (?, ?, 1)
      ON CONFLICT(store_id, product_id) DO UPDATE SET available = 1
    `)

    let inserted = 0
    for (const p of catalog.products) {
      const id = productIdForPlu(p.plu)
      insertProduct.run({
        id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        plu: p.plu,
        createdAt: now,
      })
      for (const store of stores) {
        insertPrice.run(
          randomUUID(),
          id,
          store.id,
          p.price,
          catalog.pricesValidFrom,
          seedUserId,
        )
        upsertStoreProduct.run(store.id, id)
      }
      inserted++
    }

    const fallbackId = '00000000-0000-0000-0002-000000000099'
    insertProduct.run({
      id: fallbackId,
      name: 'Producto sin identificar',
      category: 'other',
      unit: 'kg',
      plu: null,
      createdAt: now,
    })

    console.log(`[catalog:replace] Productos nuevos: ${inserted} (+ fallback)`)
    console.log(
      `[catalog:replace] Locales con precios: ${stores.map(s => s.name).join(', ')}`,
    )
  })

  tx()
  db.close()
  console.log(`[catalog:replace] ✓ Listo en ${dbPath}`)
  console.log(
    '  Reiniciá la app. Si usás Firestore, republicá el catálogo (login cajera o select-store admin) por local.',
  )
}

main()
