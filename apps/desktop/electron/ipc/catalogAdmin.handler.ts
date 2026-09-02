/**
 * Handlers IPC para la administración del catálogo de productos.
 *
 * Admin y cajera pueden crear/editar ficha y precios. Cajera: solo su local.
 * Baja global (`active: false`) y versiones: solo admin.
 *
 * Operaciones:
 *  - GET_ALL_PRODUCTS  — lista completa (con/sin PLU) + precio y disponibilidad por local
 *  - GET_STORES        — lista de locales del sistema
 *  - CREATE_PRODUCT    — crea un producto nuevo (global)
 *  - UPDATE_PRODUCT    — edita nombre/categoría/unidad/PLU; active:false solo admin
 *  - SET_PRODUCT_PRICE — cambia el precio vigente en un local (transacción atómica)
 *  - SET_PRODUCT_PRICES — cambia varios precios del mismo local en una transacción (Editar precios)
 *  - SET_PRODUCT_AVAILABILITY — toggle disponibilidad en un local
 *  - LIST_CATALOG_AUDIT — alta / ficha / visibilidad / retiro global
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
import { products, productPrices, storeProducts, stores, users, catalogAuditEvents } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { ActiveSession } from '../activeSession'
import { publishCatalog, scheduleCatalogPublish, scheduleCatalogPublishForAllStores, listCatalogRevisions, restoreCatalogRevision } from '../licensing/catalogPublish'
import { pullCatalogFromFirestore } from '../licensing/catalogSync'
import { notifyRenderer } from '../licensing/notifyRenderer'
import { getBusinessConfig } from '../businessConfig'
import type { IpcResult, AdminProductRow, StoreRow, PriceHistoryRow, CatalogRevisionRow, CatalogAuditRow, CatalogAuditAction } from '../../src/types/hw-api'

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

const setProductPricesSchema = z.object({
  storeId: z.string().min(1),
  items: z.array(z.object({
    productId: z.string().min(1),
    price: z.number().int().min(0),
  })).min(1).max(200),
})

const setProductAvailabilitySchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  available: z.boolean(),
})

const listCatalogRevisionsSchema = z.object({
  storeId: z.string().min(1),
})

const restoreCatalogRevisionSchema = z.object({
  storeId: z.string().min(1),
  revisionId: z.string().min(1),
})

const listCatalogAuditSchema = z.object({
  productId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
})

const CATEGORY_LABELS: Record<z.infer<typeof categoryEnum>, string> = {
  beef_cut: 'vacuno',
  poultry: 'aves',
  pork: 'cerdo',
  other: 'otros',
}

const UNIT_LABELS: Record<z.infer<typeof unitEnum>, string> = {
  kg: 'kg',
  unit: 'unidad',
}

// ---------------------------------------------------------------------------
// Sesión / permisos
// ---------------------------------------------------------------------------

function unauthorized(): IpcResult<never> {
  return { ok: false, error: 'Sin sesión activa.', code: 'UNAUTHORIZED' }
}

function forbidden(message: string): IpcResult<never> {
  return { ok: false, error: message, code: 'FORBIDDEN' }
}

function requireSession(): { session: ActiveSession } | { error: IpcResult<never> } {
  const session = getActiveSession()
  if (!session) return { error: unauthorized() }
  return { session }
}

function requireAdminSession(): { session: ActiveSession } | { error: IpcResult<never> } {
  const auth = requireSession()
  if ('error' in auth) return auth
  if (auth.session.role !== 'admin') {
    return { error: forbidden('Solo los administradores pueden hacer esto.') }
  }
  return auth
}

function denyIfStoreNotAllowed(session: ActiveSession, storeId: string): IpcResult<never> | null {
  if (session.role === 'admin') return null
  if (!session.storeId) {
    return forbidden('No hay un local asignado a la sesión.')
  }
  if (storeId !== session.storeId) {
    return forbidden('Solo podés editar el catálogo de tu local.')
  }
  return null
}

/** getDb() o el `tx` de una transacción: ambos tienen insert, pero no el mismo tipo. */
type AuditDb = {
  insert: ReturnType<typeof getDb>['insert']
}

function clipSummary(text: string): string {
  if (text.length <= 200) return text
  return `${text.slice(0, 197)}…`
}

