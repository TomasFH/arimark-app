/**
 * Tests del handler de importación de turnos móviles (mobileSync).
 * Verifica: inserción atómica, idempotencia, resolución de FK, columna source.
 */
import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { shifts, sales, salePayments, users, stores, expenses, customers, debtEvents, providers, providerDebtEvents, employees, employeeVales, salaryPayments } from '../../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { applyMobileShiftImport, shouldMarkMobileShiftImported, coerceSaleStatus, coerceExpenseKind, netDebtFromSale } from '../mobileSyncImport'
import type { getDb } from '../../db/client'

// ---------------------------------------------------------------------------
// Helper de seeding
// ---------------------------------------------------------------------------
async function seedStore(db: Awaited<ReturnType<typeof createInMemoryDb>>['db'], storeId = 'local1') {
  db.insert(stores).values({ id: storeId, name: 'Local 1', createdAt: new Date().toISOString() }).run()
}

describe('migración 0006 - columna source en shifts', () => {
  it('shifts creados en desktop tienen source=desktop', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)

    const userId = uuidv4()
    db.insert(users).values({
      id: userId,
      storeId: 'local1',
      name: 'Cajera 1',
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    db.insert(shifts).values({
      id: uuidv4(),
      storeId: 'local1',
      userId,
      shiftType: 'morning',
      startedAt: new Date().toISOString(),
      openingCash: 0,
      source: 'desktop',
    }).run()

    const allShifts = db.select().from(shifts).all()
    expect(allShifts).toHaveLength(1)
    expect(allShifts[0]?.source).toBe('desktop')
  })

  it('shifts móviles importados tienen source=mobile', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)

    const userId = uuidv4()
    db.insert(users).values({
      id: userId,
      storeId: 'local1',
      name: 'Cajera 2',
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    db.insert(shifts).values({
      id: uuidv4(),
      storeId: 'local1',
      userId,
      shiftType: 'evening',
      startedAt: new Date().toISOString(),
      openingCash: 500,
      source: 'mobile',
    }).run()

    const mobileShifts = db.select().from(shifts).where(eq(shifts.source, 'mobile')).all()
    expect(mobileShifts).toHaveLength(1)
  })
})

describe('importación de turno móvil — idempotencia y FK', () => {
  it('importar el mismo turno dos veces no duplica datos', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)

    const userId = uuidv4()
    db.insert(users).values({
      id: userId,
      storeId: 'local1',
      name: 'Cajera 3',
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    const shiftId = uuidv4()

    function insertShift() {
      const existing = db.select().from(shifts).where(eq(shifts.id, shiftId)).get()
      if (!existing) {
        db.insert(shifts).values({
          id: shiftId,
          storeId: 'local1',
          userId,
          shiftType: 'morning',
          startedAt: new Date().toISOString(),
          openingCash: 1000,
          source: 'mobile',
        }).run()
      }
    }

    insertShift()
    insertShift()

    const allShifts = db.select().from(shifts).all()
    expect(allShifts).toHaveLength(1)
  })

  it('los turnos con source=mobile no aparecen en la consulta de turno activo desktop', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)

    const userId = uuidv4()
    db.insert(users).values({
      id: userId,
      storeId: 'local1',
      name: 'Cajera 4',
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    db.insert(shifts).values({
      id: uuidv4(),
      storeId: 'local1',
      userId,
      shiftType: 'morning',
      startedAt: new Date().toISOString(),
      openingCash: 0,
      source: 'mobile',
    }).run()

    // La consulta del shift handler filtra por source='desktop'
    const activeDesktop = db
      .select()
      .from(shifts)
      .where(and(eq(shifts.storeId, 'local1'), isNull(shifts.closedAt), eq(shifts.source, 'desktop')))
      .all()

    expect(activeDesktop).toHaveLength(0)
  })

  it('venta importada se asocia correctamente al turno móvil', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)

    const userId = uuidv4()
    db.insert(users).values({
      id: userId,
      storeId: 'local1',
      name: 'Cajera 5',
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()

    const shiftId = uuidv4()
    db.insert(shifts).values({
      id: shiftId,
      storeId: 'local1',
      userId,
      shiftType: 'morning',
      startedAt: new Date().toISOString(),
      openingCash: 0,
      source: 'mobile',
    }).run()

    const saleId = uuidv4()
    const now = new Date().toISOString()
    db.insert(sales).values({
      id: saleId,
      storeId: 'local1',
      shiftId,
      total: 17535,
      status: 'confirmed',
      manualEntry: false,
      notes: null,
      createdAt: now,
      createdBy: userId,
    }).run()

    db.insert(salePayments).values({
      id: uuidv4(),
      saleId,
      paymentMethod: 'cash',
      amount: 17535,
      createdAt: now,
      createdBy: userId,
    }).run()

    const savedSales = db.select().from(sales).where(eq(sales.shiftId, shiftId)).all()
    expect(savedSales).toHaveLength(1)
    expect(savedSales[0]?.total).toBe(17535)

    const savedPayments = db.select().from(salePayments).where(eq(salePayments.saleId, saleId)).all()
    expect(savedPayments).toHaveLength(1)
    expect(savedPayments[0]?.paymentMethod).toBe('cash')
  })
})

