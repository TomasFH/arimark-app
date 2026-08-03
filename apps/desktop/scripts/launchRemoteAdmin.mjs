/**
 * Lanza Electron con un userData aparte (= “PC de casa” / SQLite vacío)
 * para probar historial admin vía Firestore sin renombrar la DB real.
 *
 * Uso típico:
 *   Terminal 1: pnpm dev:prod
 *   Terminal 2: pnpm electron:remote
 *
 * Perfil: %APPDATA%/@carniceria/desktop-remote-admin
 * Reset:  pnpm electron:remote:reset
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = /** @type {string} */ (require('electron'))

const REMOTE_FOLDER = '@carniceria/desktop-remote-admin'
const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', REMOTE_FOLDER)

const reset = process.argv.includes('--reset')
if (reset) {
  if (fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true })
    console.log(`[remote-admin] Perfil borrado: ${userDataDir}`)
  } else {
    console.log(`[remote-admin] No había perfil en: ${userDataDir}`)
  }
  process.exit(0)
}

fs.mkdirSync(userDataDir, { recursive: true })
console.log(`[remote-admin] userData → ${userDataDir}`)
console.log('[remote-admin] SQLite vacío (o del perfil remote). Login admin + Historial = lectura Firestore.')

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(electronPath, ['.', `--user-data-dir=${userDataDir}`], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Misma semántica que dev:prod — Firebase activo
    APP_ENV: process.env['APP_ENV'] ?? 'production',
    VITE_APP_ENV: process.env['VITE_APP_ENV'] ?? 'production',
    NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
