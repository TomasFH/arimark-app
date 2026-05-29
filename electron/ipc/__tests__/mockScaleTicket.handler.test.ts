import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { ipcMain } from 'electron'
import { registerMockOrderHandler } from '../mockOrder.handler'
import type { HardwareManager } from '../../hardware/hardwareManager'

type HandlerFn = (_event: unknown, payload: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const VALID_PAYLOAD = {
  channel: 'A',
  items: [{ productCode: 'ASADO', weightKg: 1.5, unitPrice: 8500 }],
}

describe('mockOrder.handler', () => {
  const injectMockOrder = vi.fn()
  const manager = { injectMockOrder } as unknown as HardwareManager

  beforeEach(() => {
    vi.clearAllMocks()
    process.env['APP_ENV'] = 'sandbox'
    registerMockOrderHandler(manager)
  })

  it('rechaza en producción', () => {
    process.env['APP_ENV'] = 'production'
    registerMockOrderHandler(manager)
    const handler = getHandler('ipc:inject-mock-order')
    const result = handler({}, VALID_PAYLOAD)
    expect(result).toMatchObject({ ok: false, code: 'NOT_SANDBOX' })
  })

  it('rechaza payload sin items', () => {
    const handler = getHandler('ipc:inject-mock-order')
    const result = handler({}, { channel: 'A', items: [] })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('rechaza canal inválido', () => {
    const handler = getHandler('ipc:inject-mock-order')
    const result = handler({}, { channel: 'Z', items: [{ productCode: 'P', weightKg: 1, unitPrice: 100 }] })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })

  it('inyecta pedido válido en sandbox', () => {
    const handler = getHandler('ipc:inject-mock-order')
    const result = handler({}, VALID_PAYLOAD)
    expect(result).toMatchObject({ ok: true })
    expect(injectMockOrder).toHaveBeenCalledWith(VALID_PAYLOAD)
  })

  it('propaga error del manager', () => {
    injectMockOrder.mockImplementation(() => {
      throw new Error('KRETZ mock no conectado')
    })
    const handler = getHandler('ipc:inject-mock-order')
    const result = handler({}, VALID_PAYLOAD) as { ok: boolean; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no conectado')
  })
})
