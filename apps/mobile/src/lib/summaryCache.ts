/**
 * Semanas de resumen ya guardadas en el celu.
 * La semana en curso no se marca. Corregir un cierre borra solo esa marca.
 */
import { mondayWeekContaining, type SummaryShiftCard } from '@carniceria/shared'
import { db, type CachedSummaryShift } from './db'

function pullId(storeId: string, weekStartIso: string): string {
  return `${storeId}::${weekStartIso}`
}

export async function summaryWeekIsMarked(storeId: string, weekStartIso: string): Promise<boolean> {
  const row = await db.summaryWeekPulls.get(pullId(storeId, weekStartIso))
  return row != null
}

export async function readCachedSummaryWeek(
  storeId: string,
  weekStartIso: string,
  weekEndIso: string,
): Promise<SummaryShiftCard[]> {
  const rows = await db.summaryShifts.where('storeId').equals(storeId).toArray()
  return rows
    .filter(row => row.startedAt >= weekStartIso && row.startedAt < weekEndIso)
    .map(toCard)
}

function toCard(row: CachedSummaryShift): SummaryShiftCard {
  return {
    id: row.id,
    cashierName: row.cashierName,
    shiftType: row.shiftType,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    openingCash: row.openingCash,
    cashLeft: row.cashLeft,
    withdrawn: row.withdrawn,
    soldTotal: row.soldTotal,
    cashTotal: row.cashTotal,
    cardWalletTotal: row.cardWalletTotal,
    debtTotal: row.debtTotal,
    expenseTotal: row.expenseTotal,
    contributionTotal: row.contributionTotal,
    walletCashTotal: row.walletCashTotal,
    moneySnapshottedAt: row.moneySnapshottedAt,
    live: row.live,
  }
}

export async function saveSummaryWeek(
  storeId: string,
  weekStartIso: string,
  weekEndIso: string,
  shifts: SummaryShiftCard[],
): Promise<void> {
  const existing = await db.summaryShifts.where('storeId').equals(storeId).toArray()
  const drop = existing
    .filter(row => row.startedAt >= weekStartIso && row.startedAt < weekEndIso)
    .map(row => row.id)
  await db.transaction('rw', db.summaryShifts, db.summaryWeekPulls, async () => {
    if (drop.length > 0) await db.summaryShifts.bulkDelete(drop)
    const rows: CachedSummaryShift[] = shifts
      .filter(shift => shift.startedAt >= weekStartIso && shift.startedAt < weekEndIso)
      .map(shift => ({ ...shift, storeId }))
    if (rows.length > 0) await db.summaryShifts.bulkPut(rows)
    await db.summaryWeekPulls.put({
      id: pullId(storeId, weekStartIso),
      storeId,
      weekStartIso,
      pulledAt: new Date().toISOString(),
    })
  })
}

export async function patchCachedSummaryShift(storeId: string, card: SummaryShiftCard): Promise<void> {
  const row = await db.summaryShifts.get(card.id)
  if (!row || row.storeId !== storeId) return
  await db.summaryShifts.put({ ...card, storeId })
}

/** Saca la marca de la semana de ese turno. Las otras semanas quedan. */
export async function invalidateSummaryWeek(storeId: string, startedAt: string): Promise<void> {
  const week = mondayWeekContaining(startedAt)
  await db.summaryWeekPulls.delete(pullId(storeId, week.startIso))
}
