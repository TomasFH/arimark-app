/**
 * Seed de datos de prueba para la base de datos.
 * Crea el local, catálogo de productos y precios vigentes.
 *
 * Uso:
 *   pnpm seed:dev   → APP_ENV=dev        → userData/dev/app.sqlite
 *   pnpm seed:prod  → APP_ENV=production → userData/app.sqlite
 *                     (store_id leído de config/business.json)
 *
 * ⚠️  seed:prod es SOLO para testing. Borrar los datos antes del primer
 *     turno real (o simplemente no ejecutarlo si la DB ya tiene datos reales).
 *
 * LOGIN: en modo dev Firebase Auth está desactivado (bypass). En modo
 * producción se necesitan credenciales reales de Firebase.
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { runMigrations } from './migrate'
import { getDbPathForEnv } from './paths'

const APP_ENV = process.env['APP_ENV'] ?? 'dev'

function getDbPath(): string {
  return getDbPathForEnv(APP_ENV)
}

function getDefaultStoreId(): string {
  if (APP_ENV === 'dev') return '00000000-0000-0000-0000-000000000001'

  // En producción, leer el store_id real de config/business.json
  const configPath = path.resolve(process.cwd(), 'config', 'business.json')
  if (!fs.existsSync(configPath)) {
    console.error('[seed] No se encontró config/business.json — necesario para seed:prod')
    process.exit(1)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    default_store_id?: string
  }
  if (!config.default_store_id) {
    console.error('[seed] business.json no tiene default_store_id')
    process.exit(1)
  }
  return config.default_store_id
}

const DB_PATH = getDbPath()
const DEFAULT_STORE_ID = getDefaultStoreId()

/** Precios de referencia vigentes desde enero 2026 (lista del negocio). */
const PRICES_VALID_FROM = '2026-01-01T00:00:00.000Z'

const STORE = {
  id: DEFAULT_STORE_ID,
  name: APP_ENV === 'dev' ? 'Local de Prueba (Dev)' : 'Local principal',
  address: APP_ENV === 'dev' ? 'Dirección de prueba' : '',
}

/**
 * Perfil local fijo usado solo como `created_by` de los precios sembrados.
 * En dev coincide con el uid del bypass. En producción es un UID sintético
 * que solo cumple el rol de FK — no corresponde a ningún usuario real.
 */
const SEED_PROFILE = {
  id: APP_ENV === 'dev'
    ? 'dev-cashier-cajera1@dev.local'
    : 'seed-system-user-production-0000001',
  name: APP_ENV === 'dev' ? 'Cajera Uno (dev)' : 'Sistema (seed)',
}

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

  if (APP_ENV !== 'dev') {
    console.warn('\n⚠️  ATENCIÓN: Estás sembrando la base de datos de PRODUCCIÓN.')
    console.warn('   Esto es solo para testing. Borrá los datos antes del primer turno real.\n')
  }

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

  // Insertar perfil local fijo (created_by de los precios sembrados)
  const existingProfile = db.prepare('SELECT id FROM users WHERE id = ?').get(SEED_PROFILE.id)
  if (!existingProfile) {
    db.prepare(`
      INSERT INTO users (id, store_id, name, firebase_uid, role, active, created_at)
      VALUES (?, ?, ?, ?, 'cashier', 1, ?)
    `).run(SEED_PROFILE.id, DEFAULT_STORE_ID, SEED_PROFILE.name, SEED_PROFILE.id, new Date().toISOString())
    console.log(`[seed] Perfil local creado: "${SEED_PROFILE.name}"`)
  } else {
    console.log(`[seed] Perfil local ya existía — omitido`)
  }

  // Insertar / actualizar precios vigentes (requiere el perfil sembrado como created_by)
  const seedUser = db.prepare('SELECT id FROM users WHERE id = ?').get(SEED_PROFILE.id) as
    | { id: string }
    | undefined

  if (!seedUser) {
    console.warn('[seed] No se encontró el perfil sembrado — precios omitidos')
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
  if (APP_ENV === 'dev') {
    console.log('\n─── Accesos de prueba ──────────────────────────────')
    console.log(`  En modo ${APP_ENV}, Firebase Auth está desactivado: tanto`)
    console.log('  cajeras como admins pueden loguearse con CUALQUIER email y')
    console.log('  contraseña. El perfil local de cajera se crea solo al')
    console.log('  primer login (ver electron/ipc/auth.handler.ts).')
    console.log('\n  Cajera de ejemplo (botón "Saltar login"):')
    console.log('    email: cajera1@dev.local   contraseña: cajera1234')
    console.log('\n  Admin de ejemplo:')
    console.log('    email: admin@prueba.com   contraseña: admin1234')
    console.log('────────────────────────────────────────────────────\n')
  } else {
    console.log('\n  DB de producción sembrada con catálogo de prueba.')
    console.log(`  Store ID: ${DEFAULT_STORE_ID}`)
    console.log('  Iniciá la app con pnpm dev:prod y loguéate con Firebase Auth.')
    console.log('  ⚠️  Recordá borrar estos datos antes del primer turno real.\n')
  }
}

main().catch(err => {
  console.error('[seed] Error inesperado:', err)
  process.exit(1)
})
