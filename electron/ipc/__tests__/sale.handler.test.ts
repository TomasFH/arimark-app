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
import type { HardwareManager } from '../../hardware/hardwareManager'
import type { CreateSalePayload } from '../../../src/types/hw-api'

type HandlerFn = (_event: unknown, payload: unknown) => Promise<unknown>

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const ACTIVE_SESSION = { userId: 'user-001', storeId: 'store-001', shiftId: 'shift-001' }

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
  scaleOrderId: 'order-001',
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockManager(overrides?: Partial<HardwareManager>): HardwareManager {
  return {
    processPayment: vi.fn().mockResolvedValue({ ok: true, receiptNumber: 'R001' }),
    issueCashReceipt: vi.fn().mockResolvedValue({ ok: true, receiptNumber: 'R002' }),
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  } as unknown as HardwareManager
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
  let manager: HardwareManager

  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'sandbox'
    manager = makeMockManager()
    registerSaleHandlers(manager)
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

  it('rechaza venta manual si no hay sesión de admin en producción', async () => {
    process.env['APP_ENV'] = 'production'
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, { ...VALID_SALE, manualEntry: true })
    expect(result).toMatchObject({ ok: false, code: 'ADMIN_REQUIRED' })
  })

  // ---------------------------------------------------------------------------
  // Test obligatorio: venta multi-pago + rollback si SAM4S falla
  // ---------------------------------------------------------------------------
  it('hace rollback de la venta si el pago digital es rechazado por la caja', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)

    manager = makeMockManager({
      processPayment: vi.fn().mockResolvedValue({ ok: false, error: 'Terminal sin conexión' }),
    })
    // Re-registrar el handler con el nuevo manager
    vi.mocked(ipcMain.handle).mockClear()
    registerSaleHandlers(manager)

    const { db, mockTx } = makeMockDb()
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, MULTI_PAYMENT_SALE) as { ok: boolean; code: string }

    // El handler debe devolver error
    expect(result.ok).toBe(false)
    expect(result.code).toBe('FISCAL_ERROR')

    // La transacción compensatoria debe haberse llamado
    // (2 transaction calls: initial insert + discard rollback)
    const txCalls = vi.mocked(db.transaction).mock.calls
    expect(txCalls.length).toBeGreaterThanOrEqual(2)

    // El UPDATE de discard debe haberse ejecutado
    expect(mockTx.update).toHaveBeenCalled()
  })

  it('confirma la venta aunque el comprobante de efectivo falle (no es crítico)', async () => {
    vi.mocked(getActiveSession).mockReturnValue(ACTIVE_SESSION)
    manager = makeMockManager({
      issueCashReceipt: vi.fn().mockRejectedValue(new Error('SAM4S offline')),
    })
    vi.mocked(ipcMain.handle).mockClear()
    registerSaleHandlers(manager)

    const { db } = makeMockDb()
    vi.mocked(getDb).mockReturnValue(db)

    const handler = getHandler('ipc:create-sale')
    const result = await handler({}, VALID_SALE) as { ok: boolean }

    // Debe confirmar igualmente
    expect(result.ok).toBe(true)
  })
})
