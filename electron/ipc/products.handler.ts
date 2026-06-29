import { ipcMain } from 'electron'
import log from 'electron-log'
import { asc, isNotNull } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { products } from '../db/schema'
import type { IpcResult, ProductRow } from '../../src/types/hw-api'

export function registerProductsHandlers(): void {
  /**
   * Retorna todos los productos activos del catálogo local, ordenados por
   * plu_number ascendente (nulos al final).
   *
   * Usado en:
   *   - EmergencyBarcodeInput: autocomplete al ingresar PLU
   *   - Modal de lista de productos en CashierScreen
   */
  ipcMain.handle(IPC.GET_PRODUCTS, (_event): IpcResult<ProductRow[]> => {
    try {
      const db = getDb()
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

      return {
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          name: r.name,
          category: r.category,
          unit: r.unit,
          pluNumber: r.pluNumber as number,
        })),
      }
    } catch (err) {
      log.error('[ipc:get-products] Error al leer productos', err)
      return { ok: false, error: 'Error al leer el catálogo de productos.', code: 'DB_ERROR' }
    }
  })
}
