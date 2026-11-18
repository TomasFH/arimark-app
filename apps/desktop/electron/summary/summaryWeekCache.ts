/**
 * Semanas de resumen ya guardadas en esta PC.
 * La semana en curso no se marca. Corregir un cierre borra solo la marca de esa semana.
 */
import { and, eq, gte, lt } from 'drizzle-orm'
import { mondayWeekContaining, type SummaryShiftCard } from '@carniceria/shared'
import { getDb } from '../db/client'
import { summaryShiftCache, summaryWeekPulls } from '../db/schema'
import type { RemoteSummaryShift } from '../licensing/summaryRemote'

type AppDb = ReturnType<typeof getDb>

export function summaryWeekIsMarked(db: AppDb, storeId: string, weekStartIso: string): boolean {
  const row = db.select({ storeId: summaryWeekPulls.storeId }).from(summaryWeekPulls).where(and(
    eq(summaryWeekPulls.storeId, storeId),
    eq(summaryWeekPulls.weekStartIso, weekStartIso),
  )).get()
  return row != null
}

export function readCachedSummaryWeek(
  db: AppDb,
  storeId: string,
  weekStartIso: string,
  weekEndIso: string,
): RemoteSummaryShift[] {
  const rows = db.select().from(summaryShiftCache).where(and(
    eq(summaryShiftCache.storeId, storeId),
    gte(summaryShiftCache.startedAt, weekStartIso),
    lt(summaryShiftCache.startedAt, weekEndIso),
  )).all()
  return rows.map(row => ({
    id: row.id,
    cashierName: row.cashierName,
    shiftType: row.shiftType,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    openingCash: row.openingCash,
    cashLeft: row.cashLeft,
    deliveredAmount: row.deliveredAmount,
    soldTotal: row.soldTotal,
    cashTotal: row.cashTotal,
    cardWalletTotal: row.cardWalletTotal,
    debtTotal: row.debtTotal,
    expenseTotal: row.expenseTotal,
    contributionTotal: row.contributionTotal,
    walletCashTotal: row.walletCashTotal,
    debitTotal: row.debitTotal,
    walletTotal: row.walletTotal,
    creditTotal: row.creditTotal,
    moneySnapshottedAt: row.moneySnapshottedAt,
  }))
}

export function replaceSummaryWeek(
  db: AppDb,
  storeId: string,
  weekStartIso: string,
  weekEndIso: string,
  shifts: RemoteSummaryShift[],
  pulledAt: string,
): void {
  db.transaction(tx => {
    tx.delete(summaryShiftCache).where(and(
      eq(summaryShiftCache.storeId, storeId),
      gte(summaryShiftCache.startedAt, weekStartIso),
      lt(summaryShiftCache.startedAt, weekEndIso),
    )).run()
    for (const shift of shifts) {
      if (shift.startedAt < weekStartIso || shift.startedAt >= weekEndIso) continue
      tx.insert(summaryShiftCache).values({
        id: shift.id,
        storeId,
        cashierName: shift.cashierName,
        shiftType: shift.shiftType,
        startedAt: shift.startedAt,
        closedAt: shift.closedAt,
        openingCash: shift.openingCash,
        cashLeft: shift.cashLeft,
        deliveredAmount: shift.deliveredAmount,
        soldTotal: shift.soldTotal,
        cashTotal: shift.cashTotal,
        cardWalletTotal: shift.cardWalletTotal,
        debtTotal: shift.debtTotal,
        expenseTotal: shift.expenseTotal,
        contributionTotal: shift.contributionTotal,
        walletCashTotal: shift.walletCashTotal,
        debitTotal: shift.debitTotal,
        walletTotal: shift.walletTotal,
        creditTotal: shift.creditTotal,
        moneySnapshottedAt: shift.moneySnapshottedAt,
      }).run()
    }
    tx.insert(summaryWeekPulls).values({ storeId, weekStartIso, pulledAt }).onConflictDoUpdate({
      target: [summaryWeekPulls.storeId, summaryWeekPulls.weekStartIso],
      set: { pulledAt },
    }).run()
  })
}

/** Escribe la plata resuelta en una ficha que ya estaba cacheada. */
export function patchCachedSummaryShift(db: AppDb, card: SummaryShiftCard): void {
  if (card.live || card.moneySnapshottedAt == null || card.soldTotal == null) return
  db.update(summaryShiftCache).set({
    cashierName: card.cashierName,
    closedAt: card.closedAt,
    openingCash: card.openingCash,
    cashLeft: card.cashLeft,
    deliveredAmount: card.withdrawn,
    soldTotal: card.soldTotal,
    cashTotal: card.cashTotal,
    cardWalletTotal: card.cardWalletTotal,
    debtTotal: card.debtTotal,
    expenseTotal: card.expenseTotal,
    contributionTotal: card.contributionTotal,
    walletCashTotal: card.walletCashTotal,
    ...(card.paymentSplit
      ? {
        debitTotal: card.paymentSplit.debit,
        walletTotal: card.paymentSplit.wallet,
        creditTotal: card.paymentSplit.credit,
      }
      : {}),
    moneySnapshottedAt: card.moneySnapshottedAt,
  }).where(eq(summaryShiftCache.id, card.id)).run()
}

/** Saca la marca de la semana de ese turno. Las otras semanas quedan. */
export function invalidateSummaryWeek(db: AppDb, storeId: string, startedAt: string): void {
  const week = mondayWeekContaining(startedAt)
  db.delete(summaryWeekPulls).where(and(
    eq(summaryWeekPulls.storeId, storeId),
    eq(summaryWeekPulls.weekStartIso, week.startIso),
  )).run()
}