function writeCatalogAudit(
  db: AuditDb,
  params: {
    productId: string
    storeId: string | null
    action: CatalogAuditAction
    actorUserId: string
    summary: string
  },
): void {
  db.insert(catalogAuditEvents).values({
    id: uuidv4(),
    productId: params.productId,
    storeId: params.storeId,
    action: params.action,
    actorUserId: params.actorUserId,
    summary: clipSummary(params.summary),
    createdAt: new Date().toISOString(),
  }).run()
}

function formatPlu(plu: number | null | undefined): string {
  return plu == null ? 'sin PLU' : String(plu)
}

function identityChangeSummary(
  before: { name: string; category: z.infer<typeof categoryEnum>; unit: z.infer<typeof unitEnum>; pluNumber: number | null },
  after: { name?: string; category?: z.infer<typeof categoryEnum>; unit?: z.infer<typeof unitEnum>; pluNumber?: number | null },
): string | null {
  const bits: string[] = []
  if (after.name !== undefined && after.name !== before.name) {
    bits.push(`Nombre: ${before.name} → ${after.name}`)
  }
  if (after.category !== undefined && after.category !== before.category) {
    bits.push(`Categoría: ${CATEGORY_LABELS[before.category]} → ${CATEGORY_LABELS[after.category]}`)
  }
  if (after.unit !== undefined && after.unit !== before.unit) {
    bits.push(`Unidad: ${UNIT_LABELS[before.unit]} → ${UNIT_LABELS[after.unit]}`)
  }
  if (after.pluNumber !== undefined && after.pluNumber !== before.pluNumber) {
    bits.push(`PLU: ${formatPlu(before.pluNumber)} → ${formatPlu(after.pluNumber)}`)
  }
  if (bits.length === 0) return null
  return bits.join('; ')
}

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

interface CatalogIdentitySnap {
  name: string
  category: string
  unit: string
  pluNumber: number | null
  active: boolean
  price: number | null
  available: boolean
}

function formatAuditPrice(n: number | null): string {
  if (n == null) return 'sin precio'
  return `$${n.toLocaleString('es-AR')}`
}

function snapshotCatalogForStore(
  db: ReturnType<typeof getDb>,
  storeId: string,
): Map<string, CatalogIdentitySnap> {
  const now = new Date().toISOString()
  const prices = buildCurrentPriceMap(db, storeId, now)
  const availRows = db
    .select({ productId: storeProducts.productId, available: storeProducts.available })
    .from(storeProducts)
    .where(eq(storeProducts.storeId, storeId))
    .all()
  const avail = new Map(availRows.map(r => [r.productId, r.available]))
  const rows = db
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      unit: products.unit,
      pluNumber: products.pluNumber,
      active: products.active,
    })
    .from(products)
    .all()

  const map = new Map<string, CatalogIdentitySnap>()
  for (const r of rows) {
    map.set(r.id, {
      name: r.name,
      category: r.category,
      unit: r.unit,
      pluNumber: r.pluNumber,
      active: r.active,
      price: prices.get(r.id) ?? null,
      available: avail.get(r.id) ?? true,
    })
  }
  return map
}

function restoreChangeSummary(
  before: CatalogIdentitySnap | undefined,
  after: CatalogIdentitySnap | undefined,
): string | null {
  if (!before && after) {
    if (!after.active) return null
    return `Restauró versión: volvió al catálogo (${formatAuditPrice(after.price)})`
  }
  if (before && !after) {
    return 'Restauró versión: producto ausente en esa versión'
  }
  if (!before || !after) return null

  const bits: string[] = []
  if (before.active && !after.active) bits.push('retiro del catálogo')
  if (!before.active && after.active) bits.push('volvió al catálogo')
  if (before.price !== after.price) {
    bits.push(`precio ${formatAuditPrice(before.price)} → ${formatAuditPrice(after.price)}`)
  }
  if (before.name !== after.name) bits.push(`nombre: ${before.name} → ${after.name}`)
  if (before.pluNumber !== after.pluNumber) {
    bits.push(`PLU: ${formatPlu(before.pluNumber)} → ${formatPlu(after.pluNumber)}`)
  }
  if (before.category !== after.category) bits.push(`categoría: ${before.category} → ${after.category}`)
  if (before.unit !== after.unit) bits.push(`unidad: ${before.unit} → ${after.unit}`)
  if (before.available !== after.available) {
    bits.push(after.available ? 'visible en este local' : 'oculto en este local')
  }
  if (bits.length === 0) return null
  return `Restauró versión: ${bits.join(' · ')}`
}

