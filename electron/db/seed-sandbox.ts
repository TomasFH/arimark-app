/**
 * Seed de datos de prueba para la base de datos sandbox.
 * Crea el local de prueba y las cajeras con credenciales de prueba.
 *
 * Uso: pnpm seed:sandbox
 *
 * ADMINS: En modo sandbox el login de admin acepta cualquier email y contraseña.
 * No es necesario crearlos en la DB — usan Firebase Auth (o el bypass de sandbox).
 */

import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { runMigrations } from './migrate'

const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'carniceria-app', 'sandbox', 'app.sqlite')
const DEFAULT_STORE_ID = '00000000-0000-0000-0000-000000000001'

const STORE = {
  id: DEFAULT_STORE_ID,
  name: 'Local de Prueba (Sandbox)',
  address: 'Dirección de prueba',
}

const CASHIERS = [
  { name: 'Cajera Uno',   username: 'cajera1', password: 'cajera1234' },
  { name: 'Cajera Dos',   username: 'cajera2', password: 'cajera1234' },
  { name: 'Cajera Tres',  username: 'cajera3', password: 'cajera1234' },
]

async function main() {
  console.log('[seed] Preparando DB sandbox en:', DB_PATH)

  // Asegurarse de que el directorio existe
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

  // Correr migraciones para crear las tablas si no existen
  const migrate = await runMigrations(DB_PATH)
  if (!migrate.ok) {
    console.error('[seed] Error al preparar la DB:', migrate.error)
    process.exit(1)
  }

  const db = new Database(DB_PATH)

  // Insertar store si no existe
  const existingStore = db.prepare('SELECT id FROM stores WHERE id = ?').get(DEFAULT_STORE_ID)
  if (!existingStore) {
    db.prepare(`
      INSERT INTO stores (id, name, address, created_at)
      VALUES (?, ?, ?, ?)
    `).run(STORE.id, STORE.name, STORE.address, new Date().toISOString())
    console.log(`[seed] Local creado: "${STORE.name}"`)
  } else {
    console.log(`[seed] Local ya existía — omitido`)
  }

  // Insertar cajeras
  for (const cashier of CASHIERS) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cashier.username)
    if (existing) {
      console.log(`[seed] Usuario "${cashier.username}" ya existía — omitido`)
      continue
    }

    const passwordHash = await bcrypt.hash(cashier.password, 10)
    db.prepare(`
      INSERT INTO users (id, store_id, name, username, password, role, active, created_at)
      VALUES (?, ?, ?, ?, ?, 'cashier', 1, ?)
    `).run(uuidv4(), DEFAULT_STORE_ID, cashier.name, cashier.username, passwordHash, new Date().toISOString())

    console.log(`[seed] Cajera creada: "${cashier.username}" (contraseña: ${cashier.password})`)
  }

  db.close()

  console.log('\n[seed] ✓ Seed completado.')
  console.log('\n─── Accesos de prueba ──────────────────────────────')
  console.log('  Cajeras (pestaña "Cajera"):')
  for (const c of CASHIERS) {
    console.log(`    usuario: ${c.username.padEnd(10)} contraseña: ${c.password}`)
  }
  console.log('\n  Admins (pestaña "Administrador"):')
  console.log('    En modo sandbox cualquier email y contraseña funcionan.')
  console.log('    Ejemplo: admin@prueba.com / admin1234')
  console.log('────────────────────────────────────────────────────\n')
}

main().catch(err => {
  console.error('[seed] Error inesperado:', err)
  process.exit(1)
})
