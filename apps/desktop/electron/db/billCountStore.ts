/**
 * Persistencia SQLite del desglose de billetes (apertura / cierre / snapshot).
 * No reescribe filas existentes de un kind: la corrección de apertura no pisa el cierre.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  compactBillLines,
  type BillCountKind,
  type BillLine,
} from '@carniceria/shared'
import { getDb } from './client'
import { billDenominations, shifts, users } from './schema'

type AppDb = ReturnType<typeof getDb>

export interface CashHandoverSnapshot {
  fromShiftId: string
  fromUserId: string
  fromCashierName: string
  fromClosedAt: string
  bills: BillLine[]
  counted: boolean
}

export function readBillLines(db: AppDb, shiftId: string, kind: BillCountKind): BillLine[] {
  const rows = db
    .select({
      denomination: billDenominations.denomination,
      quantity: billDenominations.quantity,
    })
    .from(billDenominations)
    .where(and(eq(billDenominations.shiftId, shiftId), eq(billDenominations.kind, kind)))
    .all()
  return compactBillLines(rows)
}

export function hasBillKindRows(db: AppDb, shiftId: string, kind: BillCountKind): boolean {
  const row = db
    .select({ id: billDenominations.id })
    .from(billDenominations)
    .where(and(eq(billDenominations.shiftId, shiftId), eq(billDenominations.kind, kind)))
    .limit(1)
    .get()
  return Boolean(row)
}

export function insertBillLines(
  db: AppDb,
  shiftId: string,
  kind: BillCountKind,
  lines: BillLine[],
): void {
  for (const line of compactBillLines(lines)) {
    db.insert(billDenominations)
      .values({
        id: uuidv4(),
        shiftId,
        kind,
        denomination: line.denomination,
        quantity: line.quantity,
        subtotal: line.denomination * line.quantity,
      })
      .run()
  }
}

/** Inserta solo si ese kind todavía no tiene filas. No borra ni updatea. */
export function insertBillLinesIfNone(
  db: AppDb,
  shiftId: string,
  kind: BillCountKind,
  lines: BillLine[] | undefined,
): void {
  if (lines === undefined) return
  if (hasBillKindRows(db, shiftId, kind)) return
  insertBillLines(db, shiftId, kind, lines)
}

export function readLastClosedHandover(db: AppDb, storeId: string): CashHandoverSnapshot | null {
  const shift = db
    .select()
    .from(shifts)
    .where(and(eq(shifts.storeId, storeId), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.closedAt))
    .limit(1)
    .get()

  if (!shift?.closedAt) return null

  const bills = readBillLines(db, shift.id, 'closing')
  const owner = db.select({ name: users.name }).from(users).where(eq(users.id, shift.userId)).get()
  const fromCashierName = owner?.name?.trim() ? owner.name.trim() : shift.userId

  return {
    fromShiftId: shift.id,
    fromUserId: shift.userId,
    fromCashierName,
    fromClosedAt: shift.closedAt,
    bills,
    counted: Boolean(shift.closingCounted) || bills.length > 0,
  }
}
