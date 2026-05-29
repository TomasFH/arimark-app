/**
 * CLI wrapper para correr migraciones en sandbox desde la línea de comandos.
 * Uso: pnpm db:migrate:sandbox
 */
import path from 'path'
import os from 'os'
import { runMigrations } from './migrate'

const sandboxDbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'carniceria-app', 'sandbox', 'app.sqlite')
const migrationsFolder = path.resolve(process.cwd(), 'drizzle')

runMigrations(sandboxDbPath, migrationsFolder).then(result => {
  if (result.ok) {
    console.log('[cli] Migraciones aplicadas correctamente')
    process.exit(0)
  } else {
    console.error('[cli] Error en migraciones:', result.error)
    process.exit(1)
  }
})
