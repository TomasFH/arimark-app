import { describe, it, expect } from 'vitest'
import {
  buildCustomerFirestorePayload,
  buildDebtEventFirestorePayload,
  buildExpenseOpsPayload,
  buildExpenseStagingPayload,
  buildSaleFirestorePayload,
  buildSaleOpsPayload,
  buildShiftFirestorePayload,
  buildShiftOpsPayload,
  collectShiftIdsToSync,
  isInitialShiftUpload,
  netDebtAmount,
} from '../lib/syncPayloads'
import type { LocalExpense, LocalSale, LocalShift } from '../types/pos'

const shift: LocalShift = {
  id: 'shift-1',
  storeId: 'store-1',
  userId: 'uid-1',
  displayName: 'Ana',
  shiftType: 'morning',
  startedAt: '2026-08-28T08:00:00.000Z',
  closedAt: '2026-08-28T16:00:00.000Z',
  openingCash: 5000,
  closingCash: 12000,
  syncStatus: 'pending',
  syncedAt: null,
}

const saleBase: LocalSale = {
  id: 'sale-1',
  shiftId: 'shift-1',
  storeId: 'store-1',
  total: 10000,
  items: [],
  payments: [{ paymentMethod: 'cash', amount: 3000 }],
  notes: null,
  manualEntry: false,
  createdAt: '2026-08-28T10:00:00.000Z',
  createdBy: 'uid-1',
  syncStatus: 'pending',
  syncedAt: null,
}

