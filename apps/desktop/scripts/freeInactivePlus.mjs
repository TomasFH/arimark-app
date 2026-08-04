/**
 * Libera PLUs de productos soft-deleted (active=0).
 * Así se puede recrear un producto con el mismo número.
 *
 * Uso: APP_ENV=dev|production electron scripts/freeInactivePlus.mjs
 */
import Database from 'better-sqlite3'
import path from 'path'

const APP_ENV = process.env['APP_ENV'] ?? 'dev'

function getDbPath() {
  const appData = process.env['APPDATA'] || process.env['HOME'] || process.env['USERPROFILE'] || ''
  const base = path.join(appData, '@carniceria', 'desktop')
  return APP_ENV === 'dev' ? path.join(base, 'dev', 'app.sqlite') : path.join(base, 'app.sqlite')
}

function main() {
  const dbPath = getDbPath()
  const db = new Database(dbPath)
  const before = db
    .prepare(`SELECT id, name, plu_number FROM products WHERE active = 0 AND plu_number IS NOT NULL`)
    .all()
  const result = db.prepare(`UPDATE products SET plu_number = NULL WHERE active = 0 AND plu_number IS NOT NULL`).run()
  console.log(`[freeInactivePlus] env=${APP_ENV} db=${dbPath}`)
  console.log(`[freeInactivePlus] liberados: ${result.changes}`)
  for (const row of before) {
    console.log(`  - ${row.name} PLU ${row.plu_number} → null`)
  }
  db.close()
}

main()
