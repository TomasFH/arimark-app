import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import {
  stores,
  users,
  shifts,
  merchandiseIntakes,
  merchandiseIntakeLines,
  expenses,
  products,
  providerDebtEvents,
  providerPurchasePrices,
  providers,
} from '../../db/schema'

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

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-license' })),
}))

vi.mock('../../licensing/merchIntakeSync', () => ({
  pushUnsyncedMerchandiseIntakes: vi.fn().mockResolvedValue(undefined),
  pullMerchandiseIntakesForStoreWeek: vi.fn().mockResolvedValue(0),
}))

vi.mock('../../licensing/merchRubroSync', () => ({
  pushUnsyncedMerchandiseIntakeRubros: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/expenseSync', () => ({
  pushUnsyncedExpenses: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/providerSync', () => ({
  pushUnsyncedProviders: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedDebtEvents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/merchPurchasePriceSync', async () => {
  const actual = await vi.importActual<typeof import('../../licensing/merchPurchasePriceSync')>(
    '../../licensing/merchPurchasePriceSync',
  )
  return {
    applyPurchasePrices: actual.applyPurchasePrices,
    localPurchasePrices: actual.localPurchasePrices,
    pullProviderPurchasePrices: vi.fn().mockResolvedValue(undefined),
    pushUnsyncedProviderPurchasePrices: vi.fn().mockResolvedValue(undefined),
  }
})

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { pullMerchandiseIntakesForStoreWeek } from '../../licensing/merchIntakeSync'
import { registerMerchIntakeHandlers } from '../merchIntake.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls.filter(c => c[0] === channel)
  const call = calls[calls.length - 1]
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001', displayName: 'Ana' }

const MAPLE_LINE = {
  productId: 'prod-maple',
  name: 'Maple',
  catalogUnit: 'unit' as const,
  purchasePackLabel: 'Cajón',
  purchasePackContents: 12,
  kg: null,
  packCount: 2,
  count: null,
  weightsKg: [] as number[],
  unitCost: 9000,
}

const FORM_LINE = {
  key: 'k1',
  productId: 'prod-maple',
  name: 'Maple',
  catalogUnit: 'unit' as const,
  purchasePackLabel: 'Cajón',
  purchasePackContents: 12,
  kgRaw: '',
  packCountRaw: '2',
  countRaw: '',
  weightRaws: [] as string[],
  unitCostRaw: '9000',
  weighPieces: false,
}

describe('merchIntake.handler visita', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
    db.insert(users).values({
      id: 'user-001', name: 'Ana', storeId: 'store-001', role: 'cashier', active: true, createdAt: now,
    }).run()
    db.insert(shifts).values({
      id: 'shift-001', storeId: 'store-001', userId: 'user-001',
      shiftType: 'morning', startedAt: now, openingCash: 0, source: 'desktop',
    }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(SESSION as ReturnType<typeof getActiveSession>)
    registerMerchIntakeHandlers()
  })

  it('rechaza confirmar sin líneas', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [],
      amount: 0,
      acceptPriceUpdates: true,
      provider: 'Oso',
    }) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza visita sin proveedor', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      amount: 0,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  it('guarda centavos en el unitario y redondea el total de la línea', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{
        productId: 'prod-bondiola',
        name: 'Bondiola',
        catalogUnit: 'kg',
        purchasePackLabel: null,
        purchasePackContents: null,
        kg: 5,
        packCount: null,
        count: null,
        weightsKg: [],
        unitCost: 4800.5,
      }],
      provider: 'Oso',
      amount: 24_003,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const line = db.select().from(merchandiseIntakeLines).all()[0]
    expect(line?.unitCost).toBe(4800.5)
    expect(line?.costTotal).toBe(24_003)
    expect(db.select().from(providerPurchasePrices).all()[0]?.unitCost).toBe(4800.5)
    expect(db.select().from(expenses).all()[0]?.amount).toBe(24_003)
    expect(db.select().from(merchandiseIntakes).all()[0]?.paidAmount).toBe(24_003)
  })

  it('confirma maple: cajones, gasto y deuda', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 0,
      newDebtAmount: 18_000,
      acceptPriceUpdates: true,
    }) as { ok: boolean; data?: { id: string; expenseId: string } }
    expect(result.ok).toBe(true)
    const intake = db.select().from(merchandiseIntakes).all()[0]
    const line = db.select().from(merchandiseIntakeLines).all()[0]
    const expense = db.select().from(expenses).all()[0]
    const event = db.select().from(providerDebtEvents).all()[0]
    expect(intake?.status).toBe('confirmed')
    expect(intake?.expenseId).toBe(expense?.id)
    expect(line?.packCount).toBe(2)
    expect(line?.unitCount).toBe(24)
    expect(line?.unitCost).toBe(9000)
    expect(line?.costTotal).toBe(18_000)
    expect(expense?.amount).toBe(0)
    expect(event?.type).toBe('debt')
    expect(event?.amount).toBe(18_000)
    const price = db.select().from(providerPurchasePrices).all()[0]
    expect(price?.unitCost).toBe(9000)
  })

  it('si no acepta el precio nuevo, la memoria queda igual', () => {
    getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 0,
      newDebtAmount: 18_000,
      acceptPriceUpdates: true,
    })
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{ ...MAPLE_LINE, packCount: 1, unitCost: 11_000 }],
      provider: 'Oso',
      amount: 0,
      newDebtAmount: 11_000,
      acceptPriceUpdates: false,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const prices = db.select().from(providerPurchasePrices).all()
    expect(prices).toHaveLength(1)
    expect(prices[0]?.unitCost).toBe(9000)
    const lines = db.select().from(merchandiseIntakeLines).all()
    const last = lines[lines.length - 1]
    expect(last?.unitCost).toBe(11_000)
    expect(last?.costTotal).toBe(11_000)
  })

  it('guarda, lee y descarta el borrador del turno', () => {
    const saved = getHandler('ipc:save-merch-visit-draft')(null, {
      provider: 'Oso',
      lines: [FORM_LINE],
      notes: 'Hielo',
    }) as { ok: boolean; data?: { id: string } }
    expect(saved.ok).toBe(true)
    const draft = getHandler('ipc:get-merch-visit-draft')(null) as {
      ok: boolean
      data: { providerName: string | null; notes: string | null; lines: Array<{ name: string }> } | null
    }
    expect(draft.ok).toBe(true)
    expect(draft.data?.providerName).toBe('Oso')
    expect(draft.data?.notes).toBe('Hielo')
    expect(draft.data?.lines[0]?.name).toBe('Maple')
    const discarded = getHandler('ipc:discard-merch-visit-draft')(null) as { ok: boolean }
    expect(discarded.ok).toBe(true)
    const empty = getHandler('ipc:get-merch-visit-draft')(null) as { data: unknown }
    expect(empty.data).toBeNull()
  })

  it('lista solo visitas confirmadas', async () => {
    getHandler('ipc:save-merch-visit-draft')(null, {
      provider: 'Oso',
      lines: [FORM_LINE],
    })
    const empty = await getHandler('ipc:list-shift-merch')(null) as { ok: boolean; data: unknown[] }
    expect(empty.ok).toBe(true)
    expect(empty.data).toHaveLength(0)

    getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 18_000,
      acceptPriceUpdates: true,
    })
    vi.mocked(pullMerchandiseIntakesForStoreWeek).mockClear()
    const list = await getHandler('ipc:list-shift-merch')(null) as {
      ok: boolean
      data: Array<{ createdByName: string }>
    }
    expect(list.data).toHaveLength(1)
    expect(list.data[0]?.createdByName).toBe('Ana')
    expect(vi.mocked(pullMerchandiseIntakesForStoreWeek)).not.toHaveBeenCalled()
  })

  it('rechaza listado con weekOffset inválido', async () => {
    const result = await getHandler('ipc:list-shift-merch')(null, { weekOffset: 2 }) as {
      ok: boolean
      code?: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('confirma reutilizando el id del borrador', () => {
    const saved = getHandler('ipc:save-merch-visit-draft')(null, {
      provider: 'Oso',
      lines: [FORM_LINE],
    }) as { ok: boolean; data: { id: string } }
    const confirmed = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 0,
      newDebtAmount: 18_000,
      acceptPriceUpdates: true,
    }) as { ok: boolean; data: { id: string } }
    expect(confirmed.ok).toBe(true)
    expect(confirmed.data.id).toBe(saved.data.id)
    expect(db.select().from(merchandiseIntakes).all()).toHaveLength(1)
    expect(db.select().from(merchandiseIntakes).all()[0]?.status).toBe('confirmed')
  })

  it('media res: kilos por pieza, sin gasto ni deuda', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{
        productId: null,
        name: 'Media res',
        catalogUnit: null,
        purchasePackLabel: null,
        purchasePackContents: null,
        kg: null,
        packCount: null,
        count: null,
        weightsKg: [100, 98],
        unitCost: 0,
      }],
      provider: 'Frigorífico',
      visitKind: 'media_res',
      acceptPriceUpdates: false,
    }) as { ok: boolean; data?: { id: string; expenseId: string | null } }
    expect(result.ok).toBe(true)
    expect(result.data?.expenseId).toBeNull()
    const line = db.select().from(merchandiseIntakeLines).all()[0]
    expect(line?.count).toBe(2)
    expect(line?.netKg).toBe(198)
    expect(line?.costTotal).toBe(0)
    expect(line?.productId).toBeNull()
    expect(db.select().from(expenses).all()).toHaveLength(0)
    expect(db.select().from(providerDebtEvents).all()).toHaveLength(0)
  })

  it('pollo: cajones × precio, kilos como hecho', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{
        productId: null,
        name: 'Pollo',
        catalogUnit: 'unit',
        purchasePackLabel: 'Cajón',
        purchasePackContents: null,
        kg: null,
        packCount: 2,
        count: null,
        weightsKg: [18, 19],
        unitCost: 9000,
        costUnit: 'pack',
      }],
      provider: 'Granja',
      visitKind: 'chicken',
      amount: 0,
      newDebtAmount: 18_000,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const line = db.select().from(merchandiseIntakeLines).all()[0]
    expect(line?.packCount).toBe(2)
    expect(line?.netKg).toBe(37)
    expect(line?.costUnit).toBe('pack')
    expect(line?.costTotal).toBe(18_000)
    expect(db.select().from(expenses).all()).toHaveLength(1)
    expect(db.select().from(providerDebtEvents).all()[0]?.type).toBe('debt')
  })

  it('persiste intake_kind del proveedor al confirmar', () => {
    getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{
        productId: null,
        name: 'Media res',
        catalogUnit: null,
        purchasePackLabel: null,
        purchasePackContents: null,
        kg: null,
        packCount: null,
        count: null,
        weightsKg: [110],
        unitCost: 0,
      }],
      provider: 'Frigorífico Sur',
      visitKind: 'media_res',
      notes: 'sin hueso',
      acceptPriceUpdates: false,
    })
    const row = db.select().from(providers).all()[0]
    expect(row?.intakeKind).toBe('media_res')
    expect(db.select().from(merchandiseIntakes).all()[0]?.notes).toBe('sin hueso')
  })

  it('media res rechaza si el renglón no es por pieza', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Frigorífico',
      visitKind: 'media_res',
      acceptPriceUpdates: false,
    }) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_LINE')
  })

  it('rechaza producto sin precio de compra', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{ ...MAPLE_LINE, unitCost: 0 }],
      provider: 'Oso',
      amount: 0,
      acceptPriceUpdates: true,
    }) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_LINE')
  })

  it('confirma con pago de deuda anterior sin sumarla al paidAmount', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 20_000,
      newDebtAmount: 0,
      paysOldDebt: 2_000,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(db.select().from(expenses).all()[0]?.amount).toBe(22_000)
    expect(db.select().from(merchandiseIntakes).all()[0]?.paidAmount).toBe(20_000)
    const events = db.select().from(providerDebtEvents).all()
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('payment')
    expect(events[0]?.amount).toBe(2_000)
  })

  it('visita con deuda vieja: la caja suma y el intake queda en la visita', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{ ...MAPLE_LINE, packCount: 1, unitCost: 100_000 }],
      provider: 'Guido',
      amount: 100_000,
      paysOldDebt: 2_634_642,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(db.select().from(expenses).all()[0]?.amount).toBe(2_734_642)
    expect(db.select().from(merchandiseIntakes).all()[0]?.paidAmount).toBe(100_000)
    const payment = db.select().from(providerDebtEvents).all()[0]
    expect(payment?.type).toBe('payment')
    expect(payment?.amount).toBe(2_634_642)
  })

  it('el exceso local de una visita cross no va al local ajeno', () => {
    const now = new Date().toISOString()
    db.insert(stores).values({ id: 'store-002', name: 'Local 2', createdAt: now }).run()
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 18_000,
      paysOldDebt: 5_000,
      debtStoreId: 'store-002',
      crossStorePayment: 2_000,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(db.select().from(expenses).all()[0]?.amount).toBe(23_000)
    expect(db.select().from(merchandiseIntakes).all()[0]?.paidAmount).toBe(18_000)
    const payments = db.select().from(providerDebtEvents).all()
    expect(payments.find(e => e.storeId === 'store-002')?.amount).toBe(2_000)
    expect(payments.find(e => e.storeId === 'store-001')?.amount).toBe(3_000)
  })

  it('rechaza proveedorId inexistente y visita sin sesión', () => {
    const missing = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      providerId: 'no-existe',
      amount: 0,
      acceptPriceUpdates: true,
    }) as { ok: boolean; code?: string }
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('PROVIDER_NOT_FOUND')

    vi.mocked(getActiveSession).mockReturnValue(null)
    const noSession = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 0,
      acceptPriceUpdates: true,
    }) as { ok: boolean; code?: string }
    expect(noSession.code).toBe('NO_SESSION')
  })

  it('rechaza confirmar sin turno', () => {
    vi.mocked(getActiveSession).mockReturnValue({
      ...SESSION,
      shiftId: null,
    })
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 0,
      acceptPriceUpdates: true,
    }) as { ok: boolean; code?: string }
    expect(result.code).toBe('NO_SHIFT')
  })

  it('lee costos de compra y rubros; cajera no crea rubro', async () => {
    getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 0,
      newDebtAmount: 18_000,
      acceptPriceUpdates: true,
    })
    const providerId = db.select().from(providers).all()[0]?.id
    const prices = await getHandler('ipc:get-provider-purchase-prices')(null, { providerId }) as {
      ok: boolean
      data: Array<{ unitCost: number }>
    }
    expect(prices.ok).toBe(true)
    expect(prices.data[0]?.unitCost).toBe(9000)

    const invalidPrices = await getHandler('ipc:get-provider-purchase-prices')(null, {}) as { code?: string }
    expect(invalidPrices.code).toBe('INVALID_PAYLOAD')

    const rubros = getHandler('ipc:list-merch-rubros')(null, {}) as { ok: boolean; data: unknown[] }
    expect(rubros.ok).toBe(true)
    expect(rubros.data.length).toBeGreaterThan(0)

    const forbidden = getHandler('ipc:create-merch-rubro')(null, {
      name: 'Costilla',
      template: 'weight',
    }) as { ok: boolean; code?: string }
    expect(forbidden.code).toBe('FORBIDDEN')
  })

  it('admin crea, archiva y desarchiva un rubro', () => {
    vi.mocked(getActiveSession).mockReturnValue({
      ...SESSION,
      role: 'admin',
    } as ReturnType<typeof getActiveSession>)
    const created = getHandler('ipc:create-merch-rubro')(null, {
      name: 'Costilla',
      template: 'weight',
    }) as { ok: boolean; data: { id: string; name: string } }
    expect(created.ok).toBe(true)
    expect(created.data.name).toBe('Costilla')

    const updated = getHandler('ipc:update-merch-rubro')(null, {
      id: created.data.id,
      name: 'Costilla vacía',
    }) as { ok: boolean; data: { name: string } }
    expect(updated.data.name).toBe('Costilla vacía')

    const archived = getHandler('ipc:archive-merch-rubro')(null, { id: created.data.id }) as { ok: boolean }
    expect(archived.ok).toBe(true)
    const hidden = getHandler('ipc:list-merch-rubros')(null, {}) as { data: Array<{ id: string }> }
    expect(hidden.data.some(r => r.id === created.data.id)).toBe(false)
    const withArchived = getHandler('ipc:list-merch-rubros')(null, { includeArchived: true }) as {
      data: Array<{ id: string }>
    }
    expect(withArchived.data.some(r => r.id === created.data.id)).toBe(true)

    const restored = getHandler('ipc:unarchive-merch-rubro')(null, { id: created.data.id }) as { ok: boolean }
    expect(restored.ok).toBe(true)
  })

  it('rechaza visitKind inválido y draft malformado', () => {
    const kind = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      visitKind: 'catalogo',
      amount: 0,
      acceptPriceUpdates: true,
    }) as { ok: boolean; code?: string }
    expect(kind.code).toBe('INVALID_PAYLOAD')

    const draft = getHandler('ipc:save-merch-visit-draft')(null, { lines: 'no' }) as { code?: string }
    expect(draft.code).toBe('INVALID_PAYLOAD')
  })

  it('list-shift-merch pide pull si la semana está vacía', async () => {
    const list = await getHandler('ipc:list-shift-merch')(null, { weekOffset: -1 }) as {
      ok: boolean
      data: unknown[]
    }
    expect(list.ok).toBe(true)
    expect(list.data).toHaveLength(0)
    expect(vi.mocked(pullMerchandiseIntakesForStoreWeek)).toHaveBeenCalled()
  })

  it('rechaza un renglón que se paga sin precio', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{ ...MAPLE_LINE, unitCost: 0 }],
      provider: 'Oso',
      amount: 0,
      acceptPriceUpdates: true,
    }) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_LINE')
  })

  it('no duplica la visita si la pantalla reintenta la misma confirmación', () => {
    const clientRequestId = '6f1e8b2a-1c3d-4e5f-9a0b-1c2d3e4f5a6b'
    const payload = {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 18_000,
      acceptPriceUpdates: true,
      clientRequestId,
    }
    const first = getHandler('ipc:confirm-merch-visit')(null, payload) as { ok: boolean; data: { id: string } }
    const second = getHandler('ipc:confirm-merch-visit')(null, payload) as { ok: boolean; data: { id: string } }
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.data.id).toBe(first.data.id)
    expect(db.select().from(merchandiseIntakes).all()).toHaveLength(1)
    expect(db.select().from(expenses).all()).toHaveLength(1)
  })

  it('el pago digital baja la deuda y no mueve la caja', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [MAPLE_LINE],
      provider: 'Oso',
      amount: 18_000,
      paysOldDebt: 2_000,
      acceptPriceUpdates: true,
      paymentChannel: 'digital',
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(db.select().from(expenses).all()[0]?.amount).toBe(0)
    const payment = db.select().from(providerDebtEvents).all().find(e => e.type === 'payment')
    expect(payment?.amount).toBe(2_000)
    expect(db.select().from(merchandiseIntakes).all()[0]?.paymentChannel).toBe('digital')
    expect(db.select().from(merchandiseIntakes).all()[0]?.paidAmount).toBe(18_000)
  })

  it('crea el producto al confirmar y descartar el borrador no lo crea', () => {
    const discarded = getHandler('ipc:save-merch-visit-draft')(null, {
      provider: 'Oso',
      lines: [{
        ...FORM_LINE,
        productId: null,
        name: 'Corte nuevo',
        catalogUnit: 'kg',
        kgRaw: '2',
        packCountRaw: '',
        unitCostRaw: '1.000,00',
      }],
    }) as { ok: boolean }
    expect(discarded.ok).toBe(true)
    expect(db.select().from(products).all()).toHaveLength(0)
    getHandler('ipc:discard-merch-visit-draft')(null)
    expect(db.select().from(products).all()).toHaveLength(0)

    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{
        productId: null,
        name: 'Corte nuevo',
        catalogUnit: 'kg',
        purchasePackLabel: null,
        purchasePackContents: null,
        kg: 2,
        packCount: null,
        count: null,
        weightsKg: [],
        unitCost: 1000,
      }],
      provider: 'Oso',
      amount: 2_000,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const created = db.select().from(products).all()
    expect(created).toHaveLength(1)
    expect(created[0]?.pluNumber ?? null).toBeNull()
    expect(created[0]?.name).toBe('Corte nuevo')
    const line = db.select().from(merchandiseIntakeLines).all()[0]
    expect(line?.rubroName).toBe('Corte nuevo')
    expect(line?.costTotal).toBe(2_000)
    db.update(products).set({ active: false }).run()
    const after = db.select().from(merchandiseIntakeLines).all()[0]
    expect(after?.rubroName).toBe('Corte nuevo')
    expect(after?.costTotal).toBe(2_000)
  })

  it('el costo informado no entra a la caja ni a la deuda', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [
        MAPLE_LINE,
        {
          productId: null,
          name: 'Media res',
          catalogUnit: null,
          purchasePackLabel: null,
          purchasePackContents: null,
          kg: null,
          packCount: null,
          count: null,
          weightsKg: [100],
          unitCost: 2000,
          moneyRole: 'informed',
        },
      ],
      provider: 'Oso',
      amount: 18_000,
      acceptPriceUpdates: false,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(db.select().from(expenses).all()[0]?.amount).toBe(18_000)
    expect(db.select().from(providerDebtEvents).all()).toHaveLength(0)
    const media = db.select().from(merchandiseIntakeLines).all().find(l => l.rubroName === 'Media res')
    expect(media?.moneyRole).toBe('informed')
    expect(media?.costTotal).toBe(200_000)
  })

  it('no se vende suma y no crea producto', () => {
    const result = getHandler('ipc:confirm-merch-visit')(null, {
      lines: [{
        productId: null,
        name: 'Lavandina',
        catalogUnit: 'unit',
        purchasePackLabel: null,
        purchasePackContents: null,
        kg: null,
        packCount: null,
        count: 2,
        weightsKg: [],
        unitCost: 1500,
        notForSale: true,
      }],
      provider: 'Oso',
      amount: 3_000,
      acceptPriceUpdates: true,
    }) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(db.select().from(products).all()).toHaveLength(0)
    expect(db.select().from(expenses).all()[0]?.amount).toBe(3_000)
    expect(db.select().from(merchandiseIntakeLines).all()[0]?.notForSale).toBe(true)
  })
})
