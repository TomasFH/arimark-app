/**
 * Tests de la capa de persistencia offline (Dexie + IndexedDB).
 * Usa fake-indexeddb para ejecutar en Node sin browser real.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../lib/db'

describe('db - capa offline', () => {
  beforeEach(async () => {
    await db.shifts.clear()
    await db.sales.clear()
    await db.catalog.clear()
  })

  it('persiste y recupera un turno', async () => {
    const shift = {
      id: 'shift-1',
      storeId: 'local1',
      userId: 'uid-1',
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: '2026-07-05T08:00:00.000Z',
      closedAt: null,
      openingCash: 1000,
      closingCash: null,
      syncStatus: 'pending' as const,
      syncedAt: null,
    }
    await db.shifts.add(shift)

    const stored = await db.shifts.get('shift-1')
    expect(stored).toMatchObject({ id: 'shift-1', storeId: 'local1' })
  })

  it('persiste y recupera una venta con ítems y pagos', async () => {
    const sale = {
      id: 'sale-1',
      shiftId: 'shift-1',
      storeId: 'local1',
      total: 17535,
      items: [
        {
          productId: 'p1',
          productName: 'Vacío',
          pluNumber: 5,
          quantity: 0.835,
          unitPrice: 21000,
          subtotal: 17535,
          weightKg: 0.835,
          manualEntry: false,
        },
      ],
      payments: [{ paymentMethod: 'cash' as const, amount: 17535 }],
      notes: null,
      manualEntry: false,
      createdAt: '2026-07-05T10:00:00.000Z',
      createdBy: 'uid-1',
      syncStatus: 'pending' as const,
      syncedAt: null,
    }
    await db.sales.add(sale)

    const stored = await db.sales.get('sale-1')
    expect(stored?.total).toBe(17535)
    expect(stored?.items).toHaveLength(1)
    expect(stored?.payments[0]?.paymentMethod).toBe('cash')
  })

  it('filtra ventas pendientes de sync por turno', async () => {
    await db.sales.bulkAdd([
      {
        id: 'sale-2',
        shiftId: 'shift-2',
        storeId: 'local1',
        total: 6000,
        items: [],
        payments: [],
        notes: null,
        manualEntry: false,
        createdAt: '2026-07-05T10:00:00.000Z',
        createdBy: 'uid-1',
        syncStatus: 'pending',
        syncedAt: null,
      },
      {
        id: 'sale-3',
        shiftId: 'shift-2',
        storeId: 'local1',
        total: 3000,
        items: [],
        payments: [],
        notes: null,
        manualEntry: false,
        createdAt: '2026-07-05T10:05:00.000Z',
        createdBy: 'uid-1',
        syncStatus: 'synced',
        syncedAt: '2026-07-05T10:10:00.000Z',
      },
    ])

    const pending = await db.sales
      .where('shiftId').equals('shift-2')
      .filter(s => s.syncStatus === 'pending')
      .toArray()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe('sale-2')
  })

  it('guarda y recupera catálogo por local', async () => {
    const products = [
      { productId: 'p1', pluNumber: 5, name: 'Vacío', category: 'beef_cut', unit: 'kg' as const, price: 21000 },
      { productId: 'p2', pluNumber: 250, name: 'Huevos x30', category: 'other', unit: 'unit' as const, price: 6000 },
    ]
    await db.catalog.put({
      storeId: 'local1',
      products,
      updatedAt: '2026-07-05T00:00:00.000Z',
    })

    const stored = await db.catalog.get('local1')
    expect(stored?.products).toHaveLength(2)
    expect(stored?.products[0]?.name).toBe('Vacío')
  })
})
