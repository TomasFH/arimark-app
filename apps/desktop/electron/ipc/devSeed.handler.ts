/**
 * Generador de ventas ficticias — SOLO desarrollo (APP_ENV=dev).
 *
 * Crea ventas confirmadas realistas en el turno activo, usando el catálogo real
 * del local (nombres y precios vigentes). Sirve para probar la vista de ventas,
 * el balance en tiempo real y el cierre de caja sin escanear tickets a mano.
 *
 * En producción este handler NO se registra (ver index.ts), por lo que la app
 * de producción nunca puede generar datos ficticios.
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { sales, saleItems, salePayments, products, productPrices } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { IpcResult } from '../../src/types/hw-api'

const generateSalesSchema = z.object({
  count: z.number().int().min(1).max(200),
})

const MIN_TICKET = 6000
const MAX_TICKET = 250000

interface PricedProduct {
  id: string
  name: string
  unit: 'kg' | 'unit'
  price: number
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

/**
 * Peso realista para un producto pesable: casi siempre entre 0,5 y 4 kg,
 * ocasionalmente hasta 8 kg. Nunca ≥ 10 kg. Redondeado a 3 decimales (gramos).
 */
function randomWeightKg(): number {
  const roll = Math.random()
  const kg = roll < 0.85 ? 0.5 + Math.random() * 3.5 : 4 + Math.random() * 4
  return Math.round(kg * 1000) / 1000
}

/** Construye el catálogo con precio vigente en el local. */
function loadPricedProducts(
  db: ReturnType<typeof getDb>,
  storeId: string,
  now: string
): PricedProduct[] {
  const rows = db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      pluNumber: products.pluNumber,
    })
    .from(products)
    .where(isNotNull(products.pluNumber))
    .all()

  const priceRows = db
    .select({
      productId: productPrices.productId,
      price: productPrices.price,
      validFrom: productPrices.validFrom,
    })
    .from(productPrices)
    .where(
      and(
        eq(productPrices.storeId, storeId),
        lte(productPrices.validFrom, now),
        or(isNull(productPrices.validTo), gt(productPrices.validTo, now))
      )
    )
    .all()

  const priceMap = new Map<string, { price: number; validFrom: string }>()
  for (const row of priceRows) {
    const prev = priceMap.get(row.productId)
    if (!prev || row.validFrom > prev.validFrom) {
      priceMap.set(row.productId, { price: row.price, validFrom: row.validFrom })
    }
  }

  const priced: PricedProduct[] = []
  for (const p of rows) {
    const price = priceMap.get(p.id)?.price
    if (price == null || price <= 0) continue
    priced.push({ id: p.id, name: p.name, unit: p.unit, price })
  }
  return priced
}

interface GeneratedItem {
  productId: string
  quantity: number
  unitPrice: number
  subtotal: number
}

/** Arma los ítems de una venta hasta caer en el rango de ticket deseado. */
function buildSaleItems(catalog: PricedProduct[]): GeneratedItem[] {
  const items: GeneratedItem[] = []
  let total = 0
  const maxItems = 8

  while (items.length < maxItems) {
    const product = pickRandom(catalog)
    const quantity = product.unit === 'kg' ? randomWeightKg() : randomInt(1, 5)
    const subtotal = Math.round(product.price * quantity)
    if (subtotal <= 0) continue

    // No superar el máximo salvo que aún no lleguemos al mínimo
    if (total + subtotal > MAX_TICKET && total >= MIN_TICKET) break

    items.push({ productId: product.id, quantity, unitPrice: product.price, subtotal })
    total += subtotal

    // Con el mínimo alcanzado, cortamos de forma probabilística para variar el nº de ítems
    if (total >= MIN_TICKET && Math.random() < 0.55) break
  }

  return items
}

/**
 * Distribuye el total entre medios de pago. Mezcla intencional para probar que
 * la app separa el efectivo de lo digital:
 *  - ~40% ventas 100% efectivo
 *  - ~35% ventas 100% digital (débito/wallet/crédito)
 *  - ~25% ventas combinadas (parte efectivo + parte digital)
 */
function buildPayments(total: number): Array<{ paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit'; amount: number }> {
  const digitalMethods: Array<'debit' | 'wallet' | 'credit'> = ['debit', 'wallet', 'credit']
  const roll = Math.random()

  if (roll < 0.4) {
    return [{ paymentMethod: 'cash', amount: total }]
  }
  if (roll < 0.75) {
    return [{ paymentMethod: pickRandom(digitalMethods), amount: total }]
  }
  // Combinada: entre 30% y 70% en efectivo, resto digital
  const cashPortion = Math.round(total * (0.3 + Math.random() * 0.4))
  const digitalPortion = total - cashPortion
  return [
    { paymentMethod: 'cash', amount: cashPortion },
    { paymentMethod: pickRandom(digitalMethods), amount: digitalPortion },
  ]
}

export function registerDevSeedHandlers(): void {
  ipcMain.handle(IPC.DEV_GENERATE_SALES, (_event, payload: unknown): IpcResult<{ created: number }> => {
    const parsed = generateSalesSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    try {
      const db = getDb()
      const now = new Date().toISOString()
      const catalog = loadPricedProducts(db, session.storeId, now)

      if (catalog.length === 0) {
        return {
          ok: false,
          error: 'No hay productos con precio vigente en el catálogo. Ejecutá el seed primero.',
          code: 'NO_CATALOG',
        }
      }

      let created = 0
      db.transaction(tx => {
        for (let i = 0; i < parsed.data.count; i++) {
          const items = buildSaleItems(catalog)
          if (items.length === 0) continue
          const total = items.reduce((sum, it) => sum + it.subtotal, 0)
          const payments = buildPayments(total)
          const saleId = uuidv4()
          // Distribuir en el tiempo: cada venta unos minutos antes que la anterior
          const createdAt = new Date(Date.now() - i * randomInt(30_000, 300_000)).toISOString()

          tx.insert(sales)
            .values({
              id: saleId,
              storeId: session.storeId,
              shiftId: session.shiftId!,
              customerId: null,
              total,
              isDebt: false,
              status: 'confirmed',
              manualEntry: false,
              manualApprovedBy: null,
              manualApprovedAt: null,
              notes: '[dev] venta de prueba',
              createdAt,
              createdBy: session.userId,
            })
            .run()

          for (const it of items) {
            tx.insert(saleItems)
              .values({
                id: uuidv4(),
                saleId,
                productId: it.productId,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
                notes: null,
              })
              .run()
          }

          for (const p of payments) {
            tx.insert(salePayments)
              .values({
                id: uuidv4(),
                saleId,
                paymentMethod: p.paymentMethod,
                amount: p.amount,
                createdAt,
                createdBy: session.userId,
              })
              .run()
          }

          created++
        }
      })

      log.info('[ipc:dev-generate-sales] Ventas de prueba generadas', { created })
      return { ok: true, data: { created } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('[ipc:dev-generate-sales] Error inesperado', message)
      return { ok: false, error: 'Error al generar ventas de prueba.' }
    }
  })
}
