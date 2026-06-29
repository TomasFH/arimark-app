/**
 * Seed de datos de prueba para la base de datos de desarrollo.
 * Crea el local de prueba y las cajeras con credenciales de prueba.
 *
 * Uso:
 *   pnpm seed:dev    → APP_ENV=dev  → userData/dev/app.sqlite
 *
 * ADMINS: En modo dev el login de admin acepta cualquier email y contraseña.
 * No es necesario crearlos en la DB — usan Firebase Auth (o el bypass local).
 */

import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { runMigrations } from './migrate'

const APP_ENV = process.env['APP_ENV'] ?? 'dev'

function getDbPath(): string {
  const base = path.join(os.homedir(), 'AppData', 'Roaming', 'carniceria-app')
  if (APP_ENV === 'dev') return path.join(base, 'dev', 'app.sqlite')
  return path.join(base, 'app.sqlite')
}

const DB_PATH = getDbPath()
const DEFAULT_STORE_ID = '00000000-0000-0000-0000-000000000001'

const STORE = {
  id: DEFAULT_STORE_ID,
  name: 'Local de Prueba (Dev)',
  address: 'Dirección de prueba',
}

const CASHIERS = [
  { name: 'Cajera Uno',   username: 'cajera1', password: 'cajera1234' },
  { name: 'Cajera Dos',   username: 'cajera2', password: 'cajera1234' },
  { name: 'Cajera Tres',  username: 'cajera3', password: 'cajera1234' },
]

/**
 * Catálogo de productos de prueba.
 *
 * Rangos de PLU acordados:
 *   1–99    → Cortes vacunos
 *   100–149 → Pollo y aves
 *   150–199 → Cerdo
 *   200–249 → Embutidos y chacinados
 *   250–299 → Productos especiales (huevos, carbón, leña, etc.)
 *   300+    → Reservado / uso libre
 *
 * unit: 'kg' para productos vendidos por peso, 'unit' para unidades.
 * Los precios NO están en la DB de productos — se configuran en product_prices.
 * Los cortes confirmados el 29/06/2026 (barcodes del ticket real):
 *   PLU 1 = Huevos x30, PLU 2 = Huevos x30 ofer, PLU 5 = Vacío x2
 * Se usan aquí como base; los nombres/precios se actualizarán con datos reales.
 */
const PRODUCTS = [
  // --- Cortes vacunos (1–99) ---
  { id: '00000000-0000-0000-0001-000000000001', pluNumber: 1,  name: 'Asado',              category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000002', pluNumber: 2,  name: 'Asado (oferta)',      category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000003', pluNumber: 3,  name: 'Vacío',               category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000004', pluNumber: 4,  name: 'Paleta',              category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000005', pluNumber: 5,  name: 'Vacío (oferta)',      category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000006', pluNumber: 6,  name: 'Costilla',            category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000007', pluNumber: 7,  name: 'Bife de chorizo',     category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000008', pluNumber: 8,  name: 'Lomo',                category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000009', pluNumber: 9,  name: 'Nalga',               category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000010', pluNumber: 10, name: 'Peceto',              category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000011', pluNumber: 11, name: 'Matambre',            category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000012', pluNumber: 12, name: 'Cuadril',             category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000013', pluNumber: 13, name: 'Osobuco',             category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000014', pluNumber: 14, name: 'Falda',               category: 'beef_cut', unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000015', pluNumber: 15, name: 'Bola de lomo',        category: 'beef_cut', unit: 'kg'   },
  // --- Pollo y aves (100–149) ---
  { id: '00000000-0000-0000-0001-000000000100', pluNumber: 100, name: 'Pollo entero',       category: 'poultry',  unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000101', pluNumber: 101, name: 'Pechuga de pollo',   category: 'poultry',  unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000102', pluNumber: 102, name: 'Muslo de pollo',     category: 'poultry',  unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000103', pluNumber: 103, name: 'Alita de pollo',     category: 'poultry',  unit: 'kg'   },
  // --- Cerdo (150–199) ---
  { id: '00000000-0000-0000-0001-000000000150', pluNumber: 150, name: 'Bondiola de cerdo',  category: 'pork',     unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000151', pluNumber: 151, name: 'Costilla de cerdo',  category: 'pork',     unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000152', pluNumber: 152, name: 'Paleta de cerdo',    category: 'pork',     unit: 'kg'   },
  // --- Embutidos y chacinados (200–249) ---
  { id: '00000000-0000-0000-0001-000000000200', pluNumber: 200, name: 'Chorizo',            category: 'other',    unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000201', pluNumber: 201, name: 'Morcilla',           category: 'other',    unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000202', pluNumber: 202, name: 'Salchicha',          category: 'other',    unit: 'kg'   },
  // --- Productos especiales (250–299) ---
  { id: '00000000-0000-0000-0001-000000000250', pluNumber: 250, name: 'Huevos x30',         category: 'other',    unit: 'unit' },
  { id: '00000000-0000-0000-0001-000000000251', pluNumber: 251, name: 'Carbón',             category: 'other',    unit: 'kg'   },
  { id: '00000000-0000-0000-0001-000000000252', pluNumber: 252, name: 'Leña',               category: 'other',    unit: 'kg'   },
  // --- Fallback para PLU no mapeado ---
  { id: '00000000-0000-0000-0001-000000000099', pluNumber: null, name: 'Producto sin identificar', category: 'other', unit: 'kg' },
] as const

async function main() {
  console.log(`[seed] Preparando DB ${APP_ENV} en:`, DB_PATH)

  // Asegurarse de que el directorio existe
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

  // Correr migraciones para crear las tablas si no existen.
  // El folder drizzle/ está en la raíz del repo (cwd del script pnpm),
  // independientemente de si este archivo corre desde fuente o compilado.
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle')
  const migrate = await runMigrations(DB_PATH, migrationsFolder)
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

  // Insertar productos
  for (const product of PRODUCTS) {
    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(product.id)
    if (existing) {
      // Actualizar plu_number si cambió (permite re-ejecutar seed sin borrar)
      db.prepare('UPDATE products SET plu_number = ? WHERE id = ?')
        .run(product.pluNumber ?? null, product.id)
      console.log(`[seed] Producto "${product.name}" ya existía — plu_number actualizado`)
    } else {
      db.prepare(`
        INSERT INTO products (id, name, category, unit, plu_number, active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(
        product.id,
        product.name,
        product.category,
        product.unit,
        product.pluNumber ?? null,
        new Date().toISOString(),
      )
      const pluStr = product.pluNumber != null ? `PLU ${product.pluNumber}` : 'sin PLU'
      console.log(`[seed] Producto creado: "${product.name}" (${pluStr})`)
    }
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
  console.log(`    En modo ${APP_ENV} cualquier email y contraseña funcionan.`)
  console.log('    Ejemplo: admin@prueba.com / admin1234')
  console.log('────────────────────────────────────────────────────\n')
}

main().catch(err => {
  console.error('[seed] Error inesperado:', err)
  process.exit(1)
})
