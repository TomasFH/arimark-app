/**
 * Datos inventados del resumen. No lee ni escribe SQLite ni Firestore.
 * La pantalla lo usa solo con el interruptor de prueba encendido.
 *
 * Cubre el mes en curso (semanas del lunes), para que Hoy, esta semana
 * y este mes no muestren los mismos números.
 */
import { civilYmd } from './pickupHours'
import { MEDIA_RES_RUBRO_ID, mediaResVisits, type MediaResVisit } from './mediaResSummary'
import { type SummaryShiftCard } from './summaryMoney'
import { combineFiadoSlices, type SummaryFiadoSlice } from './summaryFiado'
import { addDaysYmd, summaryMonthStep, mondayWeekRange } from './weekRange'

export interface SummaryPreviewVisit extends MediaResVisit {
  storeId: string
}

export interface SummaryPreview {
  stores: { id: string; name: string }[]
  shifts: SummaryShiftCard[]
  visits: SummaryPreviewVisit[]
  fiadoByStore: Record<string, SummaryFiadoSlice>
}

const NORTE = 'preview-norte'
const SUR = 'preview-sur'

function noon(ymd: string): string {
  return new Date(`${ymd}T12:00:00.000-03:00`).toISOString()
}

function evening(ymd: string): string {
  return new Date(`${ymd}T21:00:00.000-03:00`).toISOString()
}

function daysFrom(startYmd: string, endYmd: string): string[] {
  const days: string[] = []
  let cursor = startYmd
  while (cursor <= endYmd) {
    days.push(cursor)
    cursor = addDaysYmd(cursor, 1)
  }
  return days
}

function filled(
  id: string,
  storeName: string,
  shiftType: 'morning' | 'evening',
  startedAt: string,
  money: {
    soldTotal: number
    cashTotal: number
    cardWalletTotal: number
    debtTotal: number
    expenseTotal: number
    contributionTotal: number
    walletCashTotal: number
    openingCash: number
  },
): SummaryShiftCard {
  return {
    id,
    cashierName: storeName === 'Mostrador Norte' ? 'Ana' : 'Luis',
    storeName,
    shiftType,
    startedAt,
    closedAt: startedAt,
    openingCash: money.openingCash,
    cashLeft: null,
    withdrawn: null,
    soldTotal: money.soldTotal,
    cashTotal: money.cashTotal,
    cardWalletTotal: money.cardWalletTotal,
    debtTotal: money.debtTotal,
    expenseTotal: money.expenseTotal,
    contributionTotal: money.contributionTotal,
    walletCashTotal: money.walletCashTotal,
    moneySnapshottedAt: startedAt,
    live: false,
    providerExpenseTotal: 0,
  }
}

