import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('uuid', () => ({ v4: () => 'new-uuid' }))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { publishCatalog, publishCatalogForAllStores } from '../../licensing/catalogPublish'
import { registerCatalogAdminHandlers } from '../catalogAdmin.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = 'aaaa0000-0000-0000-0000-000000000000'

const SAMPLE_PRODUCTS = [
  { id: PRODUCT_ID, name: 'Asado', category: 'beef_cut', unit: 'kg', pluNumber: 1, active: true },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Sin PLU', category: 'other', unit: 'unit', pluNumber: null, active: true },
]

const SAMPLE_PRICES = [
  { productId: PRODUCT_ID, price: 18000, validFrom: '2026-01-01T00:00:00.000Z' },
]

/**
 * Crea un mock de getDb que devuelve los resultados de `selectSequence`
 * en orden por cada llamada a `.select()`. Cubre .all() y .get().
 */
function makeDb(selectSequence: unknown[]) {
  let idx = 0
  const db = {
    select: vi.fn().mockImplementation(() => {
      const resp = selectSequence[idx++] ?? []
      const isArray = Array.isArray(resp)
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(isArray ? resp : []) }),
            all: vi.fn().mockReturnValue(isArray ? resp : []),
            get: vi.fn().mockReturnValue(isArray ? (resp as unknown[])[0] ?? undefined : resp),
          }),
          orderBy: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(isArray ? resp : []) }),
          all: vi.fn().mockReturnValue(isArray ? resp : []),
        }),
      }
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: vi.fn() }) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
    }),
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => void) => fn(db)),
  }
  return db as unknown as ReturnType<typeof getDb>
}

