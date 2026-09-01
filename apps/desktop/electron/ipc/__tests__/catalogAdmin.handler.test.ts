import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, products, productPrices, storeProducts, catalogAuditEvents } from '../../db/schema'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

vi.mock('../../activeSession', () => ({ getActiveSession: vi.fn() }))

vi.mock('../../licensing/catalogPublish', () => ({
  publishCatalog: vi.fn().mockResolvedValue(undefined),
  publishCatalogForAllStores: vi.fn().mockResolvedValue(undefined),
  listCatalogRevisions: vi.fn().mockResolvedValue([]),
  restoreCatalogRevision: vi.fn().mockResolvedValue({ productCount: 1 }),
}))

vi.mock('../../licensing/catalogSync', () => ({
  pullCatalogFromFirestore: vi.fn().mockResolvedValue(undefined),
  syncCatalogWithFirestore: vi.fn().mockResolvedValue(undefined),
  syncAllStoreCatalogs: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn().mockReturnValue({ tenant_id: 'TEST-KEY' }),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import {
  publishCatalog,
  publishCatalogForAllStores,
  listCatalogRevisions,
  restoreCatalogRevision,
} from '../../licensing/catalogPublish'
import { registerCatalogAdminHandlers } from '../catalogAdmin.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const STORE_A = '00000000-0000-0000-0000-000000000001'
const STORE_B = '00000000-0000-0000-0000-000000000002'
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = 'aaaa0000-0000-0000-0000-000000000000'
const ADMIN_ID = 'bbbb0000-0000-0000-0000-000000000000'
const OTHER_PRODUCT_ID = '22222222-2222-2222-2222-222222222222'

const CASHIER_SESSION = {
  userId: USER_ID,
  storeId: STORE_A,
  role: 'cashier' as const,
  shiftId: 'shift-001',
}

const ADMIN_SESSION = {
  userId: ADMIN_ID,
  storeId: STORE_A,
  role: 'admin' as const,
  shiftId: null,
}

describe('catalogAdmin.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    const now = '2026-01-15T12:00:00.000Z'

    db.insert(stores).values([
      { id: STORE_A, name: 'Local A', createdAt: now },
      { id: STORE_B, name: 'Local B', createdAt: now },
    ]).run()
    db.insert(users).values([
      {
        id: USER_ID,
        name: 'Cajera Test',
        storeId: STORE_A,
        role: 'cashier',
        active: true,
        createdAt: now,
      },
      {
        id: ADMIN_ID,
        name: 'Admin Test',
        storeId: STORE_A,
        role: 'cashier',
        active: true,
        createdAt: now,
      },
    ]).run()
    db.insert(products).values([
      {
        id: PRODUCT_ID,
        name: 'Asado',
        category: 'beef_cut',
        unit: 'kg',
        pluNumber: 1,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: OTHER_PRODUCT_ID,
        name: 'Sin PLU',
        category: 'other',
        unit: 'unit',
        pluNumber: null,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ]).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)
    registerCatalogAdminHandlers()
  })

  // ---- GET_STORES ----
  describe('GET_STORES', () => {
    it('retorna lista de locales', () => {
      const result = getHandler('ipc:get-stores')({}) as { ok: boolean; data: { id: string }[] }
      expect(result.ok).toBe(true)
      expect(result.data.map(s => s.id).sort()).toEqual([STORE_A, STORE_B].sort())
    })

    it('retorna DB_ERROR si falla', () => {
      vi.mocked(getDb).mockImplementation(() => { throw new Error('db fail') })
      const result = getHandler('ipc:get-stores')({}) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('DB_ERROR')
    })
  })

  // ---- GET_ALL_PRODUCTS ----
  describe('GET_ALL_PRODUCTS', () => {
    it('retorna productos con precio y disponibilidad', () => {
      db.insert(productPrices).values({
        id: 'price-1',
        productId: PRODUCT_ID,
        storeId: STORE_A,
        price: 18000,
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: null,
        createdBy: USER_ID,
      }).run()

      const result = getHandler('ipc:get-all-products')({}, STORE_A) as {
        ok: boolean
        data: { id: string; price: number | null; available: boolean }[]
      }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
      const asado = result.data.find(p => p.id === PRODUCT_ID)
      expect(asado?.price).toBe(18000)
      expect(asado?.available).toBe(true)
    })

    it('rechaza storeId inválido', () => {
      const result = getHandler('ipc:get-all-products')({}, '') as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('cajera no puede listar el catálogo de otro local', () => {
      const result = getHandler('ipc:get-all-products')({}, STORE_B) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })

    it('retorna DB_ERROR si falla', () => {
      vi.mocked(getDb).mockImplementation(() => { throw new Error('db fail') })
      const result = getHandler('ipc:get-all-products')({}, STORE_A) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('DB_ERROR')
    })
  })

  // ---- CREATE_PRODUCT ----
  describe('CREATE_PRODUCT', () => {
    it('cajera crea un producto válido, deja disponible en su local, audita create y publica', async () => {
      const result = getHandler('ipc:create-product')({}, {
        name: 'Paleta', category: 'pork', unit: 'kg', pluNumber: 150,
      }) as { ok: boolean; data: { id: string } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBeTruthy()

      const sp = db.select().from(storeProducts).where(eq(storeProducts.productId, result.data.id)).get()
      expect(sp?.storeId).toBe(STORE_A)
      expect(sp?.available).toBe(true)

      const audits = db.select().from(catalogAuditEvents).all()
      expect(audits).toHaveLength(1)
      expect(audits[0]?.action).toBe('create')
      expect(audits[0]?.productId).toBe(result.data.id)
      expect(audits[0]?.storeId).toBeNull()
      expect(audits[0]?.summary).toMatch(/Alta: Paleta/)

      await Promise.resolve()
      expect(publishCatalogForAllStores).toHaveBeenCalledWith('TEST-KEY')
    })

    it('rechaza payload malformado (nombre vacío)', () => {
      const result = getHandler('ipc:create-product')({}, {
        name: '', category: 'beef_cut', unit: 'kg', pluNumber: null,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('rechaza PLU duplicado', () => {
      const result = getHandler('ipc:create-product')({}, {
        name: 'Producto X', category: 'other', unit: 'unit', pluNumber: 1,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('PLU_CONFLICT')
    })

    it('retorna UNAUTHORIZED si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:create-product')({}, {
        name: 'Paleta', category: 'pork', unit: 'kg', pluNumber: 150,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('UNAUTHORIZED')
    })
  })

  // ---- UPDATE_PRODUCT ----
  describe('UPDATE_PRODUCT', () => {
    it('cajera actualiza el nombre, cambia updatedAt y audita update_identity', async () => {
      db.update(products).set({ updatedAt: '2026-01-01T00:00:00.000Z' }).where(eq(products.id, PRODUCT_ID)).run()

      const result = getHandler('ipc:update-product')({}, {
        id: PRODUCT_ID, name: 'Nuevo nombre',
      }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const row = db.select().from(products).where(eq(products.id, PRODUCT_ID)).get()
      expect(row?.name).toBe('Nuevo nombre')
      expect(row?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
      expect(row?.active).toBe(true)

      const audits = db.select().from(catalogAuditEvents).all()
      expect(audits).toHaveLength(1)
      expect(audits[0]?.action).toBe('update_identity')
      expect(audits[0]?.summary).toMatch(/Nombre: Asado → Nuevo nombre/)

      await Promise.resolve()
      expect(publishCatalogForAllStores).toHaveBeenCalledWith('TEST-KEY')
    })

    it('rechaza payload malformado (id vacío)', () => {
      const result = getHandler('ipc:update-product')({}, { id: '', name: 'X' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna NOT_FOUND si el producto no existe', () => {
      const result = getHandler('ipc:update-product')({}, {
        id: '99999999-9999-9999-9999-999999999999', name: 'X',
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })

    it('cajera no puede retirar globalmente (active: false) y el producto sigue activo', () => {
      const result = getHandler('ipc:update-product')({}, {
        id: PRODUCT_ID, active: false,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')

      const row = db.select().from(products).where(eq(products.id, PRODUCT_ID)).get()
      expect(row?.active).toBe(true)
      expect(row?.pluNumber).toBe(1)
      expect(db.select().from(catalogAuditEvents).all()).toHaveLength(0)
    })

    it('admin retira el producto, libera el PLU y audita retire_global', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const result = getHandler('ipc:update-product')({}, {
        id: PRODUCT_ID, active: false,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const row = db.select().from(products).where(eq(products.id, PRODUCT_ID)).get()
      expect(row?.active).toBe(false)
      expect(row?.pluNumber).toBeNull()

      const audits = db.select().from(catalogAuditEvents).all()
      expect(audits).toHaveLength(1)
      expect(audits[0]?.action).toBe('retire_global')
      expect(audits[0]?.storeId).toBeNull()
    })
  })

  // ---- SET_PRODUCT_PRICE ----
  describe('SET_PRODUCT_PRICE', () => {
    it('cajera cambia el precio de su local', async () => {
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_A, price: 20000,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const prices = db.select().from(productPrices).all()
      expect(prices).toHaveLength(1)
      expect(prices[0]?.price).toBe(20000)
      expect(prices[0]?.storeId).toBe(STORE_A)
      expect(prices[0]?.createdBy).toBe(USER_ID)

      await Promise.resolve()
      expect(publishCatalog).toHaveBeenCalledWith('TEST-KEY', STORE_A)
    })

    it('cajera no puede cambiar precio de otro local y no escribe', async () => {
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_B, price: 20000,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
      expect(db.select().from(productPrices).all()).toHaveLength(0)
      expect(publishCatalog).not.toHaveBeenCalled()
    })

    it('admin puede cambiar precio de cualquier local', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_B, price: 15000,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)
      const prices = db.select().from(productPrices).all()
      expect(prices[0]?.storeId).toBe(STORE_B)
      expect(prices[0]?.createdBy).toBe(ADMIN_ID)
    })

    it('rechaza payload malformado (productId vacío)', async () => {
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: '', storeId: STORE_A, price: 100,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna UNAUTHORIZED si no hay sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_A, price: 20000,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('UNAUTHORIZED')
    })

    it('retorna DB_ERROR si falla', async () => {
      vi.mocked(getDb).mockImplementation(() => { throw new Error('db fail') })
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_A, price: 20000,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('DB_ERROR')
    })
  })

  // ---- SET_PRODUCT_AVAILABILITY ----
  describe('SET_PRODUCT_AVAILABILITY', () => {
    it('cajera oculta en su local (available false), el producto sigue activo y audita hide_store', () => {
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: PRODUCT_ID, storeId: STORE_A, available: false,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const sp = db.select().from(storeProducts).where(eq(storeProducts.productId, PRODUCT_ID)).get()
      expect(sp?.available).toBe(false)
      expect(sp?.storeId).toBe(STORE_A)

      const product = db.select().from(products).where(eq(products.id, PRODUCT_ID)).get()
      expect(product?.active).toBe(true)

      const audits = db.select().from(catalogAuditEvents).all()
      expect(audits).toHaveLength(1)
      expect(audits[0]?.action).toBe('hide_store')
      expect(audits[0]?.storeId).toBe(STORE_A)
    })

    it('cajera muestra en su local y audita show_store', () => {
      db.insert(storeProducts).values({ storeId: STORE_A, productId: PRODUCT_ID, available: false }).run()

      const result = getHandler('ipc:set-product-availability')({}, {
        productId: PRODUCT_ID, storeId: STORE_A, available: true,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)

      const sp = db.select().from(storeProducts).where(eq(storeProducts.productId, PRODUCT_ID)).get()
      expect(sp?.available).toBe(true)

      const audits = db.select().from(catalogAuditEvents).all()
      expect(audits.some(a => a.action === 'show_store')).toBe(true)
    })

    it('cajera no puede cambiar disponibilidad de otro local', () => {
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: PRODUCT_ID, storeId: STORE_B, available: false,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
      expect(db.select().from(storeProducts).all()).toHaveLength(0)
    })

    it('rechaza payload malformado', () => {
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: '', storeId: STORE_A, available: true,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna DB_ERROR si falla', () => {
      vi.mocked(getDb).mockImplementation(() => { throw new Error('fail') })
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: PRODUCT_ID, storeId: STORE_A, available: true,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('DB_ERROR')
    })
  })

  describe('LIST_CATALOG_AUDIT', () => {
    it('retorna UNAUTHORIZED si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:list-catalog-audit')({}, {}) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('UNAUTHORIZED')
    })

    it('con sesión lista las filas de auditoría', () => {
      getHandler('ipc:create-product')({}, {
        name: 'Paleta', category: 'pork', unit: 'kg', pluNumber: 150,
      })
      const result = getHandler('ipc:list-catalog-audit')({}, {}) as {
        ok: boolean
        data: { action: string; actorName: string; summary: string }[]
      }
      expect(result.ok).toBe(true)
      expect(result.data.length).toBeGreaterThanOrEqual(1)
      expect(result.data[0]?.action).toBe('create')
      expect(result.data[0]?.actorName).toBe('Cajera Test')
    })

    it('rechaza payload malformado', () => {
      const result = getHandler('ipc:list-catalog-audit')({}, { productId: '' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('LIST_CATALOG_REVISIONS', () => {
    it('rechaza payload malformado', async () => {
      const result = await getHandler('ipc:list-catalog-revisions')({}, { storeId: '' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna UNAUTHORIZED si no hay sesión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:list-catalog-revisions')({}, { storeId: STORE_A }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('UNAUTHORIZED')
    })

    it('cajera recibe FORBIDDEN', async () => {
      const result = await getHandler('ipc:list-catalog-revisions')({}, { storeId: STORE_A }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })

    it('admin lista revisiones', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      vi.mocked(listCatalogRevisions).mockResolvedValue([
        { id: 'rev-1', archivedAt: '2026-08-01T00:00:00.000Z', updatedAt: null, productCount: 3 },
      ])
      const result = await getHandler('ipc:list-catalog-revisions')({}, { storeId: STORE_A }) as {
        ok: boolean
        data: { id: string }[]
      }
      expect(result.ok).toBe(true)
      expect(result.data[0]?.id).toBe('rev-1')
    })
  })

  describe('RESTORE_CATALOG_REVISION', () => {
    it('rechaza payload malformado', async () => {
      const result = await getHandler('ipc:restore-catalog-revision')({}, { storeId: STORE_A }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('cajera recibe FORBIDDEN', async () => {
      const result = await getHandler('ipc:restore-catalog-revision')({}, {
        storeId: STORE_A, revisionId: 'rev-1',
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
      expect(restoreCatalogRevision).not.toHaveBeenCalled()
    })

    it('admin restaura una revisión', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const result = await getHandler('ipc:restore-catalog-revision')({}, {
        storeId: STORE_A, revisionId: 'rev-1',
      }) as { ok: boolean; data: { productCount: number } }
      expect(result.ok).toBe(true)
      expect(result.data.productCount).toBe(1)
      expect(restoreCatalogRevision).toHaveBeenCalledWith('TEST-KEY', STORE_A, 'rev-1')
    })
  })
})
