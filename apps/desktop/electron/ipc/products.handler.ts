import { ipcMain } from 'electron'
import log from 'electron-log'
import { and, asc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { products, productPrices } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { IpcResult, ProductRow } from '../../src/types/hw-api'

/** Mismo ID que seed-sandbox.ts — fallback si no hay sesión activa. */
const DEFAULT_STORE_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Construye un mapa productId → precio vigente para el local dado.
 * Precio vigente = valid_from <= now AND (valid_to IS NULL OR valid_to > now),
 * desempate por valid_from más reciente.
 */
function buildCurrentPriceMap(
  db: ReturnType<typeof getDb>,
  storeId: string,
  now: string
): Map<string, number> {
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

  const map = new Map<string, { price: number; validFrom: string }>()
  for (const row of priceRows) {
    const prev = map.get(row.productId)
    if (!prev || row.validFrom > prev.validFrom) {
      map.set(row.productId, { price: row.price, validFrom: row.validFrom })
    }
  }

  return new Map([...map.entries()].map(([id, v]) => [id, v.price]))
}

export function registerProductsHandlers(): void {
  /**
   * Retorna productos activos con PLU y precio vigente en el local,
   * ordenados por plu_number ascendente.
   */
  ipcMain.handle(IPC.GET_PRODUCTS, (_event): IpcResult<ProductRow[]> => {
    try {
      const db = getDb()
      const storeId = getActiveSession()?.storeId ?? DEFAULT_STORE_ID
      const now = new Date().toISOString()

      const rows = db
        .select({
          id: products.id,
          name: products.name,
          category: products.category,
          unit: products.unit,
          pluNumber: products.pluNumber,
        })
        .from(products)
        .where(isNotNull(products.pluNumber))
        .orderBy(asc(products.pluNumber))
        .all()

      const priceMap = buildCurrentPriceMap(db, storeId, now)

      return {
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          name: r.name,
          category: r.category,
          unit: r.unit,
          pluNumber: r.pluNumber as number,
          price: priceMap.get(r.id) ?? null,
        })),
      }
    } catch (err) {
      log.error('[ipc:get-products] Error al leer productos', err)
      return { ok: false, error: 'Error al leer el catálogo de productos.', code: 'DB_ERROR' }
    }
  })
}
