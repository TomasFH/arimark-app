/**
 * Corrige ofertas tipo "… x2kg / x3kg / x5kg":
 *   unit = kg, price = precio_pack / kg (redondeado).
 * Fuente: scripts/catalog-2026-08.json (ya convertido).
 *
 * Uso: pnpm run catalog:fix-packs:prod | :dev
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
  const appData = process.env['APPDATA'] || process.env['HOME'] || process.env['USERPROFILE'] || ''
  const base = path.join(appData, '@carniceria', 'desktop')
  return APP_ENV === 'dev' ? path.join(base, 'dev', 'app.sqlite') : path.join(base, 'app.sqlite')
}

function productIdForPlu(plu) {
  return `00000000-0000-0000-0002-${String(plu).padStart(12, '0')}`
}

function main() {
  const dbPath = getDbPath()
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'))
  const packs = catalog.products.filter(p => /x\s*\d+\s*kg/i.test(p.name))
  const now = new Date().toISOString()

  const db = new Database(dbPath)
  const storeCols = db.prepare(`PRAGMA table_info(stores)`).all()
  const hasArchived = storeCols.some(c => c.name === 'archived_at')
  const stores = hasArchived
    ? db.prepare(`SELECT id FROM stores WHERE archived_at IS NULL`).all()
    : db.prepare(`SELECT id FROM stores`).all()

  const seedUser =
    db.prepare(`SELECT id FROM users LIMIT 1`).get()?.id ??
    'seed-system-user-production-0000001'

  const tx = db.transaction(() => {
    let n = 0
    for (const p of packs) {
      const id = productIdForPlu(p.plu)
      const row = db.prepare(`SELECT id FROM products WHERE id = ? OR plu_number = ?`).get(id, p.plu)
      if (!row) {
        console.warn(`[fix-packs] PLU ${p.plu} no encontrado — omitido`)
        continue
      }
      db.prepare(`UPDATE products SET unit = 'kg', name = ?, active = 1 WHERE id = ?`).run(p.name, row.id)

      for (const store of stores) {
        const open = db
          .prepare(
            `SELECT id FROM product_prices WHERE product_id = ? AND store_id = ? AND valid_to IS NULL`,
          )
          .get(row.id, store.id)
        if (open) {
          db.prepare(`UPDATE product_prices SET valid_to = ? WHERE id = ?`).run(now, open.id)
        }
        db.prepare(`
          INSERT INTO product_prices (id, product_id, store_id, price, valid_from, valid_to, created_by)
          VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).run(randomUUID(), row.id, store.id, p.price, now, seedUser)
      }
      console.log(`[fix-packs] PLU ${p.plu} ${p.name} → kg @ ${p.price}`)
      n++
    }
    console.log(`[fix-packs] ✓ ${n} ofertas corregidas en ${dbPath}`)
  })

  tx()
  db.close()
}

main()
