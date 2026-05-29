import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'path'
import * as schema from '../../schema'

/**
 * Crea una instancia SQLite en :memory:, aplica todas las migraciones y
 * retorna el cliente Drizzle listo para usar en tests.
 *
 * Regla: todos los tests que tocan DB usan esta función, nunca la DB real.
 */
export function createInMemoryDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })

  const migrationsFolder = path.resolve(__dirname, '../../../../drizzle')
  migrate(db, { migrationsFolder })

  return { db, sqlite }
}
