import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { registerKretzSyncHandler } from '../kretzSync.handler'
import type { HardwareManager } from '../../hardware/hardwareManager'

type HandlerFn = (event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const STORE_ID = 'local1'

const PRODUCTS = [
  { id: 'p1', name: 'Asado', unit: 'kg', pluNumber: 1 },
  { id: 'p2', name: 'Pollo', unit: 'kg', pluNumber: 100 },
  { id: 'p3', name: 'Sin precio', unit: 'kg', pluNumber: 200 },
  { id: 'p4', name: 'Carísimo', unit: 'kg', pluNumber: 300 },
]

const PRICES = [
  { productId: 'p1', price: 18000, validFrom: '2026-01-01T00:00:00.000Z' },
  { productId: 'p2', price: 9000, validFrom: '2026-01-01T00:00:00.000Z' },
  // p3 no tiene precio
  { productId: 'p4', price: 200000, validFrom: '2026-01-01T00:00:00.000Z' }, // > 99999 → price_too_high
]

/** getDb mock: primer select → productos, segundo → precios. */
function makeDb(productRows = PRODUCTS, priceRows = PRICES) {
  let call = 0
  const db = {
    select: vi.fn().mockImplementation(() => {
      call++
      const resp = call === 1 ? productRows : priceRows
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(resp) }),
            all: vi.fn().mockReturnValue(resp),
          }),
        }),
      }
    }),
  }
  return db as unknown as ReturnType<typeof getDb>
}

/** Evento IPC mock con sender que captura los progress. */
function makeEvent() {
  const sent: unknown[] = []
  const event = {
    sender: {
      isDestroyed: () => false,
      send: (_channel: string, payload: unknown) => { sent.push(payload) },
    },
  }
  return { event, sent }
}

function makeManager(overrides: Partial<HardwareManager> = {}): HardwareManager {
  return {
    kretzTestLink: vi.fn().mockResolvedValue(true),
    kretzSendPlu: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as HardwareManager
}

describe('kretzSync.handler — KRETZ_SYNC_CATALOG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rechaza storeId inválido', async () => {
    registerKretzSyncHandler(makeManager())
    const { event } = makeEvent()
    const result = await getHandler('ipc:kretz-sync-catalog')(event, '') as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VALIDATION_ERROR')
  })

  it('aborta con NO_SCALE si la balanza no responde al enlace', async () => {
    const manager = makeManager({ kretzTestLink: vi.fn().mockResolvedValue(false) })
    registerKretzSyncHandler(manager)
    const { event } = makeEvent()
    const result = await getHandler('ipc:kretz-sync-catalog')(event, STORE_ID) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SCALE')
    expect(manager.kretzSendPlu).not.toHaveBeenCalled()
  })

  it('aborta con NO_SCALE si testLink lanza excepción', async () => {
    const manager = makeManager({ kretzTestLink: vi.fn().mockRejectedValue(new Error('puerto ocupado')) })
    registerKretzSyncHandler(manager)
    const { event } = makeEvent()
    const result = await getHandler('ipc:kretz-sync-catalog')(event, STORE_ID) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_SCALE')
  })

  it('envía los productos con precio y omite los que no corresponden', async () => {
    const manager = makeManager()
    vi.mocked(getDb).mockReturnValue(makeDb())
    registerKretzSyncHandler(manager)
    const { event } = makeEvent()

    const result = await getHandler('ipc:kretz-sync-catalog')(event, STORE_ID) as {
      ok: boolean
      data: { total: number; succeeded: number; failed: unknown[]; skipped: { reason: string; pluNumber: number | null }[] }
    }

    expect(result.ok).toBe(true)
    // p1 y p2 se envían; p3 (sin precio) y p4 (precio alto) se omiten
    expect(result.data.total).toBe(2)
    expect(result.data.succeeded).toBe(2)
    expect(result.data.failed).toHaveLength(0)
    expect(result.data.skipped).toHaveLength(2)
    expect(result.data.skipped.find(s => s.pluNumber === 200)?.reason).toBe('no_price')
    expect(result.data.skipped.find(s => s.pluNumber === 300)?.reason).toBe('price_too_high')
    expect(manager.kretzSendPlu).toHaveBeenCalledTimes(2)
  })

  it('convierte el precio a raw (pesos × 10) y setea pesable según la unidad', async () => {
    const manager = makeManager()
    vi.mocked(getDb).mockReturnValue(makeDb(
      [{ id: 'p1', name: 'Asado', unit: 'kg', pluNumber: 1 }],
      [{ productId: 'p1', price: 18000, validFrom: '2026-01-01T00:00:00.000Z' }],
    ))
    registerKretzSyncHandler(manager)
    const { event } = makeEvent()

    await getHandler('ipc:kretz-sync-catalog')(event, STORE_ID)

    expect(manager.kretzSendPlu).toHaveBeenCalledWith(expect.objectContaining({
      pluNumber: '1',
      priceCents: 180000, // 18000 × 10
      pesable: true,
      priceDigits: 6,
      articleCode: '00001',
    }))
  })

  it('emite eventos de progreso sending/ok por cada PLU', async () => {
    const manager = makeManager()
    vi.mocked(getDb).mockReturnValue(makeDb(
      [{ id: 'p1', name: 'Asado', unit: 'kg', pluNumber: 1 }],
      [{ productId: 'p1', price: 18000, validFrom: '2026-01-01T00:00:00.000Z' }],
    ))
    registerKretzSyncHandler(manager)
    const { event, sent } = makeEvent()

    await getHandler('ipc:kretz-sync-catalog')(event, STORE_ID)

    const statuses = (sent as { status: string }[]).map(s => s.status)
    expect(statuses).toContain('sending')
    expect(statuses).toContain('ok')
  })

  it('registra el PLU en failed si el envío lanza, sin abortar el resto', async () => {
    const manager = makeManager({
      kretzSendPlu: vi.fn()
        .mockRejectedValueOnce(new Error('Error de longitud de datos'))
        .mockResolvedValueOnce(undefined),
    })
    vi.mocked(getDb).mockReturnValue(makeDb(
      [
        { id: 'p1', name: 'Asado', unit: 'kg', pluNumber: 1 },
        { id: 'p2', name: 'Pollo', unit: 'kg', pluNumber: 100 },
      ],
      [
        { productId: 'p1', price: 18000, validFrom: '2026-01-01T00:00:00.000Z' },
        { productId: 'p2', price: 9000, validFrom: '2026-01-01T00:00:00.000Z' },
      ],
    ))
    registerKretzSyncHandler(manager)
    const { event } = makeEvent()

    const result = await getHandler('ipc:kretz-sync-catalog')(event, STORE_ID) as {
      ok: boolean
      data: { succeeded: number; failed: { pluNumber: number }[] }
    }

    expect(result.ok).toBe(true)
    expect(result.data.succeeded).toBe(1)
    expect(result.data.failed).toHaveLength(1)
    expect(result.data.failed[0]?.pluNumber).toBe(1)
    expect(manager.kretzSendPlu).toHaveBeenCalledTimes(2)
  })

  it('retorna DB_ERROR si la lectura del catálogo falla', async () => {
    const manager = makeManager()
    vi.mocked(getDb).mockImplementation(() => { throw new Error('db fail') })
    registerKretzSyncHandler(manager)
    const { event } = makeEvent()

    const result = await getHandler('ipc:kretz-sync-catalog')(event, STORE_ID) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('DB_ERROR')
  })
})
