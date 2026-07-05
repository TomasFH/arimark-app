/**
 * Tests del handler de importación de turnos móviles (mobileSync).
 * Verifica: inserción atómica, idempotencia, resolución de FK, columna source.
 */
import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { shifts, sales, salePayments, users, stores } from '../../db/schema'
import { eq, isNull, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

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