describe('applyMobileShiftImport — deltas, gastos, fiado y anulación', () => {
  function asAppDb(db: Awaited<ReturnType<typeof createInMemoryDb>>['db']) {
    return db as unknown as ReturnType<typeof getDb>
  }

  it('no marca importedAt mientras el turno sigue abierto', () => {
    expect(shouldMarkMobileShiftImported(null)).toBe(false)
    expect(shouldMarkMobileShiftImported('2026-08-28T16:00:00.000Z')).toBe(true)
  })

  it('importa turno + venta + gasto + aporte; reaplicar no duplica', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const saleId = uuidv4()
    const expenseId = uuidv4()
    const injectId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'

    const shift = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: null,
      openingCash: 1000,
      closingCash: null,
    }

    const first = applyMobileShiftImport(asAppDb(db), 'local1', shift, [{
      id: saleId,
      shiftId,
      total: 5000,
      items: [],
      payments: [{ paymentMethod: 'cash', amount: 5000 }],
      notes: null,
      manualEntry: true,
      createdAt: now,
      createdBy: userId,
      status: 'confirmed',
    }], [
      { id: expenseId, shiftId, concept: 'Insumos', amount: 200, notes: null, createdAt: now, createdBy: userId, kind: 'expense' },
      { id: injectId, shiftId, concept: 'Aporte', amount: 2000, notes: 'admin', createdAt: now, createdBy: userId, kind: 'inject' },
    ])

    expect(first.insertedShift).toBe(true)
    expect(first.salesInserted).toBe(1)
    expect(first.expensesInserted).toBe(2)
    expect(first.shouldMarkImported).toBe(false)

    const second = applyMobileShiftImport(asAppDb(db), 'local1', shift, [{
      id: saleId,
      shiftId,
      total: 5000,
      items: [],
      payments: [{ paymentMethod: 'cash', amount: 5000 }],
      notes: null,
      manualEntry: true,
      createdAt: now,
      createdBy: userId,
      status: 'confirmed',
    }], [
      { id: expenseId, shiftId, concept: 'Insumos', amount: 200, notes: null, createdAt: now, createdBy: userId, kind: 'expense' },
      { id: injectId, shiftId, concept: 'Aporte', amount: 2000, notes: 'admin', createdAt: now, createdBy: userId, kind: 'inject' },
    ])

    expect(second.insertedShift).toBe(false)
    expect(second.salesInserted).toBe(0)
    expect(second.expensesInserted).toBe(0)
    expect(db.select().from(sales).all()).toHaveLength(1)
    expect(db.select().from(expenses).all()).toHaveLength(2)
    expect(db.select().from(expenses).all().filter(e => e.kind === 'inject')).toHaveLength(1)
  })

  it('agrega una venta posterior y anula una existente', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const saleA = uuidv4()
    const saleB = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'

    const shift = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: null,
      openingCash: 0,
      closingCash: null,
    }

    applyMobileShiftImport(asAppDb(db), 'local1', shift, [{
      id: saleA,
      shiftId,
      total: 1000,
      items: [],
      payments: [{ paymentMethod: 'cash', amount: 1000 }],
      notes: null,
      manualEntry: false,
      createdAt: now,
      createdBy: userId,
    }], [])

    const delta = applyMobileShiftImport(asAppDb(db), 'local1', shift, [
      {
        id: saleA,
        shiftId,
        total: 1000,
        items: [],
        payments: [{ paymentMethod: 'cash', amount: 1000 }],
        notes: null,
        manualEntry: false,
        createdAt: now,
        createdBy: userId,
        status: 'cancelled',
      },
      {
        id: saleB,
        shiftId,
        total: 2500,
        items: [],
        payments: [{ paymentMethod: 'debit', amount: 2500 }],
        notes: null,
        manualEntry: true,
        createdAt: '2026-08-28T11:00:00.000Z',
        createdBy: userId,
        status: 'confirmed',
      },
    ], [])

    expect(delta.salesInserted).toBe(1)
    expect(delta.salesCancelled).toBe(1)
    expect(db.select().from(sales).all()).toHaveLength(2)
    expect(db.select().from(sales).where(eq(sales.id, saleA)).get()?.status).toBe('cancelled')
    expect(db.select().from(sales).where(eq(sales.id, saleB)).get()?.status).toBe('confirmed')
  })

  it('fiado crea cliente y evento de deuda; al cerrar hay que marcar importado', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const saleId = uuidv4()
    const customerId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'

    const result = applyMobileShiftImport(asAppDb(db), 'local1', {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'evening',
      startedAt: now,
      closedAt: '2026-08-28T16:00:00.000Z',
      openingCash: 500,
      closingCash: 800,
    }, [{
      id: saleId,
      shiftId,
      total: 10000,
      items: [],
      payments: [{ paymentMethod: 'cash', amount: 2000 }],
      notes: null,
      manualEntry: false,
      createdAt: now,
      createdBy: userId,
      status: 'confirmed',
      isDebt: true,
      customerId,
      customerName: 'Juan Pérez',
      customerPhone: '111',
    }], [])

    expect(result.shouldMarkImported).toBe(true)
    expect(db.select().from(customers).where(eq(customers.id, customerId)).get()?.name).toBe('Juan Pérez')
    const event = db.select().from(debtEvents).where(eq(debtEvents.saleId, saleId)).get()
    expect(event?.eventType).toBe('created')
    expect(event?.amount).toBe(8000)
    expect(db.select().from(sales).get()?.isDebt).toBe(true)
  })

  it('coerce: status/kind desconocidos caen al default seguro', () => {
    expect(coerceSaleStatus(undefined)).toBe('confirmed')
    expect(coerceSaleStatus('cancelled')).toBe('cancelled')
    expect(coerceSaleStatus('nope')).toBe('confirmed')
    expect(coerceExpenseKind(undefined)).toBe('expense')
    expect(coerceExpenseKind('inject')).toBe('inject')
    expect(coerceExpenseKind('other')).toBe('expense')
    expect(netDebtFromSale(100, [])).toBe(100)
    expect(shouldMarkMobileShiftImported('')).toBe(false)
  })

  it('anular un fiado escribe evento cancelled y no duplica al reaplicar', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const saleId = uuidv4()
    const customerId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'
    const shift = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: null,
      openingCash: 0,
      closingCash: null,
    }
    const debtSale = {
      id: saleId,
      shiftId,
      total: 9000,
      items: [],
      payments: [{ paymentMethod: 'cash' as const, amount: 1000 }],
      notes: null,
      manualEntry: false,
      createdAt: now,
      createdBy: userId,
      status: 'confirmed' as const,
      isDebt: true,
      customerId,
      customerName: 'María',
      customerPhone: null,
    }

    applyMobileShiftImport(asAppDb(db), 'local1', shift, [debtSale], [])
    const firstCancel = applyMobileShiftImport(asAppDb(db), 'local1', shift, [{ ...debtSale, status: 'cancelled' }], [])
    expect(firstCancel.salesCancelled).toBe(1)
    const events = db.select().from(debtEvents).where(eq(debtEvents.saleId, saleId)).all()
    expect(events.some(e => e.eventType === 'created')).toBe(true)
    expect(events.some(e => e.eventType === 'cancelled' && e.amount === -8000)).toBe(true)

    const secondCancel = applyMobileShiftImport(asAppDb(db), 'local1', shift, [{ ...debtSale, status: 'cancelled' }], [])
    expect(secondCancel.salesCancelled).toBe(0)
    expect(db.select().from(debtEvents).where(eq(debtEvents.saleId, saleId)).all()).toHaveLength(2)
  })

  it('fiado ya anulado al importar no crea deuda; pago 0 o igual al total', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'
    const shift = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: null,
      openingCash: 0,
      closingCash: null,
    }

    applyMobileShiftImport(asAppDb(db), 'local1', shift, [{
      id: uuidv4(),
      shiftId,
      total: 5000,
      items: [],
      payments: [],
      notes: null,
      manualEntry: false,
      createdAt: now,
      createdBy: userId,
      status: 'cancelled',
      isDebt: true,
      customerId: uuidv4(),
      customerName: 'Nadie',
      customerPhone: null,
    }], [])
    expect(db.select().from(debtEvents).all()).toHaveLength(0)

    const paidId = uuidv4()
    const custPaid = uuidv4()
    applyMobileShiftImport(asAppDb(db), 'local1', shift, [{
      id: paidId,
      shiftId,
      total: 4000,
      items: [],
      payments: [{ paymentMethod: 'debit', amount: 4000 }],
      notes: null,
      manualEntry: false,
      createdAt: now,
      createdBy: userId,
      status: 'confirmed',
      isDebt: true,
      customerId: custPaid,
      customerName: 'Pago total',
      customerPhone: null,
    }], [])
    expect(db.select().from(debtEvents).where(eq(debtEvents.saleId, paidId)).get()?.amount).toBe(0)
  })

  it('omite ítem con productId inexistente, pagos inválidos y cierra un turno ya importado', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const saleId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'
    const open = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: null,
      openingCash: 100,
      closingCash: null,
    }

    applyMobileShiftImport(asAppDb(db), 'local1', open, [{
      id: saleId,
      shiftId,
      total: 3000,
      items: [{
        productId: 'producto-que-no-existe',
        productName: 'Vacío',
        pluNumber: 5,
        quantity: 1,
        unitPrice: 3000,
        subtotal: 3000,
        weightKg: null,
        manualEntry: true,
      }],
      payments: [
        { paymentMethod: 'cash', amount: 1000 },
        { paymentMethod: 'cash', amount: 0 },
        { paymentMethod: 'cheque' as unknown as 'cash', amount: 500 },
      ],
      notes: null,
      manualEntry: true,
      createdAt: now,
      createdBy: userId,
    }], [{
      id: uuidv4(),
      shiftId,
      concept: 'Sin kind',
      amount: 10,
      notes: null,
      createdAt: now,
      createdBy: userId,
    }])

    expect(db.select().from(sales).all()).toHaveLength(1)
    expect(db.select().from(salePayments).all()).toHaveLength(1)
    expect(db.select().from(salePayments).all()[0]?.amount).toBe(1000)
    expect(db.select().from(expenses).all()[0]?.kind).toBe('expense')

    const closed = applyMobileShiftImport(asAppDb(db), 'local1', {
      ...open,
      closedAt: '2026-08-28T16:00:00.000Z',
      closingCash: 2000,
    }, [], [])
    expect(closed.insertedShift).toBe(false)
    expect(closed.shouldMarkImported).toBe(true)
    const row = db.select().from(shifts).where(eq(shifts.id, shiftId)).get()
    expect(row?.closedAt).toBe('2026-08-28T16:00:00.000Z')
    expect(row?.closingCash).toBe(2000)
    expect(row?.source).toBe('mobile')
  })

  it('cliente existente no se duplica; nombre vacío usa Cliente', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const customerId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'
    const shift = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: null,
      openingCash: 0,
      closingCash: null,
    }

    applyMobileShiftImport(asAppDb(db), 'local1', shift, [{
      id: uuidv4(),
      shiftId,
      total: 100,
      items: [],
      payments: [],
      notes: null,
      manualEntry: false,
      createdAt: now,
      createdBy: userId,
      isDebt: true,
      customerId,
      customerName: '   ',
      customerPhone: null,
    }], [])
    expect(db.select().from(customers).where(eq(customers.id, customerId)).get()?.name).toBe('Cliente')

    applyMobileShiftImport(asAppDb(db), 'local1', shift, [{
      id: uuidv4(),
      shiftId,
      total: 200,
      items: [],
      payments: [],
      notes: null,
      manualEntry: false,
      createdAt: now,
      createdBy: userId,
      isDebt: true,
      customerId,
      customerName: 'Otro nombre',
      customerPhone: '999',
    }], [])
    expect(db.select().from(customers).all()).toHaveLength(1)
    expect(db.select().from(customers).get()?.name).toBe('Cliente')
  })
})

