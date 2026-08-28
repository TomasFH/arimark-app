import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, stockCounts, stockCountItems } from '../../db/schema'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerStockCountHandlers } from '../stockCount.handler'
import type { StockCountDetail, StockCountRow } from '../../../src/types/hw-api'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const CASHIER_SESSION = {
  userId: 'user-001',
  storeId: 'store-001',
  role: 'cashier' as const,
  shiftId: 'shift-001',
}

const ADMIN_SESSION = {
  userId: 'admin-001',
  storeId: 'store-001',
  role: 'admin' as const,
  shiftId: null as string | null,
}

describe('stockCount.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db

    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: new Date().toISOString() }).run()
    db.insert(stores).values({ id: 'store-002', name: 'Local B', createdAt: new Date().toISOString() }).run()
    db.insert(users).values({
      id: 'user-001',
      name: 'Cajera',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()
    db.insert(users).values({
      id: 'admin-001',
      name: 'Admin',
      storeId: 'store-001',
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)

    registerStockCountHandlers()
  })

  describe('CREATE_STOCK_COUNT', () => {
    const validPayload = {
      countDate: '2026-08-02',
      items: [
        { productId: 101, productName: 'Asado', quantityKg: 12500, notes: null },
        { productId: 202, productName: 'Huevos', quantityUnits: 30 },
      ],
    }

    it('crea header + items en transacción', () => {
      const res = getHandler('ipc:create-stock-count')(null, validPayload) as {
        ok: boolean
        data: StockCountDetail
      }
      expect(res.ok).toBe(true)
      expect(res.data.countDate).toBe('2026-08-02')
      expect(res.data.storeName).toBe('Local A')
      expect(res.data.recordedByName).toBe('Cajera')
      expect(res.data.itemCount).toBe(2)
      expect(res.data.items).toHaveLength(2)
      expect(res.data.items.find(i => i.productId === 101)?.quantityKg).toBe(12500)
      expect(res.data.items.find(i => i.productId === 202)?.quantityUnits).toBe(30)

      expect(db.select().from(stockCounts).all()).toHaveLength(1)
      expect(db.select().from(stockCountItems).all()).toHaveLength(2)
    })

    it('admin puede crear sin turno abierto', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:create-stock-count')(null, {
        ...validPayload,
        storeId: 'store-002',
      }) as { ok: boolean; data: StockCountDetail }
      expect(res.ok).toBe(true)
      expect(res.data.storeId).toBe('store-002')
      expect(res.data.storeName).toBe('Local B')
    })

    it('admin sin storeId en payload → INVALID_PAYLOAD (no usa el local default de sesión)', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:create-stock-count')(null, validPayload) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('cajera sin turno → NO_SHIFT', () => {
      vi.mocked(getActiveSession).mockReturnValue({
        ...CASHIER_SESSION,
        shiftId: null,
      } as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:create-stock-count')(null, validPayload) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NO_SHIFT')
    })

    it('rechaza payload malformado (zod)', () => {
      const res = getHandler('ipc:create-stock-count')(null, {
        countDate: 'no-es-fecha',
        items: [],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })

    it('rechaza ítem sin cantidad', () => {
      const res = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-02',
        items: [{ productId: 1, productName: 'X', quantityKg: 0, quantityUnits: 0 }],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('LIST_STOCK_COUNTS', () => {
    it('lista vacía sin conteos', () => {
      const res = getHandler('ipc:list-stock-counts')(null, {}) as {
        ok: boolean
        data: StockCountRow[]
      }
      expect(res.ok).toBe(true)
      expect(res.data).toEqual([])
    })

    it('filtra por storeId y rango de fechas', () => {
      getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-02',
        items: [{ productId: 1, productName: 'A', quantityUnits: 1 }],
      })
      getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-07-20',
        items: [{ productId: 2, productName: 'B', quantityUnits: 2 }],
      })

      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-02',
        storeId: 'store-002',
        items: [{ productId: 3, productName: 'C', quantityUnits: 3 }],
      })

      const filtered = getHandler('ipc:list-stock-counts')(null, {
        storeId: 'store-001',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      }) as { ok: boolean; data: StockCountRow[] }

      expect(filtered.ok).toBe(true)
      expect(filtered.data).toHaveLength(1)
      expect(filtered.data[0].countDate).toBe('2026-08-02')
      expect(filtered.data[0].itemCount).toBe(1)
    })

    it('rechaza rango invertido', () => {
      const res = getHandler('ipc:list-stock-counts')(null, {
        startDate: '2026-08-10',
        endDate: '2026-08-01',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('GET_STOCK_COUNT_DETAIL', () => {
    it('devuelve items ordenados', () => {
      const created = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-02',
        items: [
          { productId: 50, productName: 'Zeta', quantityUnits: 1 },
          { productId: 10, productName: 'Alpha', quantityKg: 500 },
        ],
      }) as { ok: boolean; data: StockCountDetail }

      const res = getHandler('ipc:get-stock-count-detail')(null, {
        stockCountId: created.data.id,
      }) as { ok: boolean; data: StockCountDetail }

      expect(res.ok).toBe(true)
      expect(res.data.items.map(i => i.productId)).toEqual([10, 50])
      expect(res.data.items[0].quantityKg).toBe(500)
    })

    it('NOT_FOUND si el id no existe', () => {
      const res = getHandler('ipc:get-stock-count-detail')(null, {
        stockCountId: 'missing',
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('NOT_FOUND')
    })

    it('rechaza payload inválido', () => {
      const res = getHandler('ipc:get-stock-count-detail')(null, {}) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })

  describe('borrador de conteo', () => {
    const draftPayload = {
      countDate: '2026-08-26',
      status: 'draft' as const,
      items: [{ productId: 1, productName: 'Asado', quantityKg: 10000 }],
    }

    it('guarda un borrador y lo reanuda', () => {
      const saved = getHandler('ipc:create-stock-count')(null, draftPayload) as {
        ok: boolean
        data: StockCountDetail
      }
      expect(saved.ok).toBe(true)
      expect(saved.data.status).toBe('draft')
      expect(saved.data.items[0].quantityKg).toBe(10000)

      const draft = getHandler('ipc:get-draft-stock-count')(null, {}) as {
        ok: boolean
        data: StockCountDetail | null
      }
      expect(draft.ok).toBe(true)
      expect(draft.data?.id).toBe(saved.data.id)
      expect(draft.data?.items).toHaveLength(1)
    })

    it('un segundo borrador del mismo local actualiza el mismo id', () => {
      const first = getHandler('ipc:create-stock-count')(null, draftPayload) as {
        ok: boolean
        data: StockCountDetail
      }
      const second = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-26',
        status: 'draft',
        items: [
          { productId: 1, productName: 'Asado', quantityKg: 8000 },
          { productId: 2, productName: 'Vacío', quantityKg: 1500 },
        ],
      }) as { ok: boolean; data: StockCountDetail }

      expect(second.ok).toBe(true)
      expect(second.data.id).toBe(first.data.id)
      expect(second.data.items).toHaveLength(2)
      expect(db.select().from(stockCounts).all()).toHaveLength(1)
    })

    it('finalizar convierte el borrador; con countDate se reanuda para editar', () => {
      const draft = getHandler('ipc:create-stock-count')(null, draftPayload) as {
        ok: boolean
        data: StockCountDetail
      }
      const final = getHandler('ipc:create-stock-count')(null, {
        id: draft.data.id,
        countDate: '2026-08-26',
        status: 'final',
        items: [{ productId: 1, productName: 'Asado', quantityKg: 8000 }],
      }) as { ok: boolean; data: StockCountDetail }

      expect(final.ok).toBe(true)
      expect(final.data.status).toBe('final')
      expect(final.data.id).toBe(draft.data.id)

      const onlyDraft = getHandler('ipc:get-draft-stock-count')(null, {}) as {
        ok: boolean
        data: StockCountDetail | null
      }
      expect(onlyDraft.data).toBeNull()

      const open = getHandler('ipc:get-draft-stock-count')(null, { countDate: '2026-08-26' }) as {
        ok: boolean
        data: StockCountDetail | null
      }
      expect(open.data?.id).toBe(draft.data.id)
      expect(open.data?.status).toBe('final')
      expect(open.data?.items[0].quantityKg).toBe(8000)
    })

    it('permite actualizar un conteo ya finalizado sin cambiar el autor original', () => {
      const created = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-26',
        items: [{ productId: 1, productName: 'Asado', quantityKg: 1000 }],
      }) as { ok: boolean; data: StockCountDetail }
      expect(created.data.status).toBe('final')
      expect(created.data.recordedBy).toBe('user-001')

      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const res = getHandler('ipc:create-stock-count')(null, {
        id: created.data.id,
        countDate: '2026-08-26',
        storeId: 'store-001',
        status: 'final',
        items: [{ productId: 1, productName: 'Asado', quantityKg: 2000 }],
      }) as { ok: boolean; data: StockCountDetail }

      expect(res.ok).toBe(true)
      expect(res.data.recordedBy).toBe('user-001')
      expect(res.data.lastEditedBy).toBe('admin-001')
      expect(res.data.items[0].quantityKg).toBe(2000)
      expect(res.data.originalItems?.[0].quantityKg).toBe(1000)
      expect(res.data.lastEditedByName).toBe('Admin')
    })

    it('un segundo guardado del mismo día sin id actualiza el conteo existente', () => {
      const first = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-26',
        items: [{ productId: 1, productName: 'Asado', quantityKg: 9000 }],
      }) as { ok: boolean; data: StockCountDetail }

      const second = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-26',
        items: [
          { productId: 1, productName: 'Asado', quantityKg: 9000 },
          { productId: 2, productName: 'Tapa de asado', quantityKg: 10200 },
        ],
      }) as { ok: boolean; data: StockCountDetail }

      expect(second.ok).toBe(true)
      expect(second.data.id).toBe(first.data.id)
      expect(second.data.items).toHaveLength(2)
      expect(db.select().from(stockCounts).all()).toHaveLength(1)
    })

    it('admin reanuda el conteo del día con storeId y countDate', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const created = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-26',
        storeId: 'store-002',
        items: [{ productId: 1, productName: 'Asado', quantityKg: 9000 }],
      }) as { ok: boolean; data: StockCountDetail }

      const open = getHandler('ipc:get-draft-stock-count')(null, {
        storeId: 'store-002',
        countDate: '2026-08-26',
      }) as { ok: boolean; data: StockCountDetail | null }

      expect(open.ok).toBe(true)
      expect(open.data?.id).toBe(created.data.id)
      expect(open.data?.items[0].quantityKg).toBe(9000)
    })

    it('descarta un borrador', () => {
      const draft = getHandler('ipc:create-stock-count')(null, draftPayload) as {
        ok: boolean
        data: StockCountDetail
      }
      const res = getHandler('ipc:discard-stock-count-draft')(null, {
        stockCountId: draft.data.id,
      }) as { ok: boolean }
      expect(res.ok).toBe(true)
      expect(db.select().from(stockCounts).all()).toHaveLength(0)
      expect(db.select().from(stockCountItems).all()).toHaveLength(0)
    })

    it('zod rechaza un conteo final sin ítems', () => {
      const res = getHandler('ipc:create-stock-count')(null, {
        countDate: '2026-08-26',
        status: 'final',
        items: [],
      }) as { ok: boolean; code?: string }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_PAYLOAD')
    })
  })
})
