import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerKretzPluHandlers } from '../kretzPlu.handler'
import type { HardwareManager } from '../../hardware/hardwareManager'
import type { PluRow } from '../../../src/types/hw-api'

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const samplePlu: PluRow = {
  number: '000001',
  name: 'ASADO',
  code: '00001',
  price: '850000',
  type: 'pesable',
}

function makeManager(overrides: Partial<HardwareManager> = {}): HardwareManager {
  return {
    kretzTestLink: vi.fn(async () => true),
    kretzSendPlu: vi.fn(async () => undefined),
    kretzDeletePlu: vi.fn(async () => undefined),
    kretzReadPlu: vi.fn(async () => samplePlu),
    kretzReadPluCount: vi.fn(async () => 5),
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

// ---------------------------------------------------------------------------
// kretz-test-link
// ---------------------------------------------------------------------------

describe('kretzTestLink', () => {
  it('devuelve { ok: true, data: { linked: true } } cuando la balanza responde', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-test-link')
    const result = await handler(null, undefined) as { ok: boolean; data: { linked: boolean } }
    expect(result.ok).toBe(true)
    expect(result.data.linked).toBe(true)
  })

  it('devuelve { ok: false } cuando el driver lanza', async () => {
    const manager = makeManager({
      kretzTestLink: vi.fn(async () => { throw new Error('Puerto cerrado') }),
    })
    registerKretzPluHandlers(manager)
    const handler = getHandler('ipc:kretz-test-link')
    const result = await handler(null, undefined) as { ok: boolean; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Puerto cerrado')
  })
})

// ---------------------------------------------------------------------------
// kretz-send-plu
// ---------------------------------------------------------------------------

describe('kretzSendPlu', () => {
  const validPayload = {
    pluNumber: '1',
    name: 'ASADO',
    pesable: true,
    priceCents: 850000,
  }

  it('llama kretzSendPlu y devuelve ok con el número de PLU', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-send-plu')
    const result = await handler(null, validPayload) as { ok: boolean; data: { pluNumber: string } }
    expect(result.ok).toBe(true)
    expect(result.data.pluNumber).toBe('1')
  })

  it('rechaza payload con nombre faltante', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-send-plu')
    const result = await handler(null, { pluNumber: '1', pesable: true, priceCents: 100 }) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('rechaza payload con priceCents negativo', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-send-plu')
    const result = await handler(null, { ...validPayload, priceCents: -100 }) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  it('rechaza payload undefined', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-send-plu')
    const result = await handler(null, undefined) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  it('devuelve error si el driver lanza', async () => {
    const manager = makeManager({
      kretzSendPlu: vi.fn(async () => { throw new Error('Error de escritura') }),
    })
    registerKretzPluHandlers(manager)
    const handler = getHandler('ipc:kretz-send-plu')
    const result = await handler(null, validPayload) as { ok: boolean; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Error de escritura')
  })
})

// ---------------------------------------------------------------------------
// kretz-delete-plu
// ---------------------------------------------------------------------------

describe('kretzDeletePlu', () => {
  it('llama kretzDeletePlu y devuelve ok con el número de PLU', async () => {
    const manager = makeManager()
    registerKretzPluHandlers(manager)
    const handler = getHandler('ipc:kretz-delete-plu')
    const result = await handler(null, { pluNumber: '6' }) as { ok: boolean; data: { pluNumber: string } }

    expect(result.ok).toBe(true)
    expect(result.data.pluNumber).toBe('6')
    expect(manager.kretzDeletePlu).toHaveBeenCalledWith('6')
  })

  it('rechaza payload inválido', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-delete-plu')
    const result = await handler(null, {}) as { ok: boolean; code?: string }

    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PAYLOAD')
  })

  it('devuelve error si el driver lanza', async () => {
    const manager = makeManager({
      kretzDeletePlu: vi.fn(async () => { throw new Error('PLU inexistente') }),
    })
    registerKretzPluHandlers(manager)
    const handler = getHandler('ipc:kretz-delete-plu')
    const result = await handler(null, { pluNumber: '999' }) as { ok: boolean; error: string }

    expect(result.ok).toBe(false)
    expect(result.error).toContain('PLU inexistente')
  })
})

// ---------------------------------------------------------------------------
// kretz-read-plu
// ---------------------------------------------------------------------------

describe('kretzReadPlu', () => {
  it('devuelve el PLU cuando existe', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-read-plu')
    const result = await handler(null, { pluNumber: '1' }) as { ok: boolean; data: PluRow }
    expect(result.ok).toBe(true)
    expect(result.data.name).toBe('ASADO')
  })

  it('devuelve data: null cuando el PLU no existe', async () => {
    const manager = makeManager({ kretzReadPlu: vi.fn(async () => null) })
    registerKretzPluHandlers(manager)
    const handler = getHandler('ipc:kretz-read-plu')
    const result = await handler(null, { pluNumber: '999' }) as { ok: boolean; data: null }
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })

  it('rechaza payload inválido (número faltante)', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-read-plu')
    const result = await handler(null, {}) as { ok: boolean }
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// kretz-read-plu-count
// ---------------------------------------------------------------------------

describe('kretzReadPluCount', () => {
  it('devuelve la cantidad de PLUs', async () => {
    registerKretzPluHandlers(makeManager())
    const handler = getHandler('ipc:kretz-read-plu-count')
    const result = await handler(null, undefined) as { ok: boolean; data: { count: number } }
    expect(result.ok).toBe(true)
    expect(result.data.count).toBe(5)
  })

  it('devuelve error si el driver lanza', async () => {
    const manager = makeManager({
      kretzReadPluCount: vi.fn(async () => { throw new Error('Sin conexión') }),
    })
    registerKretzPluHandlers(manager)
    const handler = getHandler('ipc:kretz-read-plu-count')
    const result = await handler(null, undefined) as { ok: boolean; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Sin conexión')
  })
})
