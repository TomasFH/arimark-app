/**
 * La caché del período es por local y por rango.
 * Una semana cerrada no se vuelve a leer en la misma sesión.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetDocs } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, ...parts: string[]) => parts.join('/')),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((...args: unknown[]) => args),
  orderBy: vi.fn((...args: unknown[]) => args),
  limit: vi.fn((n: number) => n),
  getDocs: mockGetDocs,
}))

vi.mock('../../licensing/firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  isFirebaseAvailable: vi.fn(() => true),
}))

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'lic' })),
}))

import { PERIOD_FIADO_LIMIT } from '@carniceria/shared'
import { clearPeriodFiadoCache, loadPeriodFiado } from '../periodFiado'

const CLOSED_START = '2026-11-09T03:00:00.000Z'
const CLOSED_END = '2026-11-16T03:00:00.000Z'
const OTHER_START = '2026-11-02T03:00:00.000Z'
const OPEN_END = '2026-11-23T03:00:00.000Z'
const NOW = new Date('2026-11-20T15:00:00.000Z')
const AT = '2026-11-15T22:00:00.000-03:00'

function doc(amount: number, eventType = 'created') {
  return {
    id: `e-${amount}-${Math.random()}`,
    data: () => ({
      eventType,
      amount,
      createdAt: AT,
      shiftId: eventType === 'paid' ? null : 'turno',
      storeId: 'norte',
    }),
  }
}

describe('loadPeriodFiado', () => {
  beforeEach(() => {
    clearPeriodFiadoCache()
    mockGetDocs.mockReset()
  })

  it('pide ese local y ese rango, con tope 500', async () => {
    mockGetDocs.mockResolvedValue({ docs: [doc(4_500), doc(800, 'paid')] })
    const account = await loadPeriodFiado({
      storeId: 'norte',
      startIso: CLOSED_START,
      endIso: CLOSED_END,
      now: NOW,
    })
    expect(account).toEqual({
      newDebt: 4_500,
      collections: 800,
      unshifted: 800,
      incomplete: false,
    })
    const constraints = mockGetDocs.mock.calls[0]?.[0] as unknown[]
    expect(constraints).toContain('licenses/lic/customerDebtEvents')
    expect(constraints).toContainEqual(['storeId', '==', 'norte'])
    expect(constraints).toContainEqual(['createdAt', '>=', CLOSED_START])
    expect(constraints).toContainEqual(['createdAt', '<', CLOSED_END])
    expect(constraints).toContain(PERIOD_FIADO_LIMIT)
  })

  it('una semana cerrada no se vuelve a leer, y otro rango u otro local sí', async () => {
    mockGetDocs.mockResolvedValue({ docs: [doc(100)] })
    const first = await loadPeriodFiado({
      storeId: 'norte',
      startIso: CLOSED_START,
      endIso: CLOSED_END,
      now: NOW,
    })
    const second = await loadPeriodFiado({
      storeId: 'norte',
      startIso: CLOSED_START,
      endIso: CLOSED_END,
      now: NOW,
    })
    expect(second).toEqual(first)
    expect(mockGetDocs).toHaveBeenCalledTimes(1)

    await loadPeriodFiado({
      storeId: 'norte',
      startIso: OTHER_START,
      endIso: CLOSED_START,
      now: NOW,
    })
    await loadPeriodFiado({
      storeId: 'sur',
      startIso: CLOSED_START,
      endIso: CLOSED_END,
      now: NOW,
    })
    expect(mockGetDocs).toHaveBeenCalledTimes(3)
    const ranges = mockGetDocs.mock.calls.map(call => (call[0] as unknown[]).filter(item => (
      Array.isArray(item) && item[0] === 'storeId'
    )))
    expect(ranges).toEqual([
      [['storeId', '==', 'norte']],
      [['storeId', '==', 'norte']],
      [['storeId', '==', 'sur']],
    ])
  })

  it('al llegar a 500 no guarda un total y la semana cerrada no se reintenta', async () => {
    mockGetDocs.mockResolvedValue({
      docs: Array.from({ length: PERIOD_FIADO_LIMIT }, () => doc(10)),
    })
    const full = await loadPeriodFiado({
      storeId: 'norte',
      startIso: CLOSED_START,
      endIso: CLOSED_END,
      now: NOW,
    })
    expect(full).toEqual({
      newDebt: null,
      collections: null,
      unshifted: null,
      incomplete: true,
    })
    await loadPeriodFiado({
      storeId: 'norte',
      startIso: CLOSED_START,
      endIso: CLOSED_END,
      now: NOW,
    })
    expect(mockGetDocs).toHaveBeenCalledTimes(1)
  })

  it('la semana en curso se vuelve a pedir', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] })
    const input = {
      storeId: 'norte',
      startIso: CLOSED_END,
      endIso: OPEN_END,
      now: NOW,
    }
    await loadPeriodFiado(input)
    await loadPeriodFiado(input)
    expect(mockGetDocs).toHaveBeenCalledTimes(2)
  })

  it('un error no queda guardado', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('red'))
    const input = {
      storeId: 'norte',
      startIso: CLOSED_START,
      endIso: CLOSED_END,
      now: NOW,
    }
    await expect(loadPeriodFiado(input)).rejects.toThrow('red')
    mockGetDocs.mockResolvedValue({ docs: [doc(100)] })
    const again = await loadPeriodFiado(input)
    expect(again.newDebt).toBe(100)
    expect(mockGetDocs).toHaveBeenCalledTimes(2)
  })
})
