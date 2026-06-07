/**
 * CLI wrapper para correr migraciones según APP_ENV.
 * Uso:
 *   pnpm db:migrate:sandbox    → APP_ENV=sandbox
 *   pnpm db:migrate:fieldtest  → APP_ENV=fieldtest
 */
import path from 'path'
import os from 'os'
import fs from 'fs'
import { runMigrations } from './migrate'

const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'

function getDbPath(): string {
  const base = path.join(os.homedir(), 'AppData', 'Roaming', 'carniceria-app')
  if (APP_ENV === 'fieldtest') return path.join(base, 'fieldtest', 'app.sqlite')
  return path.join(base, 'sandbox', 'app.sqlite')
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
