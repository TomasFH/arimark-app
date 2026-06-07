import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import path from 'path'
import log from 'electron-log'
import * as schema from './schema'

const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'

export function getDbPath(): string {
  const userDataDir = app.getPath('userData')
  if (APP_ENV === 'sandbox') {
    return path.join(userDataDir, 'sandbox', 'app.sqlite')
  }
  if (APP_ENV === 'fieldtest') {
    return path.join(userDataDir, 'fieldtest', 'app.sqlite')
  }
  return path.join(userDataDir, 'app.sqlite')
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _sqlite: Database.Database | null = null

export function getDb() {
  if (!_db) {
    throw new Error('[db] La base de datos no fue inicializada. Llamar initDb() primero.')
  }
  return _db
}

export function initDb(dbPath?: string): ReturnType<typeof drizzle<typeof schema>> {
  const resolvedPath = dbPath ?? getDbPath()
  log.info('[db] Abriendo base de datos', resolvedPath)

  const sqlite = new Database(resolvedPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  _sqlite = sqlite
  _db = drizzle(sqlite, { schema })
  return _db
}

export function getRawSqlite(): Database.Database {
  if (!_sqlite) throw new Error('[db] SQLite no inicializado.')
  return _sqlite
}

export function closeDb(): void {
  _sqlite?.close()
  _sqlite = null
  _db = null
}
