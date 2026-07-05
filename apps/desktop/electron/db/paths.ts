/**
 * Resolución de rutas de la base de datos SQLite.
 *
 * Electron usa `app.getPath('userData')`, que deriva del `name` de package.json
 * (hoy: `@carniceria/desktop` → `%APPDATA%/@carniceria/desktop`).
 * Los scripts CLI (seed, migrate) deben usar la misma carpeta para no escribir
 * en una DB distinta a la que lee la app en runtime.
 */
import path from 'path'
import os from 'os'
import fs from 'fs'

const APP_ENV = process.env['APP_ENV'] ?? 'dev'

/** Lee el `name` de package.json del paquete desktop (misma regla que Electron). */
export function getElectronUserDataFolderName(): string {
  // process.cwd() = apps/desktop cuando se ejecuta seed/migrate desde pnpm.
  const pkgPath = path.resolve(process.cwd(), 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name: string }
  return pkg.name
}

/** Ruta userData cuando no hay proceso Electron (scripts CLI). */
export function getStandaloneUserDataDir(): string {
  return path.join(os.homedir(), 'AppData', 'Roaming', getElectronUserDataFolderName())
}

export function getDbPathForEnv(appEnv: string = APP_ENV, userDataDir?: string): string {
  const base = userDataDir ?? getStandaloneUserDataDir()
  if (appEnv === 'dev') return path.join(base, 'dev', 'app.sqlite')
  return path.join(base, 'app.sqlite')
}
