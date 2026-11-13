/**
 * Fiados del resumen leídos de SQLite. No baja customerDebtEvents.
 */
import { eq, inArray } from 'drizzle-orm'
import { storeFiadoSlice, type LedgerEvent, type SummaryFiadoSlice } from '@carniceria/shared'
import { getDb } from '../db/client'
import { debtEvents } from '../db/schema'

type AppDb = ReturnType<typeof getDb>

export function loadStoreFiado(
  db: AppDb,
  storeId: string,
  startIso: string,
  endIso: string,
): SummaryFiadoSlice {
  const mine = db.select({ customerId: debtEvents.customerId })
    .from(debtEvents)
    .where(eq(debtEvents.storeId, storeId))
    .all()
  if (mine.length === 0) return { debtNow: null, payments: null }

  const customerIds = [...new Set(mine.map(row => row.customerId))]
  const related = db.select({
    customerId: debtEvents.customerId,
    storeId: debtEvents.storeId,
    eventType: debtEvents.eventType,
    amount: debtEvents.amount,
    createdAt: debtEvents.createdAt,
    shiftId: debtEvents.shiftId,
  }).from(debtEvents).where(inArray(debtEvents.customerId, customerIds)).all()

  const events: LedgerEvent[] = related.map(row => ({
    customerId: row.customerId,
    storeId: row.storeId,
    eventType: row.eventType,
    amount: row.amount,
    createdAt: row.createdAt,
    shiftId: row.shiftId,
  }))
  return storeFiadoSlice(storeId, events, startIso, endIso)
}
