import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { migrate } from 'drizzle-orm/sql-js/migrator'
import path from 'path'
import * as schema from '../../schema'

/**
 * Crea una instancia SQLite :memory: via sql.js (puro JS/WASM, sin módulo nativo).
 * Esto permite que los tests corran con cualquier versión de Node.js
 * independientemente del ABI de Electron.
 *
 * Regla: todos los tests que tocan DB usan esta función, nunca la DB real.
 */
export async function createInMemoryDb() {
  const sqlJsDir = path.dirname(require.resolve('sql.js'))
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.resolve(sqlJsDir, file),
  })
  const sqliteDb = new SQL.Database()

  sqliteDb.run('PRAGMA journal_mode = WAL')
  sqliteDb.run('PRAGMA foreign_keys = ON')

  const db = drizzle(sqliteDb, { schema })

  const migrationsFolder = path.resolve(__dirname, '../../../../drizzle')
  migrate(db, { migrationsFolder })

  return { db, sqlite: new SqliteShim(sqliteDb) }
}

/**
 * Shim mínimo que expone la API de better-sqlite3 usada en los tests
 * sobre un objeto sql.js Database. Solo implementa los métodos necesarios.
 */
class SqliteShim {
  constructor(private readonly db: InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>) {}

  prepare(sql: string) {
    const db = this.db
    return {
      all(...params: (string | number | null | Uint8Array)[]): Record<string, unknown>[] {
        const stmt = db.prepare(sql)
        if (params.length > 0) stmt.bind(params)
        const rows: Record<string, unknown>[] = []
        while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>)
        stmt.free()
        return rows
      },
      get(...params: (string | number | null | Uint8Array)[]): Record<string, unknown> | undefined {
        const stmt = db.prepare(sql)
        if (params.length > 0) stmt.bind(params)
        const hasRow = stmt.step()
        const result = hasRow ? (stmt.getAsObject() as Record<string, unknown>) : undefined
        stmt.free()
        return result
      },
    }
  }
}
