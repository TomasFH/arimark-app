/**
 * El historial pide una página de 30. "Ver más" sigue después de esa página.
 * El nombre no se lee: la consulta es solo customerDebtEvents.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  startAfter: vi.fn((cursor: unknown) => ({ tag: 'startAfter', cursor })),
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

import { collection } from 'firebase/firestore'
import { CUSTOMER_HISTORY_LIMIT } from '@carniceria/shared'
import { clearCustomerHistoryCursors, loadCustomerHistory } from '../customerHistory'

function doc(id: string, amount = 100) {
  return {
    id,
    data: () => ({
      eventType: 'created',
      amount,
      createdAt: '2026-11-15T22:00:00.000-03:00',
      shiftId: 'turno',
    }),
  }
}

function hasCursor(queryArgs: unknown[]): boolean {
  return queryArgs.some(item => (
    typeof item === 'object' && item != null && (item as { tag?: string }).tag === 'startAfter'
  ))
}

describe('índice del período', () => {
  it('queda en el archivo, junto al índice que ya ordena el historial', () => {
    const path = resolve(__dirname, '../../../../../firebase/firestore.indexes.json')
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }>
    }
    const events = raw.indexes.filter(index => index.collectionGroup === 'customerDebtEvents')
    expect(events.map(index => index.fields)).toEqual([
      [
        { fieldPath: 'customerId', order: 'ASCENDING' },
        { fieldPath: 'storeId', order: 'ASCENDING' },
        { fieldPath: 'createdAtServer', order: 'ASCENDING' },
      ],
      [
        { fieldPath: 'storeId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'ASCENDING' },
      ],
    ])
  })
})

describe('loadCustomerHistory', () => {
  beforeEach(() => {
    clearCustomerHistoryCursors()
    mockGetDocs.mockReset()
    vi.mocked(collection).mockClear()
  })

  it('pide 30 movimientos de ese cliente y ese local, sin leer la ficha', async () => {
    expect(CUSTOMER_HISTORY_LIMIT).toBe(30)
    mockGetDocs.mockResolvedValue({ docs: [doc('nuevo', 4500), doc('viejo', 200)] })
    const page = await loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: false })
    expect(page).toEqual({
      moves: [
        { id: 'nuevo', eventType: 'created', amount: 4500, createdAt: '2026-11-15T22:00:00.000-03:00', shiftId: 'turno' },
        { id: 'viejo', eventType: 'created', amount: 200, createdAt: '2026-11-15T22:00:00.000-03:00', shiftId: 'turno' },
      ],
      hasMore: false,
    })
    expect(page.moves[0]).not.toHaveProperty('name')
    const constraints = mockGetDocs.mock.calls[0]?.[0] as unknown[]
    expect(constraints).toContain('licenses/lic/customerDebtEvents')
    expect(constraints).toContainEqual(['customerId', '==', 'c1'])
    expect(constraints).toContainEqual(['storeId', '==', 'norte'])
    expect(constraints).toContainEqual(['createdAtServer', 'desc'])
    expect(constraints).toContain(CUSTOMER_HISTORY_LIMIT)
    expect(hasCursor(constraints)).toBe(false)
    const paths = vi.mocked(collection).mock.calls.map(call => call.slice(1).join('/'))
    expect(paths).toEqual(['licenses/lic/customerDebtEvents'])
  })

  it('ver más no vuelve a leer la primera página', async () => {
    const first = Array.from({ length: CUSTOMER_HISTORY_LIMIT }, (_, index) => doc(`p-${index}`, 1000 - index))
    mockGetDocs.mockResolvedValueOnce({ docs: first })
    const page = await loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: false })
    expect(page.hasMore).toBe(true)
    expect(page.moves).toHaveLength(30)

    mockGetDocs.mockResolvedValueOnce({ docs: [doc('mas-viejo', 10)] })
    const next = await loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: true })
    expect(next.moves.map(move => move.id)).toEqual(['mas-viejo'])
    expect(mockGetDocs).toHaveBeenCalledTimes(2)
    const calls = mockGetDocs.mock.calls.map(call => call[0] as unknown[])
    expect(hasCursor(calls[0] ?? [])).toBe(false)
    expect(calls[1]).toContainEqual({ tag: 'startAfter', cursor: first[29] })
    expect(calls.filter(call => !hasCursor(call))).toHaveLength(1)
  })

  it('otro cliente no usa el cursor del anterior', async () => {
    const first = Array.from({ length: CUSTOMER_HISTORY_LIMIT }, (_, index) => doc(`p-${index}`))
    mockGetDocs.mockResolvedValue({ docs: first })
    await loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: false })
    await loadCustomerHistory({ customerId: 'c2', storeId: 'norte', more: false })
    const calls = mockGetDocs.mock.calls.map(call => call[0] as unknown[])
    expect(calls.every(call => !hasCursor(call))).toBe(true)
    expect(calls[1]).toContainEqual(['customerId', '==', 'c2'])
  })

  it('sin página previa, ver más no dispara la primera', async () => {
    await expect(loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: true })).rejects.toThrow('NO_CURSOR')
    expect(mockGetDocs).not.toHaveBeenCalled()
  })

  it('si la página siguiente falla, el cursor sigue y no se relee la primera', async () => {
    const first = Array.from({ length: CUSTOMER_HISTORY_LIMIT }, (_, index) => doc(`p-${index}`))
    mockGetDocs.mockResolvedValueOnce({ docs: first })
    await loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: false })
    mockGetDocs.mockRejectedValueOnce(new Error('red'))
    await expect(loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: true })).rejects.toThrow('red')
    mockGetDocs.mockResolvedValueOnce({ docs: [doc('sigue', 5)] })
    const next = await loadCustomerHistory({ customerId: 'c1', storeId: 'norte', more: true })
    expect(next.moves.map(move => move.id)).toEqual(['sigue'])
    const calls = mockGetDocs.mock.calls.map(call => call[0] as unknown[])
    expect(calls.filter(call => !hasCursor(call))).toHaveLength(1)
    expect(calls[2]).toContainEqual({ tag: 'startAfter', cursor: first[29] })
  })
})