function writeRestoreAudits(
  db: ReturnType<typeof getDb>,
  actorUserId: string,
  storeId: string,
  before: Map<string, CatalogIdentitySnap>,
  after: Map<string, CatalogIdentitySnap>,
): void {
  const ids = new Set([...before.keys(), ...after.keys()])
  db.transaction(tx => {
    for (const id of ids) {
      const summary = restoreChangeSummary(before.get(id), after.get(id))
      if (!summary) continue
      writeCatalogAudit(tx, {
        productId: id,
        storeId,
        action: 'restore_revision',
        actorUserId,
        summary,
      })
    }
  })
}

/**
 * Dispara la publicación del catálogo al Firestore del local dado.
 * No bloquea — los errores se loguean pero no se propagan al renderer.
 * `archive: true` solo para confirmaciones de precios (generan versión).
 */
async function triggerCatalogPublish(storeId: string, opts?: { archive?: boolean }): Promise<void> {
  try {
    const { tenant_id } = getBusinessConfig()
    scheduleCatalogPublish(tenant_id, storeId, opts)
  } catch (err) {
    log.warn('[catalog-admin] No se pudo agendar la publicación del catálogo:', err)
  }
}

async function triggerCatalogPublishAll(opts?: { archive?: boolean }): Promise<void> {
  try {
    const { tenant_id } = getBusinessConfig()
    scheduleCatalogPublishForAllStores(tenant_id, opts)
  } catch (err) {
    log.warn('[catalog-admin] No se pudo agendar la publicación del catálogo:', err)
  }
}