export function summaryPreview(now: Date = new Date()): SummaryPreview {
  const month = summaryMonthStep(0, now)
  const week = mondayWeekRange(0, now)
  const today = civilYmd(now)
  const hole = addDaysYmd(week.startYmd, 2)
  const holeYmd = hole === today ? addDaysYmd(week.startYmd, 1) : hole
  const days = daysFrom(month.startYmd, month.endInclusiveYmd)
  const shifts: SummaryShiftCard[] = []
  const visitInputs: { id: string; createdAt: string; providerName: string; receivedByName: string; storeId: string; weightsKg: number[] }[] = []
  const nortePayments: { amount: number; createdAt: string; shiftId: string | null }[] = []
  const surPayments: { amount: number; createdAt: string; shiftId: string | null }[] = []

  days.forEach((ymd, index) => {
    if (ymd === holeYmd) return
    const norteSold = 180_000 + index * 12_000
    const norteCard = Math.round(norteSold * 0.35)
    const norteDebt = index % 3 === 0 ? 25_000 : 0
    const norteExpense = 8_000 + (index % 5) * 2_000
    const norteWallet = index % 6 === 0 ? 6_000 : 0
    const norteCash = norteSold - norteCard - norteDebt
    shifts.push(filled(`preview-n-${ymd}`, 'Mostrador Norte', 'morning', noon(ymd), {
      soldTotal: norteSold,
      cashTotal: norteCash,
      cardWalletTotal: norteCard,
      debtTotal: norteDebt,
      expenseTotal: norteExpense,
      contributionTotal: 0,
      walletCashTotal: norteWallet,
      openingCash: 10_000,
    }))
    if (index % 2 === 0) {
      const surSold = 90_000 + index * 7_000
      const surCard = Math.round(surSold * 0.4)
      const surExpense = 4_000 + (index % 4) * 1_500
      shifts.push(filled(`preview-s-${ymd}`, 'Mostrador Sur', 'evening', evening(ymd), {
        soldTotal: surSold,
        cashTotal: surSold - surCard,
        cardWalletTotal: surCard,
        debtTotal: index % 4 === 0 ? 10_000 : 0,
        expenseTotal: surExpense,
        contributionTotal: 0,
        walletCashTotal: 0,
        openingCash: 5_000,
      }))
    }
    if (index % 7 === 0 || ymd === today) {
      const nortePiece = index % 2 === 0
      visitInputs.push({
        id: `preview-visit-${ymd}`,
        createdAt: noon(ymd),
        providerName: nortePiece ? 'Frigorífico del norte' : 'Frigorífico del sur',
        receivedByName: nortePiece ? 'Ana' : 'Luis',
        storeId: nortePiece ? NORTE : SUR,
        weightsKg: nortePiece ? [90, 88] : [95],
      })
    }
  })

  nortePayments.push(
    { amount: 12_000, createdAt: noon(month.startYmd), shiftId: `preview-n-${month.startYmd}` },
    { amount: 8_000, createdAt: noon(addDaysYmd(month.startYmd, 7)), shiftId: null },
    { amount: 4_000, createdAt: noon(today), shiftId: null },
    { amount: 15_000, createdAt: noon(today), shiftId: `preview-n-${today}` },
  )
  surPayments.push(
    { amount: 5_000, createdAt: evening(month.startYmd), shiftId: `preview-s-${month.startYmd}` },
    { amount: 7_000, createdAt: evening(week.startYmd), shiftId: `preview-s-${week.startYmd}` },
  )

  const visits = visitInputs.flatMap(input => mediaResVisits([{
    id: input.id,
    createdAt: input.createdAt,
    providerName: input.providerName,
    receivedByName: input.receivedByName,
    lines: [{
      rubroId: MEDIA_RES_RUBRO_ID,
      count: input.weightsKg.length,
      netKg: input.weightsKg.reduce((sum, kg) => sum + kg, 0),
      weightsKg: input.weightsKg,
    }],
  }]).map(visit => ({ ...visit, storeId: input.storeId })))

  return {
    stores: [
      { id: NORTE, name: 'Mostrador Norte' },
      { id: SUR, name: 'Mostrador Sur' },
    ],
    shifts,
    visits,
    fiadoByStore: {
      [NORTE]: { debtNow: 90_000, payments: nortePayments },
      [SUR]: { debtNow: 30_000, payments: surPayments },
    },
  }
}

export function summaryPreviewSelection(
  preview: SummaryPreview,
  storeId: string,
): { shifts: SummaryShiftCard[]; visits: SummaryPreviewVisit[]; fiado: SummaryFiadoSlice } {
  const all = storeId === 'all' || storeId === ''
  const storeIds = all ? preview.stores.map(store => store.id) : [storeId]
  const names = new Set(
    preview.stores.filter(store => storeIds.includes(store.id)).map(store => store.name),
  )
  return {
    shifts: preview.shifts.filter(shift => shift.storeName != null && names.has(shift.storeName)),
    visits: preview.visits.filter(visit => storeIds.includes(visit.storeId)),
    fiado: combineFiadoSlices(
      storeIds.map(id => preview.fiadoByStore[id] ?? { debtNow: null, payments: null }),
    ),
  }
}
