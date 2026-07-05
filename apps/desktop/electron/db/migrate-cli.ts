/**
 * CLI wrapper para correr migraciones según APP_ENV.
 * Uso:
 *   pnpm db:migrate:dev    → APP_ENV=dev
 */
import path from 'path'
import fs from 'fs'
import { runMigrations } from './migrate'
import { getDbPathForEnv } from './paths'

const APP_ENV = process.env['APP_ENV'] ?? 'dev'

function getDbPath(): string {
  return getDbPathForEnv(APP_ENV)
}

const dbPath = getDbPath()
const migrationsFolder = path.resolve(process.cwd(), 'drizzle')

// Asegurarse de que el directorio existe
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

runMigrations(dbPath, migrationsFolder).then(result => {
  if (result.ok) {
    console.log('[cli] Migraciones aplicadas correctamente')
    process.exit(0)
  } else {
    console.error('[cli] Error en migraciones:', result.error)
    process.exit(1)
  }
})