function writeProductPrices(
  db: ReturnType<typeof getDb>,
  userId: string,
  storeId: string,
  items: Array<{ productId: string; price: number }>,
): void {
  const now = new Date().toISOString()
  db.transaction(tx => {
    for (const { productId, price } of items) {
      const vigentes = tx
        .select({ id: productPrices.id })
        .from(productPrices)
        .where(
          and(
            eq(productPrices.productId, productId),
            eq(productPrices.storeId, storeId),
            lte(productPrices.validFrom, now),
            or(isNull(productPrices.validTo), gt(productPrices.validTo, now)),
          ),
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
          createdBy: userId,
          syncedAt: null,
        }).run()
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Registro de handlers
// ---------------------------------------------------------------------------

export function registerCatalogAdminHandlers(): void {

  // ---- GET_STORES ----
  // Por defecto solo devuelve locales activos (no archivados).
  // Con includeArchived: true devuelve todos (para la pantalla de gestión).
  ipcMain.handle(IPC.GET_STORES, (_event, payload?: unknown): IpcResult<StoreRow[]> => {
    const includeArchived = (payload as { includeArchived?: boolean } | undefined)?.includeArchived === true
    try {
      const db = getDb()
      const rows = includeArchived
        ? db.select({
              id: stores.id,
              name: stores.name,
              address: stores.address,
              archivedAt: stores.archivedAt,
              morningStart: stores.morningStart,
              morningEnd: stores.morningEnd,
              afternoonStart: stores.afternoonStart,
              afternoonEnd: stores.afternoonEnd,
            })
            .from(stores)
            .orderBy(asc(stores.name))
            .all()
        : db.select({
              id: stores.id,
              name: stores.name,
              address: stores.address,
              archivedAt: stores.archivedAt,
              morningStart: stores.morningStart,
              morningEnd: stores.morningEnd,
              afternoonStart: stores.afternoonStart,
              afternoonEnd: stores.afternoonEnd,
            })
            .from(stores)
            .where(isNull(stores.archivedAt))
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

    const auth = requireSession()
    if ('error' in auth) return auth.error
    const denied = denyIfStoreNotAllowed(auth.session, parsed.data)
    if (denied) return denied

    try {
      const db = getDb()
      const now = new Date().toISOString()

      // Solo activos: los soft-deleted no se listan (y liberan su PLU al eliminarse).
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
        .where(eq(products.active, true))
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

    const auth = requireSession()
    if ('error' in auth) return auth.error
    const { session } = auth

    try {
      const db = getDb()
      const { name, category, unit, pluNumber } = parsed.data

      // PLU único solo entre productos activos (los eliminados liberan el número).
      if (pluNumber !== null) {
        const existing = db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(eq(products.pluNumber, pluNumber), eq(products.active, true)))
          .get()
        if (existing) {
          return { ok: false, error: `El PLU ${pluNumber} ya está en uso por "${existing.name}".`, code: 'PLU_CONFLICT' }
        }
      }

      const id = uuidv4()
      const now = new Date().toISOString()
      const cashierStoreId = session.role === 'cashier' ? session.storeId || null : null

      db.transaction(tx => {
        tx.insert(products).values({
          id,
          name,
          category,
          unit,
          pluNumber: pluNumber ?? undefined,
          active: true,
          createdAt: now,
          updatedAt: now,
        }).run()

        if (cashierStoreId) {
          tx.insert(storeProducts).values({
            storeId: cashierStoreId,
            productId: id,
            available: true,
          }).run()
        }

        writeCatalogAudit(tx, {
          productId: id,
          storeId: null,
          action: 'create',
          actorUserId: session.userId,
          summary: `Alta: ${name} (${formatPlu(pluNumber)})`,
        })
      })

      log.info(`[catalog-admin] Producto creado: ${name} (PLU ${pluNumber ?? '-'})`)
      void triggerCatalogPublishAll({ archive: false })
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

    const auth = requireSession()
    if ('error' in auth) return auth.error
    const { session } = auth

    if (parsed.data.active === false && session.role !== 'admin') {
      return forbidden('Solo un administrador puede retirar un producto del catálogo.')
    }

    const { id, pluNumber, ...fields } = parsed.data
    // Nada que actualizar
    if (Object.keys(fields).length === 0 && pluNumber === undefined) {
      return { ok: true, data: undefined }
    }

    try {
      const db = getDb()

      const existing = db
        .select({
          id: products.id,
          name: products.name,
          category: products.category,
          unit: products.unit,
          pluNumber: products.pluNumber,
          active: products.active,
        })
        .from(products)
        .where(eq(products.id, id))
        .get()
      if (!existing) {
        return { ok: false, error: 'Producto no encontrado.', code: 'NOT_FOUND' }
      }

      // PLU único solo entre activos (excluye el propio producto).
      if (pluNumber !== undefined && pluNumber !== null) {
        const conflict = db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(eq(products.pluNumber, pluNumber), eq(products.active, true)))
          .get()
        if (conflict && conflict.id !== id) {
          return { ok: false, error: `El PLU ${pluNumber} ya está en uso por "${conflict.name}".`, code: 'PLU_CONFLICT' }
        }
      }

      const updateData: Record<string, unknown> = { ...fields, updatedAt: new Date().toISOString() }
      if (pluNumber !== undefined) {
        updateData['pluNumber'] = pluNumber ?? null
      }
      // Soft-delete: ocultar y liberar PLU para que se pueda reutilizar.
      if (fields.active === false) {
        updateData['active'] = false
        updateData['pluNumber'] = null
      }

      const identitySummary = identityChangeSummary(
        {
          name: existing.name,
          category: existing.category,
          unit: existing.unit,
          pluNumber: existing.pluNumber ?? null,
        },
        {
          name: fields.name,
          category: fields.category,
          unit: fields.unit,
          pluNumber,
        },
      )

      db.transaction(tx => {
        tx.update(products).set(updateData).where(eq(products.id, id)).run()
        if (fields.active === false) {
          writeCatalogAudit(tx, {
            productId: id,
            storeId: null,
            action: 'retire_global',
            actorUserId: session.userId,
            summary: `Retiro global de "${existing.name}" (liberó PLU ${formatPlu(existing.pluNumber)})`,
          })
        } else if (identitySummary) {
          writeCatalogAudit(tx, {
            productId: id,
            storeId: null,
            action: 'update_identity',
            actorUserId: session.userId,
            summary: identitySummary,
          })
        }
      })
      log.info(`[catalog-admin] Producto actualizado: ${id}`)
      void triggerCatalogPublishAll({ archive: false })
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
    const auth = requireSession()
    if ('error' in auth) return auth.error
    const storeDenied = denyIfStoreNotAllowed(auth.session, storeId)
    if (storeDenied) return storeDenied
    const { session } = auth

    try {
      const db = getDb()
      writeProductPrices(db, session.userId, storeId, [{ productId, price }])

      log.info(`[catalog-admin] Precio actualizado: producto=${productId} local=${storeId} precio=${price}`)

      void triggerCatalogPublish(storeId, { archive: true })

      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:set-product-price] Error', err)
      return { ok: false, error: 'Error al cambiar el precio.', code: 'DB_ERROR' }
    }
  })

  // ---- SET_PRODUCT_PRICES (tanda: Editar precios) ----
  ipcMain.handle(IPC.SET_PRODUCT_PRICES, async (_event, payload: unknown): Promise<IpcResult> => {
    const parsed = setProductPricesSchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:set-product-prices] Payload inválido', parsed.error.flatten())
      return { ok: false, error: 'Datos de precios inválidos.', code: 'VALIDATION_ERROR' }
    }

    const { storeId, items } = parsed.data
    const auth = requireSession()
    if ('error' in auth) return auth.error
    const storeDenied = denyIfStoreNotAllowed(auth.session, storeId)
    if (storeDenied) return storeDenied
    const { session } = auth

    const byProduct = new Map<string, number>()
    for (const item of items) {
      byProduct.set(item.productId, item.price)
    }
    const uniqueItems = [...byProduct.entries()].map(([productId, price]) => ({ productId, price }))

    try {
      const db = getDb()
      writeProductPrices(db, session.userId, storeId, uniqueItems)

      log.info(`[catalog-admin] Precios actualizados en tanda: local=${storeId} items=${uniqueItems.length}`)

      void triggerCatalogPublish(storeId, { archive: true })

      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:set-product-prices] Error', err)
      return { ok: false, error: 'Error al cambiar los precios.', code: 'DB_ERROR' }
    }
  })

  // ---- SET_PRODUCT_AVAILABILITY ----
  ipcMain.handle(IPC.SET_PRODUCT_AVAILABILITY, (_event, payload: unknown): IpcResult => {
    const parsed = setProductAvailabilitySchema.safeParse(payload)
    if (!parsed.success) {
      log.warn('[ipc:set-product-availability] Payload inválido', parsed.error.flatten())
      return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }

    const { productId, storeId, available } = parsed.data
    const auth = requireSession()
    if ('error' in auth) return auth.error
    const storeDenied = denyIfStoreNotAllowed(auth.session, storeId)
    if (storeDenied) return storeDenied
    const { session } = auth

    try {
      const db = getDb()

      db.transaction(tx => {
        const existing = tx
          .select({ productId: storeProducts.productId })
          .from(storeProducts)
          .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
          .get()

        if (existing) {
          tx.update(storeProducts)
            .set({ available })
            .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.productId, productId)))
            .run()
        } else {
          tx.insert(storeProducts).values({ storeId, productId, available }).run()
        }

        writeCatalogAudit(tx, {
          productId,
          storeId,
          action: available ? 'show_store' : 'hide_store',
          actorUserId: session.userId,
          summary: available ? 'Visible en este local' : 'Ocultado en este local',
        })
      })

      log.info(`[catalog-admin] Disponibilidad: producto=${productId} local=${storeId} disponible=${available}`)
      notifyRenderer(IPC.CATALOG_SYNC_UPDATED, { storeId })
      void triggerCatalogPublish(storeId, { archive: false })
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
            .where(or(...userIds.map(uid => eq(users.id, uid))))
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

  ipcMain.handle(IPC.LIST_CATALOG_REVISIONS, async (_event, payload: unknown): Promise<IpcResult<CatalogRevisionRow[]>> => {
    const parsed = listCatalogRevisionsSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }
    const auth = requireAdminSession()
    if ('error' in auth) return auth.error
    try {
      const { tenant_id } = getBusinessConfig()
      const rows = await listCatalogRevisions(tenant_id, parsed.data.storeId)
      return { ok: true, data: rows }
    } catch (err) {
      log.error('[ipc:list-catalog-revisions] Error', err)
      return { ok: false, error: 'Error al listar versiones del catálogo.' }
    }
  })

  ipcMain.handle(IPC.RESTORE_CATALOG_REVISION, async (_event, payload: unknown): Promise<IpcResult<{ productCount: number }>> => {
    const parsed = restoreCatalogRevisionSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Datos inválidos.', code: 'VALIDATION_ERROR' }
    }
    const auth = requireAdminSession()
    if ('error' in auth) return auth.error
    try {
      const { tenant_id } = getBusinessConfig()
      const db = getDb()
      const before = snapshotCatalogForStore(db, parsed.data.storeId)
      const result = await restoreCatalogRevision(tenant_id, parsed.data.storeId, parsed.data.revisionId)
      try {
        await pullCatalogFromFirestore(tenant_id, parsed.data.storeId)
      } catch (pullErr) {
        log.warn('[ipc:restore-catalog-revision] Pull local falló (Firestore ya restaurado)', pullErr)
      }
      const after = snapshotCatalogForStore(db, parsed.data.storeId)
      writeRestoreAudits(db, auth.session.userId, parsed.data.storeId, before, after)
      try {
        await publishCatalog(tenant_id, parsed.data.storeId, { archive: false })
      } catch (pubErr) {
        log.warn('[ipc:restore-catalog-revision] Republish local falló', pubErr)
      }
      notifyRenderer(IPC.CATALOG_SYNC_UPDATED, { storeId: parsed.data.storeId })
      return { ok: true, data: result }
    } catch (err) {
      log.error('[ipc:restore-catalog-revision] Error', err)
      const message = err instanceof Error ? err.message : 'Error al restaurar el catálogo.'
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(IPC.LIST_CATALOG_AUDIT, (_event, payload: unknown): IpcResult<CatalogAuditRow[]> => {
    const parsed = listCatalogAuditSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'VALIDATION_ERROR' }
    }

    const auth = requireSession()
    if ('error' in auth) return auth.error
    const { session } = auth

    try {
      const db = getDb()
      const { productId, storeId } = parsed.data

      const conditions = []
      if (productId) {
        conditions.push(eq(catalogAuditEvents.productId, productId))
      }

      if (session.role !== 'admin') {
        if (session.storeId) {
          conditions.push(
            or(eq(catalogAuditEvents.storeId, session.storeId), isNull(catalogAuditEvents.storeId)),
          )
        } else {
          conditions.push(isNull(catalogAuditEvents.storeId))
        }
      } else if (storeId) {
        conditions.push(
          or(eq(catalogAuditEvents.storeId, storeId), isNull(catalogAuditEvents.storeId)),
        )
      }

      const rows = (
        conditions.length > 0
          ? db
              .select({
                id: catalogAuditEvents.id,
                productId: catalogAuditEvents.productId,
                storeId: catalogAuditEvents.storeId,
                action: catalogAuditEvents.action,
                actorUserId: catalogAuditEvents.actorUserId,
                summary: catalogAuditEvents.summary,
                createdAt: catalogAuditEvents.createdAt,
              })
              .from(catalogAuditEvents)
              .where(and(...conditions))
          : db
              .select({
                id: catalogAuditEvents.id,
                productId: catalogAuditEvents.productId,
                storeId: catalogAuditEvents.storeId,
                action: catalogAuditEvents.action,
                actorUserId: catalogAuditEvents.actorUserId,
                summary: catalogAuditEvents.summary,
                createdAt: catalogAuditEvents.createdAt,
              })
              .from(catalogAuditEvents)
      )
        .orderBy(desc(catalogAuditEvents.createdAt))
        .all()

      const userIds = [...new Set(rows.map(r => r.actorUserId))]
      const userRows = userIds.length > 0
        ? db.select({ id: users.id, name: users.name }).from(users)
            .where(or(...userIds.map(uid => eq(users.id, uid))))
            .all()
        : []
      const userMap = new Map(userRows.map(u => [u.id, u.name]))

      return {
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          productId: r.productId,
          storeId: r.storeId ?? null,
          action: r.action,
          actorUserId: r.actorUserId,
          actorName: userMap.get(r.actorUserId) ?? r.actorUserId,
          summary: r.summary,
          createdAt: r.createdAt,
        })),
      }
    } catch (err) {
      log.error('[ipc:list-catalog-audit] Error', err)
      return { ok: false, error: 'Error al leer la auditoría del catálogo.', code: 'DB_ERROR' }
    }
  })
}
