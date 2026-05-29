import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerFiscalPaymentHandlers } from '../fiscalPayment.handler'
import type { HardwareManager } from '../../hardware/hardwareManager'
import type { FiscalPaymentResult } from '../../../src/types/hw-api'

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

function makeManager(overrides: Partial<HardwareManager> = {}): HardwareManager {
  return {
    processPayment: vi.fn(async () => ({ ok: true, receiptNumber: 'DEBIT-001' } as FiscalPaymentResult)),
    issueCashReceipt: vi.fn(async () => ({ ok: true, receiptNumber: 'CASH-001' } as FiscalPaymentResult)),
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  } as unknown as HardwareManager
}

function getHandler(channel: string) {
  const call = mockHandle.mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as (_event: unknown, payload: unknown) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processFiscalPayment — zod validation', () => {
  it('rechaza payload undefined', async () => {
    registerFiscalPaymentHandlers(makeManager())
    const handler = getHandler('ipc:process-fiscal-payment')
    const result = await handler(null, undefined)
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('rechaza amount negativo', async () => {
    registerFiscalPaymentHandlers(makeManager())
    const handler = getHandler('ipc:process-fiscal-payment')
    const result = await handler(null, { amount: -100, paymentMethod: 'debit', referenceId: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('rechaza paymentMethod inválido', async () => {
    registerFiscalPaymentHandlers(makeManager())
    const handler = getHandler('ipc:process-fiscal-payment')
    const result = await handler(null, { amount: 100, paymentMethod: 'cash', referenceId: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('rechaza referenceId vacío', async () => {
    registerFiscalPaymentHandlers(makeManager())
    const handler = getHandler('ipc:process-fiscal-payment')
    const result = await handler(null, { amount: 100, paymentMethod: 'debit', referenceId: '' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })
})

describe('processFiscalPayment — happy path', () => {
  it('retorna ok:true con receiptNumber si el pago tiene éxito', async () => {
    const manager = makeManager()
    registerFiscalPaymentHandlers(manager)
    const handler = getHandler('ipc:process-fiscal-payment')

    const result = await handler(null, { amount: 1500, paymentMethod: 'debit', referenceId: 'sale-001' })
    expect(result).toMatchObject({ ok: true, data: { ok: true, receiptNumber: 'DEBIT-001' } })
    expect(manager.processPayment).toHaveBeenCalledWith({
      amount: 1500,
      paymentMethod: 'debit',
      referenceId: 'sale-001',
    })
  })
})

describe('processFiscalPayment — error de negocio', () => {
  it('retorna ok:false si el manager rechaza el pago', async () => {
    const manager = makeManager({
      processPayment: vi.fn(async () => ({ ok: false, error: 'Caja sin conexión' } as FiscalPaymentResult)),
    })
    registerFiscalPaymentHandlers(manager)
    const handler = getHandler('ipc:process-fiscal-payment')

    const result = await handler(null, { amount: 1000, paymentMethod: 'wallet', referenceId: 'sale-002' })
    expect(result).toMatchObject({ ok: false, error: 'Caja sin conexión' })
  })
})

describe('issueCashReceipt — zod validation', () => {
  it('rechaza payload sin amount', async () => {
    registerFiscalPaymentHandlers(makeManager())
    const handler = getHandler('ipc:issue-cash-receipt')
    const result = await handler(null, { referenceId: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('rechaza amount cero', async () => {
    registerFiscalPaymentHandlers(makeManager())
    const handler = getHandler('ipc:issue-cash-receipt')
    const result = await handler(null, { amount: 0, referenceId: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })
})

describe('issueCashReceipt — happy path', () => {
  it('retorna ok:true con receiptNumber', async () => {
    const manager = makeManager()
    registerFiscalPaymentHandlers(manager)
    const handler = getHandler('ipc:issue-cash-receipt')

    const result = await handler(null, { amount: 2000, referenceId: 'sale-003' })
    expect(result).toMatchObject({ ok: true, data: { ok: true, receiptNumber: 'CASH-001' } })
  })
})