describe('applyMobileShiftImport — proveedor, vales y liquidación', () => {
  function asAppDb(db: Awaited<ReturnType<typeof createInMemoryDb>>['db']) {
    return db as unknown as ReturnType<typeof getDb>
  }

  it('vincula gasto a proveedor, ledger y vale en efectivo', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const expenseId = uuidv4()
    const valeId = uuidv4()
    const empId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'
    const providerId = Buffer.from('oso', 'utf8').toString('hex')

    db.insert(users).values({
      id: userId,
      storeId: 'local1',
      name: 'Ana',
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()
    db.insert(employees).values({
      id: empId,
      name: 'Carnicero 1',
      weeklyWage: 80000,
      active: true,
      createdAt: now,
    }).run()

    const shift = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: null,
      openingCash: 10000,
      closingCash: null,
    }

    const result = applyMobileShiftImport(
      asAppDb(db),
      'local1',
      shift,
      [],
      [{
        id: expenseId,
        shiftId,
        concept: 'Mercadería',
        amount: 3000,
        notes: null,
        createdAt: now,
        createdBy: userId,
        kind: 'expense',
        providerId,
        providerName: 'Oso',
        newDebtAmount: 2000,
        paysOldDebt: 0,
      }],
      [{
        id: valeId,
        employeeId: empId,
        shiftId,
        amount: 5000,
        description: 'adelanto',
        items: null,
        paidAt: now,
        recordedBy: userId,
        createdAt: now,
      }],
    )

    expect(result.expensesInserted).toBe(1)
    expect(result.valesInserted).toBe(1)
    expect(db.select().from(providers).all()).toHaveLength(1)
    expect(db.select().from(expenses).get()?.providerId).toBe(providerId)
    const events = db.select().from(providerDebtEvents).all()
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('debt')
    expect(events[0]?.amount).toBe(2000)
    expect(db.select().from(employeeVales).all()).toHaveLength(1)

    const again = applyMobileShiftImport(
      asAppDb(db),
      'local1',
      shift,
      [],
      [{
        id: expenseId,
        shiftId,
        concept: 'Mercadería',
        amount: 3000,
        notes: null,
        createdAt: now,
        createdBy: userId,
        kind: 'expense',
        providerId,
        providerName: 'Oso',
        newDebtAmount: 2000,
        paysOldDebt: 0,
      }],
      [{
        id: valeId,
        employeeId: empId,
        shiftId,
        amount: 5000,
        description: 'adelanto',
        items: null,
        paidAt: now,
        recordedBy: userId,
        createdAt: now,
      }],
    )
    expect(again.expensesInserted).toBe(0)
    expect(again.valesInserted).toBe(0)
    expect(db.select().from(providerDebtEvents).all()).toHaveLength(1)
  })

  it('importa liquidación si el empleado existe y no duplica la semana', async () => {
    const { db } = await createInMemoryDb()
    await seedStore(db)
    const userId = uuidv4()
    const shiftId = uuidv4()
    const empId = uuidv4()
    const payId = uuidv4()
    const now = '2026-08-28T10:00:00.000Z'

    db.insert(users).values({
      id: userId,
      storeId: 'local1',
      name: 'Ana',
      firebaseUid: userId,
      role: 'cashier',
      active: true,
      createdAt: now,
    }).run()
    db.insert(employees).values({
      id: empId,
      name: 'Carnicero 2',
      weeklyWage: 100000,
      active: true,
      createdAt: now,
    }).run()

    const shift = {
      id: shiftId,
      storeId: 'local1',
      userId,
      displayName: 'Ana',
      shiftType: 'morning' as const,
      startedAt: now,
      closedAt: now,
      openingCash: 200000,
      closingCash: 150000,
    }

    const result = applyMobileShiftImport(
      asAppDb(db),
      'local1',
      shift,
      [],
      [],
      [],
      [{
        id: payId,
        employeeId: empId,
        shiftId,
        amount: 100000,
        weekStart: '2026-08-24',
        valesDeducted: 10000,
        netPaid: 90000,
        notes: null,
        valesSnapshot: [{ id: 'v1', amount: 10000, description: null, paidAt: now }],
        recordedBy: userId,
        paidAt: now,
      }],
    )
    expect(result.salaryInserted).toBe(1)
    expect(db.select().from(salaryPayments).all()).toHaveLength(1)
    expect(result.shouldMarkImported).toBe(true)
  })
})