describe('syncPayloads', () => {
  it('collectShiftIdsToSync une turnos pending con hijos pending aunque el turno esté synced', () => {
    const ids = collectShiftIdsToSync(
      [{ id: 's-pending' }],
      [{ shiftId: 's-synced' }, { shiftId: 's-pending' }],
      [{ shiftId: 's-expense' }],
    )
    expect(ids.sort()).toEqual(['s-expense', 's-pending', 's-synced'])
  })

  it('create inicial incluye importedAt null; update no lo escribe', () => {
    expect(isInitialShiftUpload(null)).toBe(true)
    expect(isInitialShiftUpload('2026-08-28T09:00:00.000Z')).toBe(false)

    const created = buildShiftFirestorePayload(shift, '2026-08-28T16:01:00.000Z', true)
    expect(created.importedAt).toBeNull()
    expect(created.source).toBe('mobile')
    expect(created.closedAt).toBe(shift.closedAt)
    expect(created.closingCash).toBe(12000)
    expect(created.updatedAt).toBe('2026-08-28T16:01:00.000Z')

    const updated = buildShiftFirestorePayload(
      { ...shift, syncedAt: '2026-08-28T09:00:00.000Z' },
      '2026-08-28T16:01:00.000Z',
      false,
    )
    expect('importedAt' in updated).toBe(false)
    expect(updated.updatedAt).toBe('2026-08-28T16:01:00.000Z')
  })

  it('venta incluye status, fiado y importedAt null; filas viejas salen confirmed', () => {
    const payload = buildSaleFirestorePayload(saleBase)
    expect(payload.status).toBe('confirmed')
    expect(payload.isDebt).toBe(false)
    expect(payload.importedAt).toBeNull()
    expect(payload.customerId).toBeNull()

    const cancelled = buildSaleFirestorePayload({ ...saleBase, status: 'cancelled' })
    expect(cancelled.status).toBe('cancelled')
  })

  it('gasto con proveedor viaja en staging y copia operativa', () => {
    const expense: LocalExpense = {
      id: 'exp-p',
      shiftId: 'shift-1',
      storeId: 'store-1',
      kind: 'expense',
      concept: 'Mercadería',
      amount: 3000,
      notes: null,
      createdAt: '2026-08-28T11:00:00.000Z',
      createdBy: 'uid-1',
      syncStatus: 'pending',
      syncedAt: null,
      providerId: 'aabb',
      providerName: 'Oso',
      newDebtAmount: 2000,
      paysOldDebt: 0,
    }
    const staging = buildExpenseStagingPayload(expense)
    expect(staging.providerId).toBe('aabb')
    expect(staging.providerName).toBe('Oso')
    expect(staging.newDebtAmount).toBe(2000)
    expect(buildExpenseOpsPayload(expense).providerName).toBe('Oso')
  })

  it('collectShiftIdsToSync incluye vales y liquidación pendientes', () => {
    const ids = collectShiftIdsToSync(
      [],
      [],
      [],
      [{ shiftId: 's-vale' }, { shiftId: 's-pay' }],
    )
    expect(ids.sort()).toEqual(['s-pay', 's-vale'])
  })

  it('gasto staging y copia operativa (sin proveedor)', () => {
    const expense: LocalExpense = {
      id: 'exp-1',
      shiftId: 'shift-1',
      storeId: 'store-1',
      kind: 'expense',
      concept: 'Bolsas',
      amount: 1500,
      notes: 'caja',
      createdAt: '2026-08-28T11:00:00.000Z',
      createdBy: 'uid-1',
      syncStatus: 'pending',
      syncedAt: null,
    }
    const staging = buildExpenseStagingPayload(expense)
    expect(staging.importedAt).toBeNull()
    expect(staging.kind).toBe('expense')
    expect(staging.concept).toBe('Bolsas')

    const ops = buildExpenseOpsPayload(expense)
    expect(ops.deleted).toBe(false)
    expect(ops.providerId).toBeNull()
    expect(ops.providerName).toBeNull()
    expect(ops.kind).toBe('expense')
  })

  it('aporte usa concepto Aporte en la copia operativa', () => {
    const inject: LocalExpense = {
      id: 'inj-1',
      shiftId: 'shift-1',
      storeId: 'store-1',
      kind: 'inject',
      concept: 'Aporte',
      amount: 4000,
      notes: null,
      createdAt: '2026-08-28T11:00:00.000Z',
      createdBy: 'uid-1',
      syncStatus: 'pending',
      syncedAt: null,
    }
    expect(buildExpenseOpsPayload(inject).concept).toBe('Aporte')
    expect(buildExpenseOpsPayload(inject).kind).toBe('inject')
  })

  it('fiado: deuda neta = total − pagos; customer y evento created', () => {
    expect(netDebtAmount(20000, [{ paymentMethod: 'cash', amount: 5000 }])).toBe(15000)
    expect(netDebtAmount(8000, [])).toBe(8000)

    const debtSale: LocalSale = {
      ...saleBase,
      isDebt: true,
      customerId: 'cust-1',
      customerName: 'Juan Pérez',
      customerPhone: '112233',
      payments: [{ paymentMethod: 'cash', amount: 2000 }, { paymentMethod: 'debit', amount: 1000 }],
      total: 10000,
    }
    const customer = buildCustomerFirestorePayload(debtSale)
    expect(customer).toMatchObject({
      id: 'cust-1',
      storeId: 'store-1',
      name: 'Juan Pérez',
      phone: '112233',
      active: true,
      deleted: false,
    })

    const event = buildDebtEventFirestorePayload(debtSale)
    expect(event).toMatchObject({
      id: 'sale-1',
      customerId: 'cust-1',
      saleId: 'sale-1',
      shiftId: 'shift-1',
      eventType: 'created',
      amount: 7000,
      deleted: false,
    })

    expect(buildCustomerFirestorePayload(saleBase)).toBeNull()
    expect(buildDebtEventFirestorePayload(saleBase)).toBeNull()
  })

  it('collectShiftIdsToSync con listas vacías', () => {
    expect(collectShiftIdsToSync([], [], [])).toEqual([])
  })

  it('deuda neta redondea a centavos y admite pago igual al total', () => {
    expect(netDebtAmount(100.1, [{ paymentMethod: 'cash', amount: 30.05 }])).toBe(70.05)
    expect(netDebtAmount(8000, [{ paymentMethod: 'cash', amount: 8000 }])).toBe(0)
  })

  it('fiado sin customerId no arma payloads de cliente/deuda', () => {
    const incomplete: LocalSale = { ...saleBase, isDebt: true, customerId: null, customerName: 'Juan' }
    expect(buildCustomerFirestorePayload(incomplete)).toBeNull()
    expect(buildDebtEventFirestorePayload(incomplete)).toBeNull()
  })

  it('aporte sin concepto usa Aporte en la copia operativa', () => {
    const inject: LocalExpense = {
      id: 'inj-2',
      shiftId: 'shift-1',
      storeId: 'store-1',
      kind: 'inject',
      concept: null,
      amount: 1,
      notes: null,
      createdAt: '2026-08-28T11:00:00.000Z',
      createdBy: 'uid-1',
      syncStatus: 'pending',
      syncedAt: null,
    }
    expect(buildExpenseOpsPayload(inject).concept).toBe('Aporte')
  })

  it('ids de sync son únicos aunque un turno tenga varios hijos pending', () => {
    const ids = collectShiftIdsToSync(
      [{ id: 's1' }],
      [{ shiftId: 's1' }, { shiftId: 's1' }],
      [{ shiftId: 's1' }],
    )
    expect(ids).toEqual(['s1'])
  })

  it('venta anulada viaja cancelled en el payload de Firestore', () => {
    const cancelled = buildSaleFirestorePayload({ ...saleBase, status: 'cancelled' })
    expect(cancelled.status).toBe('cancelled')
  })

  it('copia operativa de turno y venta van a historial admin con source mobile', () => {
    const opsShift = buildShiftOpsPayload(shift, '2026-08-28T16:02:00.000Z')
    expect(opsShift.source).toBe('mobile')
    expect(opsShift.cashierName).toBe('Ana')
    expect(opsShift.closedAt).toBe(shift.closedAt)

    const opsSale = buildSaleOpsPayload({ ...saleBase, status: 'cancelled' })
    expect(opsSale.storeId).toBe('store-1')
    expect(opsSale.status).toBe('cancelled')
    expect('importedAt' in opsSale).toBe(false)
  })
})
