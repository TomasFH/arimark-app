/**
 * Seed de datos de prueba para la base de datos de desarrollo.
 * Crea el local de prueba, cajeras, catálogo de productos y precios vigentes.
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

/** Precios de referencia vigentes desde enero 2026 (lista del negocio). */
const PRICES_VALID_FROM = '2026-01-01T00:00:00.000Z'

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
 * Catálogo de productos de prueba con precios de referencia (Enero 2026).
 *
 * Rangos de PLU acordados:
 *   1–99    → Cortes vacunos
 *   100–149 → Pollo y aves
 *   150–199 → Cerdo
 *   200–249 → Embutidos y chacinados
 *   250–299 → Productos especiales (huevos, carbón, leña, etc.)
 *
 * price: precio por kg o por unidad según `unit`. Se inserta en product_prices.
 */
const PRODUCTS = [
  // --- Cortes vacunos (1–99) — precios ref. Enero 2026 ---
  { id: '00000000-0000-0000-0001-000000000001', pluNumber: 1,  name: 'Asado de tira',      category: 'beef_cut', unit: 'kg',   price: 16322 },
  { id: '00000000-0000-0000-0001-000000000002', pluNumber: 2,  name: 'Tapa de asado',       category: 'beef_cut', unit: 'kg',   price: 15200 },
  { id: '00000000-0000-0000-0001-000000000003', pluNumber: 3,  name: 'Vacío',               category: 'beef_cut', unit: 'kg',   price: 19441 },
  { id: '00000000-0000-0000-0001-000000000004', pluNumber: 4,  name: 'Paleta',              category: 'beef_cut', unit: 'kg',   price: 14659 },
  { id: '00000000-0000-0000-0001-000000000005', pluNumber: 5,  name: 'Bife angosto',        category: 'beef_cut', unit: 'kg',   price: 16091 },
  { id: '00000000-0000-0000-0001-000000000006', pluNumber: 6,  name: 'Bife ancho',          category: 'beef_cut', unit: 'kg',   price: 15389 },
  { id: '00000000-0000-0000-0001-000000000007', pluNumber: 7,  name: 'Bola de lomo',        category: 'beef_cut', unit: 'kg',   price: 16594 },
  { id: '00000000-0000-0000-0001-000000000008', pluNumber: 8,  name: 'Cuadril',             category: 'beef_cut', unit: 'kg',   price: 18113 },
  { id: '00000000-0000-0000-0001-000000000009', pluNumber: 9,  name: 'Falda',               category: 'beef_cut', unit: 'kg',   price: 9830  },
  { id: '00000000-0000-0000-0001-000000000010', pluNumber: 10, name: 'Lomo',                category: 'beef_cut', unit: 'kg',   price: 24466 },
  { id: '00000000-0000-0000-0001-000000000011', pluNumber: 11, name: 'Nalga',               category: 'beef_cut', unit: 'kg',   price: 18620 },
  { id: '00000000-0000-0000-0001-000000000012', pluNumber: 12, name: 'Osobuco',             category: 'beef_cut', unit: 'kg',   price: 9379  },
  { id: '00000000-0000-0000-0001-000000000013', pluNumber: 13, name: 'Peceto',              category: 'beef_cut', unit: 'kg',   price: 20846 },
  { id: '00000000-0000-0000-0001-000000000014', pluNumber: 14, name: 'Matambre',            category: 'beef_cut', unit: 'kg',   price: 16846 },
  { id: '00000000-0000-0000-0001-000000000015', pluNumber: 15, name: 'Colita de cuadril',   category: 'beef_cut', unit: 'kg',   price: 20664 },
  { id: '00000000-0000-0000-0001-000000000016', pluNumber: 16, name: 'Roast beef',          category: 'beef_cut', unit: 'kg',   price: 13794 },
  { id: '00000000-0000-0000-0001-000000000017', pluNumber: 17, name: 'Picada común',        category: 'beef_cut', unit: 'kg',   price: 8545  },
  { id: '00000000-0000-0000-0001-000000000018', pluNumber: 18, name: 'Picada especial',     category: 'beef_cut', unit: 'kg',   price: 12504 },
  { id: '00000000-0000-0000-0001-000000000019', pluNumber: 19, name: 'Carnaza común',       category: 'beef_cut', unit: 'kg',   price: 9938  },
  { id: '00000000-0000-0000-0001-000000000020', pluNumber: 20, name: 'Cuadrada',            category: 'beef_cut', unit: 'kg',   price: 16775 },
  { id: '00000000-0000-0000-0001-000000000021', pluNumber: 21, name: 'Tortuguita',          category: 'beef_cut', unit: 'kg',   price: 14179 },
  // --- Pollo y aves (100–149) ---
  { id: '00000000-0000-0000-0001-000000000100', pluNumber: 100, name: 'Pollo',              category: 'poultry',  unit: 'kg',   price: 4069  },
  { id: '00000000-0000-0000-0001-000000000101', pluNumber: 101, name: 'Pechuga de pollo',   category: 'poultry',  unit: 'kg',   price: 4800  },
  { id: '00000000-0000-0000-0001-000000000102', pluNumber: 102, name: 'Muslo de pollo',     category: 'poultry',  unit: 'kg',   price: 4200  },
  { id: '00000000-0000-0000-0001-000000000103', pluNumber: 103, name: 'Alita de pollo',     category: 'poultry',  unit: 'kg',   price: 3900  },
  // --- Cerdo (150–199) ---
  { id: '00000000-0000-0000-0001-000000000150', pluNumber: 150, name: 'Pechito de cerdo',   category: 'pork',     unit: 'kg',   price: 8241  },
  { id: '00000000-0000-0000-0001-000000000151', pluNumber: 151, name: 'Bondiola de cerdo',  category: 'pork',     unit: 'kg',   price: 9000  },
  { id: '00000000-0000-0000-0001-000000000152', pluNumber: 152, name: 'Costilla de cerdo',  category: 'pork',     unit: 'kg',   price: 8500  },
  // --- Embutidos y chacinados (200–249) ---
  { id: '00000000-0000-0000-0001-000000000200', pluNumber: 200, name: 'Hamburguesas caseras', category: 'other',  unit: 'kg',   price: 12697 },
  { id: '00000000-0000-0000-0001-000000000201', pluNumber: 201, name: 'Chorizo',            category: 'other',    unit: 'kg',   price: 11000 },
  { id: '00000000-0000-0000-0001-000000000202', pluNumber: 202, name: 'Morcilla',           category: 'other',    unit: 'kg',   price: 9500  },
  // --- Productos especiales (250–299) ---
  { id: '00000000-0000-0000-0001-000000000250', pluNumber: 250, name: 'Huevos x30',         category: 'other',    unit: 'unit', price: 6000  },
  { id: '00000000-0000-0000-0001-000000000251', pluNumber: 251, name: 'Carbón',             category: 'other',    unit: 'kg',   price: 3500  },
  { id: '00000000-0000-0000-0001-000000000252', pluNumber: 252, name: 'Leña',               category: 'other',    unit: 'kg',   price: 2800  },
  // --- Fallback para PLU no mapeado ---
  { id: '00000000-0000-0000-0001-000000000099', pluNumber: null, name: 'Producto sin identificar', category: 'other', unit: 'kg' },
] as const