describe('catalogAdmin.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActiveSession).mockReturnValue({
      userId: USER_ID,
      storeId: STORE_ID,
      role: 'cashier' as const,
      shiftId: 'shift-001',
    })
    registerCatalogAdminHandlers()
  })

  // ---- GET_STORES ----
  describe('GET_STORES', () => {
    it('retorna lista de locales', () => {
      // GET_STORES: 1 select → stores
      vi.mocked(getDb).mockReturnValue(makeDb([[{ id: STORE_ID, name: 'Local 1' }]]))
      const result = getHandler('ipc:get-stores')({}) as { ok: boolean; data: { id: string }[] }
      expect(result.ok).toBe(true)
      expect(result.data[0]?.id).toBe(STORE_ID)
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
      // GET_ALL_PRODUCTS: 3 selects → products, prices, availability
      vi.mocked(getDb).mockReturnValue(makeDb([SAMPLE_PRODUCTS, SAMPLE_PRICES, []]))
      const result = getHandler('ipc:get-all-products')({}, STORE_ID) as {
        ok: boolean
        data: { id: string; price: number | null; available: boolean }[]
      }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0]?.id).toBe(PRODUCT_ID)
      expect(result.data[0]?.price).toBe(18000)
    })

    it('rechaza storeId inválido', () => {
      vi.mocked(getDb).mockReturnValue(makeDb([]))
      const result = getHandler('ipc:get-all-products')({}, '') as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna DB_ERROR si falla', () => {
      vi.mocked(getDb).mockImplementation(() => { throw new Error('db fail') })
      const result = getHandler('ipc:get-all-products')({}, STORE_ID) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('DB_ERROR')
    })
  })

  // ---- CREATE_PRODUCT ----
  describe('CREATE_PRODUCT', () => {
    it('crea un producto válido, retorna el id y publica el catálogo', async () => {
      // CREATE_PRODUCT: 1 select → check PLU conflict (vacío = no hay conflicto)
      vi.mocked(getDb).mockReturnValue(makeDb([[]]))
      const result = getHandler('ipc:create-product')({}, {
        name: 'Paleta', category: 'pork', unit: 'kg', pluNumber: 150,
      }) as { ok: boolean; data: { id: string } }
      expect(result.ok).toBe(true)
      expect(result.data.id).toBe('new-uuid')
      await Promise.resolve()
      expect(publishCatalogForAllStores).toHaveBeenCalledWith('TEST-KEY')
    })

    it('rechaza payload malformado (nombre vacío)', () => {
      vi.mocked(getDb).mockReturnValue(makeDb([]))
      const result = getHandler('ipc:create-product')({}, {
        name: '', category: 'beef_cut', unit: 'kg', pluNumber: null,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('rechaza PLU duplicado', () => {
      // 1 select → retorna un producto existente con ese PLU
      vi.mocked(getDb).mockReturnValue(makeDb([[{ id: 'otro-producto' }]]))
      const result = getHandler('ipc:create-product')({}, {
        name: 'Producto X', category: 'other', unit: 'unit', pluNumber: 1,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('PLU_CONFLICT')
    })
  })

  // ---- UPDATE_PRODUCT ----
  describe('UPDATE_PRODUCT', () => {
    it('actualiza un producto existente y publica el catálogo', async () => {
      // UPDATE_PRODUCT: select 1 → producto existe; (no hay cambio de PLU → no hay select 2)
      vi.mocked(getDb).mockReturnValue(makeDb([[{ id: PRODUCT_ID }]]))
      const result = getHandler('ipc:update-product')({}, {
        id: PRODUCT_ID, name: 'Nuevo nombre',
      }) as { ok: boolean }
      expect(result.ok).toBe(true)
      await Promise.resolve()
      expect(publishCatalogForAllStores).toHaveBeenCalledWith('TEST-KEY')
    })

    it('rechaza payload malformado (id no es uuid)', () => {
      vi.mocked(getDb).mockReturnValue(makeDb([]))
      const result = getHandler('ipc:update-product')({}, { id: '', name: 'X' }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna NOT_FOUND si el producto no existe', () => {
      // select 1 → vacío (producto no existe)
      vi.mocked(getDb).mockReturnValue(makeDb([[]]))
      const result = getHandler('ipc:update-product')({}, {
        id: PRODUCT_ID, name: 'X',
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })

    it('al soft-delete libera el PLU (pluNumber=null)', () => {
      const db = makeDb([[{ id: PRODUCT_ID }]])
      vi.mocked(getDb).mockReturnValue(db)
      const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) })
      vi.mocked(db.update).mockReturnValue({ set: setMock } as never)

      const result = getHandler('ipc:update-product')({}, {
        id: PRODUCT_ID, active: false,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ active: false, pluNumber: null }),
      )
    })
  })

  // ---- SET_PRODUCT_PRICE ----
  describe('SET_PRODUCT_PRICE', () => {
    it('cambia el precio correctamente', async () => {
      // SET_PRODUCT_PRICE: 1 select → precios vigentes actuales
      vi.mocked(getDb).mockReturnValue(makeDb([SAMPLE_PRICES]))
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_ID, price: 20000,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)
      await Promise.resolve()
      expect(publishCatalog).toHaveBeenCalledWith('TEST-KEY', STORE_ID)
    })

    it('rechaza payload malformado (productId no uuid)', async () => {
      vi.mocked(getDb).mockReturnValue(makeDb([]))
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: '', storeId: STORE_ID, price: 100,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna UNAUTHORIZED si no hay sesión', async () => {
      vi.mocked(getDb).mockReturnValue(makeDb([]))
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_ID, price: 20000,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('UNAUTHORIZED')
    })

    it('retorna DB_ERROR si falla', async () => {
      vi.mocked(getDb).mockImplementation(() => { throw new Error('db fail') })
      const result = await getHandler('ipc:set-product-price')({}, {
        productId: PRODUCT_ID, storeId: STORE_ID, price: 20000,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('DB_ERROR')
    })
  })

  // ---- SET_PRODUCT_AVAILABILITY ----
  describe('SET_PRODUCT_AVAILABILITY', () => {
    it('actualiza disponibilidad cuando ya existe fila en store_products', () => {
      // 1 select → fila existente
      vi.mocked(getDb).mockReturnValue(makeDb([[{ productId: PRODUCT_ID }]]))
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: PRODUCT_ID, storeId: STORE_ID, available: false,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)
    })

    it('inserta nueva fila si no existía disponibilidad previa', () => {
      // 1 select → vacío (no hay fila previa)
      vi.mocked(getDb).mockReturnValue(makeDb([[]]))
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: PRODUCT_ID, storeId: STORE_ID, available: true,
      }) as { ok: boolean }
      expect(result.ok).toBe(true)
    })

    it('rechaza payload malformado', () => {
      vi.mocked(getDb).mockReturnValue(makeDb([]))
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: '', storeId: STORE_ID, available: true,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('retorna DB_ERROR si falla', () => {
      vi.mocked(getDb).mockImplementation(() => { throw new Error('fail') })
      const result = getHandler('ipc:set-product-availability')({}, {
        productId: PRODUCT_ID, storeId: STORE_ID, available: true,
      }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('DB_ERROR')
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
      const result = await getHandler('ipc:list-catalog-revisions')({}, { storeId: STORE_ID }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('UNAUTHORIZED')
    })
  })

  describe('RESTORE_CATALOG_REVISION', () => {
    it('rechaza payload malformado', async () => {
      const result = await getHandler('ipc:restore-catalog-revision')({}, { storeId: STORE_ID }) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('VALIDATION_ERROR')
    })
  })
})
