/**
 * Handler IPC de carga masiva del catálogo a la balanza KRETZ (comando 2005).
 *
 * Flujo (solo admin, con balanza físicamente conectada a esta PC):
 *  1. Verifica el enlace R30 con la balanza (0002). Si no responde, aborta sin
 *     enviar nada — cumple la regla "cargar sí y solo si hay balanza conectada".
 *  2. Lee del catálogo SQLite todos los productos activos con PLU y precio
 *     vigente en el local seleccionado.
 *  3. Envía cada PLU secuencialmente (la cola serial del driver no admite
 *     comandos en paralelo), emitiendo un evento de progreso por cada uno.
 *  4. Devuelve un resumen: enviados OK, fallidos (con motivo) y omitidos
 *     (sin precio o precio fuera de rango).
 *
 * Estrategia de sincronización: upsert. El comando 2005 crea el PLU si no
 * existe y lo sobreescribe si ya existe. Nunca borra PLUs de la balanza que
 * no estén en el catálogo (decisión del desarrollador — no destruir PLUs
 * cargados por otras vías).
 *
 * Conversión de precio: el catálogo guarda pesos enteros. La balanza REPORT NX
 * (visor LCD) usa 6 dígitos con 1 decimal implícito → raw = pesos × 10.
 * Precio máximo: $99.999 (raw 999.990, cabe en 6 dígitos).
 */
import { ipcMain } from 'electron'
import log from 'electron-log'
import { and, asc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { products, productPrices } from '../db/schema'
import type { HardwareManager } from '../hardware/hardwareManager'
import type {
  IpcResult,
  KretzSyncResult,
  KretzSyncProgress,
  KretzSyncFailure,
  KretzSyncSkipped,
} from '../../src/types/hw-api'

/** Precio máximo cargable: 6 dígitos con 1 decimal implícito (raw ≤ 999999). */
const MAX_PESOS = 99999

interface CatalogPluRow {
  pluNumber: number
  name: string
  unit: 'kg' | 'unit'
  price: number | null
}

/**
 * Lee los productos activos con PLU del catálogo, con su precio vigente en el
 * local dado. Ordenados por número de PLU ascendente.
 */
function readCatalogForStore(
  db: ReturnType<typeof getDb>,
  storeId: string
): CatalogPluRow[] {
  const now = new Date().toISOString()

  const productRows = db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      pluNumber: products.pluNumber,
    })
    .from(products)
    .where(and(isNotNull(products.pluNumber), eq(products.active, true)))
    .orderBy(asc(products.pluNumber))
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

  return productRows.map(r => ({
    pluNumber: r.pluNumber as number,
    name: r.name,
    unit: r.unit,
    price: priceMap.get(r.id)?.price ?? null,
  }))
}

export function registerKretzSyncHandler(manager: HardwareManager): void {
  ipcMain.handle(
    IPC.KRETZ_SYNC_CATALOG,
    async (event, storeId: unknown): Promise<IpcResult<KretzSyncResult>> => {
      const parsed = z.string().min(1).safeParse(storeId)
      if (!parsed.success) {
        return { ok: false, error: 'storeId inválido.', code: 'VALIDATION_ERROR' }
      }

      // 1. Verificar enlace R30 antes de tocar nada.
      let linked = false
      try {
        linked = await manager.kretzTestLink()
      } catch (err) {
        log.error('[ipc:kretz-sync-catalog] Error al verificar enlace', err)
        return {
          ok: false,
          error: 'No se pudo comunicar con la balanza. Verificá que esté conectada por USB.',
          code: 'NO_SCALE',
        }
      }
      if (!linked) {
        return {
          ok: false,
          error: 'La balanza no respondió. Conectala por USB y cerrá iTegra u otro programa que use el puerto.',
          code: 'NO_SCALE',
        }
      }

      // 2. Leer catálogo del local.
      let catalog: CatalogPluRow[]
      try {
        catalog = readCatalogForStore(getDb(), parsed.data)
      } catch (err) {
        log.error('[ipc:kretz-sync-catalog] Error al leer catálogo', err)
        return { ok: false, error: 'Error al leer el catálogo.', code: 'DB_ERROR' }
      }

      // 3. Separar los que se pueden enviar de los que se omiten.
      const skipped: KretzSyncSkipped[] = []
      const sendable: CatalogPluRow[] = []
      for (const p of catalog) {
        if (p.price === null || p.price <= 0) {
          skipped.push({ pluNumber: p.pluNumber, name: p.name, reason: 'no_price' })
        } else if (p.price > MAX_PESOS) {
          skipped.push({ pluNumber: p.pluNumber, name: p.name, reason: 'price_too_high' })
        } else {
          sendable.push(p)
        }
      }

      const total = sendable.length
      const failed: KretzSyncFailure[] = []
      let succeeded = 0

      const emit = (progress: KretzSyncProgress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.KRETZ_SYNC_PROGRESS, progress)
        }
      }

      // 4. Enviar secuencialmente.
      for (let i = 0; i < sendable.length; i++) {
        const p = sendable[i]!
        const current = i + 1

        emit({ current, total, pluNumber: p.pluNumber, name: p.name, status: 'sending' })

        try {
          await manager.kretzSendPlu({
            pluNumber: String(p.pluNumber),
            department: '001',
            family: '000',
            name: p.name.slice(0, 26),
            description: p.name.slice(0, 26),
            articleCode: String(p.pluNumber).padStart(5, '0'),
            pesable: p.unit === 'kg',
            // Pesos enteros → raw de la balanza (1 decimal implícito).
            priceCents: p.price! * 10,
            priceDigits: 6,
          })
          succeeded++
          emit({ current, total, pluNumber: p.pluNumber, name: p.name, status: 'ok' })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          failed.push({ pluNumber: p.pluNumber, name: p.name, error: message })
          emit({ current, total, pluNumber: p.pluNumber, name: p.name, status: 'error', error: message })
          log.error('[ipc:kretz-sync-catalog] Fallo al enviar PLU', { plu: p.pluNumber, message })
        }
      }

      log.info('[ipc:kretz-sync-catalog] Carga finalizada', {
        storeId: parsed.data,
        total,
        succeeded,
        failed: failed.length,
        skipped: skipped.length,
      })

      return { ok: true, data: { total, succeeded, failed, skipped } }
    }
  )
}
