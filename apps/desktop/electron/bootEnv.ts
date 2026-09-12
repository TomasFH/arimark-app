/**
 * Primer módulo que carga main.ts. En el .exe empaquetado no hay cross-env:
 * sin esto APP_ENV queda en "dev", Firebase apagado y la DB en /dev/.
 *
 * Las claves VITE_FIREBASE_* del main no las inyecta Vite (solo el renderer).
 * En el instalador viven en resources/.env.production (extraResources).
 */
import { app } from 'electron'
import { config as loadDotenv } from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

function resolveProductionEnvFile(): string | null {
  const candidates: string[] = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(path.join(process.resourcesPath, '.env.production'))
  }
  candidates.push(path.resolve(process.cwd(), '.env.production'))
  return candidates.find(p => fs.existsSync(p)) ?? null
}

if (app.isPackaged) {
  process.env['APP_ENV'] = 'production'
  process.env['VITE_APP_ENV'] = 'production'
}

if (process.env['APP_ENV'] === 'production') {
  const envPath = resolveProductionEnvFile()
  if (envPath) {
    loadDotenv({ path: envPath, override: false })
  }
}