async function main() {
  console.log(`[seed] Preparando DB ${APP_ENV} en:`, DB_PATH)

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

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

  // Insertar / actualizar productos
  for (const product of PRODUCTS) {
    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(product.id)
    if (existing) {
      db.prepare(`
        UPDATE products SET plu_number = ?, name = ?, category = ?, unit = ?
        WHERE id = ?
      `).run(product.pluNumber ?? null, product.name, product.category, product.unit, product.id)
      console.log(`[seed] Producto "${product.name}" actualizado`)
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

  // Insertar / actualizar precios vigentes (requiere cajera1 como created_by)
  const seedUser = db.prepare('SELECT id FROM users WHERE username = ?').get('cajera1') as
    | { id: string }
    | undefined

  if (!seedUser) {
    console.warn('[seed] No se encontró cajera1 — precios omitidos')
  } else {
    let priceCount = 0
    for (const product of PRODUCTS) {
      if (!('price' in product) || product.price == null || product.pluNumber == null) continue

      const existingPrice = db.prepare(`
        SELECT id FROM product_prices
        WHERE product_id = ? AND store_id = ? AND valid_to IS NULL
      `).get(product.id, DEFAULT_STORE_ID) as { id: string } | undefined

      if (existingPrice) {
        db.prepare(`
          UPDATE product_prices SET price = ?, valid_from = ? WHERE id = ?
        `).run(product.price, PRICES_VALID_FROM, existingPrice.id)
      } else {
        db.prepare(`
          INSERT INTO product_prices (id, product_id, store_id, price, valid_from, valid_to, created_by)
          VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).run(uuidv4(), product.id, DEFAULT_STORE_ID, product.price, PRICES_VALID_FROM, seedUser.id)
      }
      priceCount++
    }
    console.log(`[seed] ${priceCount} precios vigentes cargados (desde ${PRICES_VALID_FROM.slice(0, 10)})`)
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
