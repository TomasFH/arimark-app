import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
}))

vi.mock('../auth.handler', () => ({
  getStoredAdminSession: vi.fn().mockReturnValue(null),
  registerAuthHandlers: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerSaleHandlers } from '../sale.handler'
import type { CreateSalePayload } from '../../../src/types/hw-api'

type HandlerFn = (_event: unknown, payload: unknown) => Promise<unknown>
type TestTransaction = (cb: (tx: unknown) => void) => void
type TransactionMock = ReturnType<typeof vi.fn<TestTransaction>>

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const ACTIVE_SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: 'shift-001' }

const VALID_SALE: CreateSalePayload = {
  items: [{ productId: 'prod-001', quantity: 1.5, unitPrice: 2000, subtotal: 3000 }],
  payments: [{ paymentMethod: 'cash', amount: 3000 }],
}

const MULTI_PAYMENT_SALE: CreateSalePayload = {
  items: [{ productId: 'prod-001', quantity: 1, unitPrice: 3000, subtotal: 3000 }],
  payments: [
    { paymentMethod: 'cash', amount: 1000 },
    { paymentMethod: 'debit', amount: 2000 },
  ],
}

function makeMockDb() {
  const mockRun = vi.fn()
  const mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: mockRun }) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockRun }) }),
    }),
  }
  return {
    db: {
      transaction: vi.fn().mockImplementation((cb: (tx: typeof mockTx) => void) => cb(mockTx)),
    } as unknown as ReturnType<typeof getDb>,
    mockRun,
    mockTx,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sale.handler — CREATE_SALE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'dev'
    registerSaleHandlers()
  })

  it('rechaza payload inválido (sin items)', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, { items: [], payments: [{ paymentMethod: 'cash', amount: 100 }] })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('rechaza cuando suma de pagos difiere del total', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      items: [{ productId: 'p1', quantity: 1, unitPrice: 100, subtotal: 100 }],
      payments: [{ paymentMethod: 'cash', amount: 200 }],
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('rechaza si no hay sesión activa', async () => {
    vi.mocked(getActiveSession).mockReturnValue(null)
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, VALID_SALE)
    expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
  })

  it('rechaza si no hay turno activo (shiftId null)', async () => {
    vi.mocked(getActiveSession).mockReturnValue({ ...ACTIVE_SESSION, shiftId: null })
    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, VALID_SALE)
    expect(result).toMatchObject({ ok: false, code: 'NO_SHIFT' })
  })

  it('crea venta en efectivo y retorna saleId', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    const { db } = makeMockDb()
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, VALID_SALE) as { ok: boolean; data: { saleId: string; total: number } }

    expect(result.ok).toBe(true)
    expect(result.data.saleId).toBeTypeOf('string')
    expect(result.data.total).toBe(3000)
  })

  it('acepta notas opcionales en la venta', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    const { db } = makeMockDb()
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, {
      ...VALID_SALE,
      notes: 'Precio especial a familiar',
    }) as { ok: boolean; data: { saleId: string } }

    expect(result.ok).toBe(true)
    expect(result.data.saleId).toBeTypeOf('string')
  })

  it('rechaza venta manual si no hay sesión de admin en producción', async () => {
    process.env['APP_ENV'] = 'production'
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, { ...VALID_SALE, manualEntry: true })
    expect(result).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED' })
  })

  it('registra venta multipago de forma local', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    const { db } = makeMockDb()
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, MULTI_PAYMENT_SALE) as { ok: boolean; data: { saleId: string; total: number } }

    expect(result.ok).toBe(true)
    expect(result.data.total).toBe(3000)
  })

  it('descarta la venta si falla la transacción de confirmación', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    const { db } = makeMockDb()
    const transaction = db.transaction as unknown as TransactionMock
    transaction
      .mockImplementationOnce((cb: (tx: unknown) => void) => cb({
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: vi.fn() }) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
      }))
      .mockImplementationOnce(() => { throw new Error('confirm failed') })
      .mockImplementationOnce((cb: (tx: unknown) => void) => cb({
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
      }))
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, VALID_SALE) as { ok: boolean; code: string }

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DB_ERROR')
    expect(transaction.mock.calls.length).toBe(3)
  })

  /**
   * Test de integración obligatorio (Fase 2):
   * Rollback completo en venta multi-pago si falla la confirmación.
   *
   * Escenario: cajera confirma una venta con efectivo + débito.
   * La transacción de confirmación falla (ej. unique constraint en pagos).
   * Debe: retornar DB_ERROR y marcar la venta como 'discarded'.
   */
  it('[integración] rollback completo en venta multi-pago si falla la confirmación', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    const { db } = makeMockDb()
    const transaction = db.transaction as unknown as TransactionMock

    transaction
      // Fase 1: transacción inicial OK (crea sale + items)
      .mockImplementationOnce((cb: (tx: unknown) => void) => cb({
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: vi.fn() }) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
      }))
      // Fase 2: falla la confirmación (ej. por unique constraint en pagos)
      .mockImplementationOnce(() => { throw new Error('unique constraint on payments') })
      // Fase compensatoria: rollback — marca venta como discarded
      .mockImplementationOnce((cb: (tx: unknown) => void) => cb({
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
      }))

    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, MULTI_PAYMENT_SALE) as { ok: boolean; code: string }

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DB_ERROR')
    // Deben haberse ejecutado 3 transacciones: init, confirm(falla), discard
    expect(transaction.mock.calls.length).toBe(3)
  })
})
