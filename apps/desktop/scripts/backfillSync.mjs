/**
 * Backfill de sync a Firestore.
 *
 * Pone syncedAt=null en ventas y turnos confirmados que nunca fueron pusheados
 * (o que se quieren re-pushear con los datos actualizados — ej. cashierName).
 * La app del local los subirá automáticamente la próxima vez que se abra.
 *
 * Uso:
 *   pnpm backfill:sync              → marca ventas + turnos + locales como pendientes
 *   pnpm backfill:sync -- --shifts  → solo turnos
 *   pnpm backfill:sync -- --sales   → solo ventas
 *   pnpm backfill:sync -- --stores  → solo locales
 *
 * Requiere que la app NO esté abierta (para evitar conflictos de lock en SQLite).
 * Usa node:sqlite (Node ≥22) — no depende de better-sqlite3 (ABI de Electron).
 *
 * El push real ocurre cuando la app arranca en APP_ENV=production con Firebase activo.
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const APP_ENV = process.env['APP_ENV'] ?? 'production'

function getDbPath() {
  const userData = path.join(os.homedir(), 'AppData', 'Roaming', '@carniceria', 'desktop')
  return APP_ENV === 'dev'
    ? path.join(userData, 'dev', 'app.sqlite')
    : path.join(userData, 'app.sqlite')
}

const args = new Set(process.argv.slice(2).filter(a => a !== '--'))
const doAll = args.size === 0
const doShifts = doAll || args.has('--shifts')
const doSales  = doAll || args.has('--sales')
const doStores = doAll || args.has('--stores')

const dbPath = getDbPath()
if (!fs.existsSync(dbPath)) {
  console.error(`[backfill] No se encontró la DB en: ${dbPath}`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)

let total = 0

if (doShifts) {
  const r = db.prepare(`UPDATE shifts SET synced_at = NULL WHERE synced_at IS NOT NULL`).run()
  console.log(`[backfill] Turnos marcados para re-sync: ${r.changes}`)
  total += r.changes
}

if (doSales) {
  const r = db.prepare(`UPDATE sales SET synced_at = NULL WHERE status = 'confirmed'`).run()
  console.log(`[backfill] Ventas marcadas para re-sync: ${r.changes}`)
  total += r.changes
}

if (doStores) {
  // La columna synced_at puede no existir aún si la migración 0019 no corrió.
  try {
    const r = db.prepare(`UPDATE stores SET synced_at = NULL WHERE synced_at IS NOT NULL`).run()
    console.log(`[backfill] Locales marcados para re-sync: ${r.changes}`)
    total += r.changes
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('no such column: synced_at')) {
      console.log('[backfill] Locales: columna synced_at aún no existe — se creará al abrir la app (migración 0019).')
    } else {
      throw err
    }
  }
}

db.close()
console.log(`[backfill] Total: ${total} filas marcadas. Abrí la app con pnpm dev:prod para que suban a Firestore.`)
