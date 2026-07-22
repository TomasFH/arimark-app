/**
 * Handlers IPC para la administración del catálogo de productos (solo admins).
 *
 * Operaciones disponibles:
 *  - GET_ALL_PRODUCTS  — lista completa (con/sin PLU) + precio y disponibilidad por local
 *  - GET_STORES        — lista de locales del sistema
 *  - CREATE_PRODUCT    — crea un producto nuevo (global)
 *  - UPDATE_PRODUCT    — edita nombre/categoría/unidad/PLU/activo
 *  - SET_PRODUCT_PRICE — cambia el precio vigente en un local (transacción atómica)
 *  - SET_PRODUCT_AVAILABILITY — toggle disponibilidad en un local
 *
 * Regla de precios: el precio vigente se gestiona con fechas de validez
 * (valid_from / valid_to). Cambiar el precio NO sobreescribe la fila existente:
 * cierra la fila actual (pone valid_to = now) e inserta una fila nueva. Si
 * `price === 0` solo cierra el precio vigente (producto queda sin precio).
 */
import { ipcMain } from 'electron'
import log from 'electron-log'
import { and, asc, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { products, productPrices, storeProducts, stores, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { publishCatalog } from '../licensing/catalogPublish'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, AdminProductRow, StoreRow, PriceHistoryRow } from '../../src/types/hw-api'

// ---------------------------------------------------------------------------
// Schemas de validación Zod
// ---------------------------------------------------------------------------

const categoryEnum = z.enum(['beef_cut', 'poultry', 'pork', 'other'])
const unitEnum = z.enum(['kg', 'unit'])

const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  category: categoryEnum,
  unit: unitEnum,
  pluNumber: z.number().int().min(1).max(999).nullable(),
})

const updateProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  category: categoryEnum.optional(),
  unit: unitEnum.optional(),
  pluNumber: z.number().int().min(1).max(999).nullable().optional(),
  active: z.boolean().optional(),
})

const setProductPriceSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  price: z.number().int().min(0),
})

const setProductAvailabilitySchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  available: z.boolean(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Devuelve el precio vigente para cada productId en un local dado.
 * Precio vigente: valid_from <= now AND (valid_to IS NULL OR valid_to > now).
 * Si hay duplicados (no debería), gana el más reciente por valid_from.
 */
function buildCurrentPriceMap(
  db: ReturnType<typeof getDb>,
  storeId: string,
  now: string
): Map<string, number> {
  const rows = db
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
  for (const row of rows) {
    const prev = map.get(row.productId)
    if (!prev || row.validFrom > prev.validFrom) {
      map.set(row.productId, { price: row.price, validFrom: row.validFrom })
    }
  }

  return new Map([...map.entries()].map(([id, v]) => [id, v.price]))
}

/**
 * Dispara la publicación del catálogo al Firestore del local dado.
 * No bloquea — los errores se loguean pero no se propagan al renderer.
 */
async function triggerCatalogPublish(storeId: string): Promise<void> {
  try {
    const { license_key } = getBusinessConfig()
    await publishCatalog(license_key, storeId)
  } catch (err) {
    log.warn('[catalog-admin] No se pudo republicar el catálogo a Firestore:', err)
  }
}

// ---------------------------------------------------------------------------
// Registro de handlers
// ---------------------------------------------------------------------------

export function registerCatalogAdminHandlers(): void {

  // ---- GET_STORES ----
  ipcMain.handle(IPC.GET_STORES, (_event): IpcResult<StoreRow[]> => {
    try {
      const db = getDb()
      const rows = db
        .select({ id: stores.id, name: stores.name, address: stores.address })
        .from(stores)
        .orderBy(asc(stores.name))
        .all()
      return { ok: true, data: rows }
    } catch (err) {
      log.error('[ipc:get-stores] Error', err)
      return { ok: false, error: 'Error al leer los locales.', code: 'DB_ERROR' }
    }
  })

  // ---- GET_ALL_PRODUCTS ----
  ipcMain.handle(IPC.GET_ALL_PRODUCTS, (_event, storeId: unknown): IpcResult<AdminProductRow[]> => {
    const parsed = z.string().min(1).safeParse(storeId)
    if (!parsed.success) {
      return { ok: false, error: 'storeId inválido.', code: 'VALIDATION_ERROR' }
    }

    try {
      const db = getDb()
      const now = new Date().toISOString()

      const productRows = db
        .select({
          id: products.id,
          name: products.name,
          category: products.category,
          unit: products.unit,
          pluNumber: products.pluNumber,
          active: products.active,
        })
        .from(products)
        .orderBy(asc(products.pluNumber), asc(products.name))
        .all()

      const priceMap = buildCurrentPriceMap(db, parsed.data, now)

      // Mapa de disponibilidad en el local dado
      const availRows = db
        .select({ productId: storeProducts.productId, available: storeProducts.available })
        .from(storeProducts)
        .where(eq(storeProducts.storeId, parsed.data))
        .all()
      const availMap = new Map(availRows.map(r => [r.productId, r.available]))

      return {
        ok: true,
        data: productRows.map(r => ({
          id: r.id,
          name: r.name,
          category: r.category,
          unit: r.unit,
          pluNumber: r.pluNumber ?? null,
          active: r.active,
          price: priceMap.get(r.id) ?? null,
          // Si no hay fila en store_products, se considera disponible por defecto
          available: availMap.get(r.id) ?? true,
        })),
      }
    } catch (err) {
      log.error('[ipc:get-all-products] Error', err)
      return { ok: false, error: 'Error al leer el catálogo.', code: 'DB_ERROR' }
    }
  })

  // ---- CREATE_PRODUCT ----
  ipcMain.handle(IPC.CREATE_PRODUCT, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = createProductSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:create-product] Payload inválido', parsed.error.flatten())
      return { ok: false, error: 'Datos del producto inválidos.', code: 'VALIDATION_ERROR' }
    }

    try {
      const db = getDb()
      const { name, category, unit, pluNumber } = parsed.data

      // Verificar PLU único si se proporcionó
      if (pluNumber !== null) {
        const existing = db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.pluNumber, pluNumber))
          .get()
        if (existing) {
          return { ok: false, error: `El PLU ${pluNumber} ya está en uso por "${existing.name}".`, code: 'PLU_CONFLICT' }
        }
      }

      const id = uuidv4()
      db.insert(products).values({
        id,
        name,
        category,
        unit,
        pluNumber: pluNumber ?? undefined,
        active: true,
        createdAt: new Date().toISOString(),
      }).run()

      log.info(`[catalog-admin] Producto creado: ${name} (PLU ${pluNumber ?? '-'})`)
      return { ok: true, data: { id } }
    } catch (err) {
      log.error('[ipc:create-product] Error', err)
      return { ok: false, error: 'Error al crear el producto.', code: 'DB_ERROR' }
    }
  })

  // ---- UPDATE_PRODUCT ----
  ipcMain.handle(IPC.UPDATE_PRODUCT, (_event, payload: unknown): IpcResult => {
    const parsed = updateProductSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:update-product] Payload inválido', parsed.error.flatten())
      return { ok: false, error: 'Datos del producto inválidos.', code: 'VALIDATION_ERROR' }
    }

    const { id, pluNumber, ...fields } = parsed.data
    // Nada que actualizar
    if (Object.keys(fields).length === 0 && pluNumber === undefined) {
      return { ok: true, data: undefined }
    }

    try {
      const db = getDb()

      // Verificar que el producto existe
      const existing = db.select({ id: products.id }).from(products).where(eq(products.id, id)).get()
      if (!existing) {
        return { ok: false, error: 'Producto no encontrado.', code: 'NOT_FOUND' }
      }

      // Verificar PLU único si se cambia
      if (pluNumber !== undefined && pluNumber !== null) {
        const conflict = db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(eq(products.pluNumber, pluNumber)))
          .get()
        if (conflict && conflict.id !== id) {
          return { ok: false, error: `El PLU ${pluNumber} ya está en uso por "${conflict.name}".`, code: 'PLU_CONFLICT' }
        }
      }

      const updateData: Record<string, unknown> = { ...fields }
      if (pluNumber !== undefined) {
        updateData['pluNumber'] = pluNumber ?? null
      }

      db.update(products).set(updateData).where(eq(products.id, id)).run()
      log.info(`[catalog-admin] Producto actualizado: ${id}`)
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:update-product] Error', err)
      return { ok: false, error: 'Error al actualizar el producto.', code: 'DB_ERROR' }
    }
  })

  // ---- SET_PRODUCT_PRICE ----
  ipcMain.handle(IPC.SET_PRODUCT_PRICE, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = setProductPriceSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:set-product-price] Payload inválido', parsed.error.flatten())
      return { ok: false, error: 'Datos de precio inválidos.', code: 'VALIDATION_ERROR' }
    }

    const { productId, storeId, price } = parsed.data
    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'Sin sesión activa.', code: 'UNAUTHORIZED' }
    }

    try {
      const db = getDb()
      const now = new Date().toISOString()

      // Transacción atómica: cerrar precio vigente + insertar nuevo (si price > 0)
      db.transaction(tx => {
        // Cerrar todos los precios vigentes para este producto+local
        const vigentes = tx
          .select({ id: productPrices.id })
          .from(productPrices)
          .where(
            and(
              eq(productPrices.productId, productId),
              eq(productPrices.storeId, storeId),
              lte(productPrices.validFrom, now),
              or(isNull(productPrices.validTo), gt(productPrices.validTo, now))
            )
          )
          .all()

        for (const v of vigentes) {
          tx.update(productPrices).set({ validTo: now }).where(eq(productPrices.id, v.id)).run()
        }

        if (price > 0) {
          tx.insert(productPrices).values({
            id: uuidv4(),
            productId,
            storeId,
            price,
            validFrom: now,
            validTo: null,
            createdBy: session.userId,
            syncedAt: null,
          }).run()
        }
      })

      log.info(`[catalog-admin] Precio actualizado: producto=${productId} local=${storeId} precio=${price}`)

      // Republicar catálogo en background
      void triggerCatalogPublish(storeId)

      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:set-product-price] Error', err)
      return { ok: false, error: 'Error al cambiar el precio.', code: 'DB_ERROR' }
    }
  })

  // ---- SET_PRODUCT_AVAILABILITY ----
  ipcMain.handle(IPC.SET_PRODUCT_AVAILABILITY, (_event, payload: unknown): IpcResult => {    const parsed = setProductAvailabilitySchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:set-product-availability] Payload inválido', parsed.error.flatten())
      return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }

    const { productId, storeId, available } = parsed.data

    try {
      const db = getDb()

      // Upsert en store_products
      const existing = db
        .select({ productId: storeProducts.productId })
        .from(storeProducts)
        .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
        .get()

      if (existing) {
        db.update(storeProducts)
          .set({ available })
          .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
          .run()
      } else {
        db.insert(storeProducts).values({ storeId, productId, available }).run()
      }

      log.info(`[catalog-admin] Disponibilidad: producto=${productId} local=${storeId} disponible=${available}`)
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:set-product-availability] Error', err)
      return { ok: false, error: 'Error al cambiar la disponibilidad.', code: 'DB_ERROR' }
    }
  })

  // ---- GET_PRODUCT_PRICE_HISTORY ----
  ipcMain.handle(IPC.GET_PRODUCT_PRICE_HISTORY, (_event, payload: unknown): IpcResult<PriceHistoryRow[]> => {
    const schema = z.object({ productId: z.string().min(1), storeId: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'VALIDATION_ERROR' }
    }

    try {
      const db = getDb()
      const rows = db
        .select({
          id: productPrices.id,
          price: productPrices.price,
          validFrom: productPrices.validFrom,
          validTo: productPrices.validTo,
          createdBy: productPrices.createdBy,
        })
        .from(productPrices)
        .where(
          and(
            eq(productPrices.productId, parsed.data.productId),
            eq(productPrices.storeId, parsed.data.storeId)
          )
        )
        .orderBy(desc(productPrices.validFrom))
        .all()

      // Enriquecer con el nombre del usuario que hizo el cambio
      const userIds = [...new Set(rows.map(r => r.createdBy))]
      const userRows = userIds.length > 0
        ? db.select({ id: users.id, name: users.name }).from(users)
            .where(or(...userIds.map(id => eq(users.id, id))))
            .all()
        : []
      const userMap = new Map(userRows.map(u => [u.id, u.name]))

      return {
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          price: r.price,
          validFrom: r.validFrom,
          validTo: r.validTo ?? null,
          createdBy: userMap.get(r.createdBy) ?? r.createdBy,
        })),
      }
    } catch (err) {
      log.error('[ipc:get-product-price-history] Error', err)
      return { ok: false, error: 'Error al leer el historial de precios.', code: 'DB_ERROR' }
    }
  })
}
