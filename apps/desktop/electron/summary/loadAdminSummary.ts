/**
 * Resumen de un local: fichas de turno, medias reses y pollo en cajones.
 * La semana en curso de mercadería se vuelve a pedir. Una semana cerrada, una vez.
 * Pollo y medias salen de las mismas visitas ya leídas. No hay otra lectura.
 */
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import log from 'electron-log'
import {
  chickenVisits,
  civilYmd,
  mediaResVisits,
  mondayWeekRange,
  mondayWeeksInRange,
  parseMerchWeightsJson,
  pickWrittenAmount,
  shiftMoneyAction,
  type ChickenVisit,
  type MediaResVisit,
  type ShiftMoneyParts,
  type SummaryFiadoSlice,
  type SummaryShiftCard,
} from '@carniceria/shared'
import { getDb } from '../db/client'
import {
  merchandiseIntakeLines,
  merchandiseIntakes,
  merchWeekPulls,
  shifts,
  stores,
  users,
} from '../db/schema'
import { computeShiftMoney, shouldSnapshotShiftMoney } from '../db/shiftMoney'
import { isFirebaseAvailable } from '../licensing/firebase'
import { getBusinessConfig } from '../businessConfig'
import { pullMerchandiseIntakesForStoreWeek } from '../licensing/merchIntakeSync'
import {
  fetchRemoteShiftMoney,
  fetchRemoteSummaryShifts,
  writeRemoteShiftMoney,
  type RemoteSummaryShift,
} from '../licensing/summaryRemote'
import {
  patchCachedSummaryShift,
  readCachedSummaryWeek,
  replaceSummaryWeek,
  summaryWeekIsMarked,
} from './summaryWeekCache'
import { loadStoreFiado } from './loadStoreFiado'

type AppDb = ReturnType<typeof getDb>
type ShiftRow = typeof shifts.$inferSelect

export interface AdminSummaryData {
  shifts: SummaryShiftCard[]
  visits: MediaResVisit[]
  chicken: ChickenVisit[]
  warning: string | null
  fiado: SummaryFiadoSlice
}

function partsFrom(row: {
  soldTotal: number | null
  cashTotal: number | null
  cardWalletTotal: number | null
  debtTotal: number | null
  expenseTotal: number | null
  contributionTotal: number | null
  walletCashTotal: number | null
  moneySnapshottedAt: string | null
}): ShiftMoneyParts | null {
  if (!row.moneySnapshottedAt) return null
  if (
    row.soldTotal == null || row.cashTotal == null || row.cardWalletTotal == null
    || row.debtTotal == null || row.expenseTotal == null || row.contributionTotal == null
    || row.walletCashTotal == null
  ) return null
  return {
    soldTotal: row.soldTotal,
    cashTotal: row.cashTotal,
    cardWalletTotal: row.cardWalletTotal,
    debtTotal: row.debtTotal,
    expenseTotal: row.expenseTotal,
    contributionTotal: row.contributionTotal,
    walletCashTotal: row.walletCashTotal,
  }
}

function sameMoney(row: ShiftRow, parts: ShiftMoneyParts): boolean {
  if (!row.moneySnapshottedAt) return false
  const current = partsFrom(row)
  if (!current) return false
  return (Object.keys(parts) as (keyof ShiftMoneyParts)[]).every(
    key => Math.round(current[key]) === Math.round(parts[key]),
  )
}

function saveOriginMoney(db: AppDb, row: ShiftRow, parts: ShiftMoneyParts, at: string): void {
  if (sameMoney(row, parts)) return
  db.update(shifts).set({
    ...parts,
    moneySnapshottedAt: at,
    syncedAt: null,
  }).where(eq(shifts.id, row.id)).run()
}

function cacheFilledMoney(db: AppDb, row: ShiftRow, parts: ShiftMoneyParts, at: string): void {
  if (row.openedLocally || row.moneySnapshottedAt) return
  db.update(shifts).set({
    ...parts,
    moneySnapshottedAt: at,
  }).where(eq(shifts.id, row.id)).run()
}

function cardFrom(
  id: string,
  cashierName: string,
  shiftType: 'morning' | 'evening',
  startedAt: string,
  closedAt: string | null,
  openingCash: number,
  cashLeft: number | null,
  withdrawn: number | null,
  parts: ShiftMoneyParts | null,
  moneySnapshottedAt: string | null,
  live: boolean,
): SummaryShiftCard {
  return {
    id,
    cashierName,
    shiftType,
    startedAt,
    closedAt,
    openingCash,
    cashLeft,
    withdrawn,
    soldTotal: parts?.soldTotal ?? null,
    cashTotal: parts?.cashTotal ?? null,
    cardWalletTotal: parts?.cardWalletTotal ?? null,
    debtTotal: parts?.debtTotal ?? null,
    expenseTotal: parts?.expenseTotal ?? null,
    contributionTotal: parts?.contributionTotal ?? null,
    walletCashTotal: parts?.walletCashTotal ?? null,
    moneySnapshottedAt: live ? null : moneySnapshottedAt,
    live,
  }
}

async function loadShifts(
  db: AppDb,
  storeId: string,
  startIso: string,
  endIso: string,
  now: Date,
): Promise<SummaryShiftCard[]> {
  const localRows = db.select().from(shifts).where(and(
    eq(shifts.storeId, storeId),
    gte(shifts.startedAt, startIso),
    lt(shifts.startedAt, endIso),
  )).all()
  const userIds = [...new Set(localRows.map(row => row.userId))]
  const userNames = new Map<string, string>()
  if (userIds.length > 0) {
    for (const user of db.select({ id: users.id, name: users.name }).from(users).all()) {
      if (userIds.includes(user.id)) userNames.set(user.id, user.name)
    }
  }

  const remoteBundle = isFirebaseAvailable()
    ? await collectRemoteWeeks(db, storeId, startIso, endIso, now)
    : { shifts: [] as RemoteSummaryShift[], fetched: [] as FetchedWeek[] }
  const remote = remoteBundle.shifts

  const localById = new Map(localRows.map(row => [row.id, row]))
  const remoteById = new Map(remote.map(row => [row.id, row]))
  const ids = [...new Set([...localById.keys(), ...remoteById.keys()])]
  const todayYmd = civilYmd(now)
  const at = now.toISOString()

  const liveIds: string[] = []
  const backfillIds: string[] = []
  for (const id of ids) {
    const local = localById.get(id) ?? null
    const cloud = remoteById.get(id) ?? null
    const closedAt = local?.closedAt ?? cloud?.closedAt ?? null
    const startedAt = local?.startedAt ?? cloud?.startedAt ?? ''
    const hasLocalLedger = local ? shouldSnapshotShiftMoney(db, local) : false
    const snapshotAt = (hasLocalLedger ? local?.moneySnapshottedAt : null)
      ?? local?.moneySnapshottedAt
      ?? cloud?.moneySnapshottedAt
      ?? null
    const action = shiftMoneyAction({
      closedAt,
      startedAt,
      moneySnapshottedAt: snapshotAt,
      hasLocalLedger,
      todayYmd,
    })
    if (action === 'live' && !hasLocalLedger) liveIds.push(id)
    if (action === 'backfill') backfillIds.push(id)
  }

  let remoteMoney = new Map<string, ShiftMoneyParts>()
  const needRemote = [...liveIds, ...backfillIds]
  if (needRemote.length > 0 && isFirebaseAvailable()) {
    try {
      remoteMoney = await fetchRemoteShiftMoney(needRemote)
    } catch (err) {
      log.warn('[summary] No se pudo completar la plata que faltaba', err)
    }
  }

  const cards: SummaryShiftCard[] = []
  for (const id of ids) {
    const local = localById.get(id) ?? null
    const cloud = remoteById.get(id) ?? null
    const closedAt = local?.closedAt ?? cloud?.closedAt ?? null
    const startedAt = local?.startedAt ?? cloud?.startedAt ?? ''
    const openingCash = local?.openingCash ?? cloud?.openingCash ?? 0
    const cashierName = (local ? userNames.get(local.userId) : null)
      ?? cloud?.cashierName
      ?? local?.userId
      ?? 'Cajera'
    const shiftType = local?.shiftType ?? (cloud?.shiftType === 'evening' ? 'evening' : 'morning')
    const cashLeft = pickWrittenAmount(local?.cashLeft, cloud?.cashLeft)
    const withdrawn = pickWrittenAmount(local?.deliveredAmount, cloud?.deliveredAmount)
    const hasLocalLedger = local ? shouldSnapshotShiftMoney(db, local) : false
    const kept = (local && local.moneySnapshottedAt ? partsFrom(local) : null)
      ?? (cloud ? partsFrom(cloud) : null)
    const snapshotAt = local?.moneySnapshottedAt ?? cloud?.moneySnapshottedAt ?? null
    const action = shiftMoneyAction({
      closedAt,
      startedAt,
      moneySnapshottedAt: hasLocalLedger ? (local?.moneySnapshottedAt ?? snapshotAt) : snapshotAt,
      hasLocalLedger,
      todayYmd,
    })

    if (action === 'recompute' && local) {
      const parts = computeShiftMoney(db, local.id)
      saveOriginMoney(db, local, parts, at)
      if (isFirebaseAvailable()) {
        try {
          await writeRemoteShiftMoney(local.id, parts, at)
        } catch (err) {
          log.warn('[summary] No se pudo publicar la plata del turno', { id: local.id, err })
        }
      }
      cards.push(cardFrom(id, cashierName, shiftType, startedAt, closedAt, openingCash, cashLeft, withdrawn, parts, at, false))
      continue
    }

    if (action === 'live' && hasLocalLedger && local) {
      const parts = computeShiftMoney(db, local.id)
      cards.push(cardFrom(id, cashierName, shiftType, startedAt, closedAt, openingCash, cashLeft, withdrawn, parts, null, true))
      continue
    }

    if (action === 'live') {
      const parts = remoteMoney.get(id) ?? null
      cards.push(cardFrom(
        id,
        cashierName,
        shiftType,
        startedAt,
        closedAt,
        openingCash,
        cashLeft,
        withdrawn,
        parts,
        null,
        parts != null,
      ))
      continue
    }

    if (action === 'backfill') {
      const parts = remoteMoney.get(id) ?? null
      if (parts) {
        if (isFirebaseAvailable()) {
          try {
            await writeRemoteShiftMoney(id, parts, at)
          } catch (err) {
            log.warn('[summary] No se pudo guardar la plata del turno', { id, err })
          }
        }
        if (local) cacheFilledMoney(db, local, parts, at)
        cards.push(cardFrom(id, cashierName, shiftType, startedAt, closedAt, openingCash, cashLeft, withdrawn, parts, at, false))
      } else {
        cards.push(cardFrom(id, cashierName, shiftType, startedAt, closedAt, openingCash, cashLeft, withdrawn, null, null, false))
      }
      continue
    }

    cards.push(cardFrom(
      id,
      cashierName,
      shiftType,
      startedAt,
      closedAt,
      openingCash,
      cashLeft,
      withdrawn,
      kept,
      snapshotAt,
      false,
    ))
  }

  cards.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  for (const week of remoteBundle.fetched) {
    replaceSummaryWeek(
      db,
      storeId,
      week.startIso,
      week.endIso,
      applyResolved(week.shifts, cards),
      at,
    )
  }
  for (const card of cards) patchCachedSummaryShift(db, card)
  return cards
}

interface FetchedWeek {
  startIso: string
  endIso: string
  shifts: RemoteSummaryShift[]
}

async function collectRemoteWeeks(
  db: AppDb,
  storeId: string,
  startIso: string,
  endIso: string,
  now: Date,
): Promise<{ shifts: RemoteSummaryShift[]; fetched: FetchedWeek[] }> {
  const currentStart = mondayWeekRange(0, now).startIso
  const shifts: RemoteSummaryShift[] = []
  const fetched: FetchedWeek[] = []
  for (const week of mondayWeeksInRange(startIso, endIso)) {
    const current = week.startIso === currentStart
    let rows: RemoteSummaryShift[]
    if (!current && summaryWeekIsMarked(db, storeId, week.startIso)) {
      rows = readCachedSummaryWeek(db, storeId, week.startIso, week.endIso)
    } else {
      const downloaded = await fetchRemoteSummaryShifts(storeId, week.startIso, week.endIso)
      rows = downloaded.filter(row => row.startedAt >= week.startIso && row.startedAt < week.endIso)
      if (!current) fetched.push({ startIso: week.startIso, endIso: week.endIso, shifts: rows })
    }
    for (const row of rows) {
      if (row.startedAt < startIso || row.startedAt >= endIso) continue
      shifts.push(row)
    }
  }
  return { shifts, fetched }
}

function applyResolved(shifts: RemoteSummaryShift[], cards: SummaryShiftCard[]): RemoteSummaryShift[] {
  const byId = new Map(cards.map(card => [card.id, card]))
  return shifts.map(shift => {
    const card = byId.get(shift.id)
    if (!card || card.live || card.soldTotal == null || card.moneySnapshottedAt == null) return shift
    return {
      ...shift,
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
      moneySnapshottedAt: card.moneySnapshottedAt,
    }
  })
}

function weekMarked(db: AppDb, storeId: string, weekStartIso: string): boolean {
  const row = db.select({ storeId: merchWeekPulls.storeId }).from(merchWeekPulls).where(and(
    eq(merchWeekPulls.storeId, storeId),
    eq(merchWeekPulls.weekStartIso, weekStartIso),
  )).get()
  return row != null
}

function markWeek(db: AppDb, storeId: string, weekStartIso: string, pulledAt: string): void {
  db.insert(merchWeekPulls).values({ storeId, weekStartIso, pulledAt }).onConflictDoUpdate({
    target: [merchWeekPulls.storeId, merchWeekPulls.weekStartIso],
    set: { pulledAt },
  }).run()
}

async function loadVisits(
  db: AppDb,
  storeId: string,
  startIso: string,
  endIso: string,
  now: Date,
): Promise<{ visits: MediaResVisit[]; chicken: ChickenVisit[]; warning: string | null }> {
  const currentStart = mondayWeekRange(0, now).startIso
  let warning: string | null = null
  const tenant = isFirebaseAvailable() ? getBusinessConfig().tenant_id : null
  for (const week of mondayWeeksInRange(startIso, endIso)) {
    const current = week.startIso === currentStart
    if (!current && weekMarked(db, storeId, week.startIso)) continue
    if (!tenant) {
      if (current) warning = 'Puede faltar mercadería cargada en otra caja.'
      continue
    }
    try {
      await pullMerchandiseIntakesForStoreWeek(tenant, storeId, week.startIso, week.endIso)
      markWeek(db, storeId, week.startIso, now.toISOString())
    } catch (err) {
      log.warn('[summary] No se pudo bajar la mercadería de la semana', { storeId, week: week.startYmd, err })
      warning = 'Puede faltar mercadería cargada en otra caja.'
    }
  }

  const intakes = db.select().from(merchandiseIntakes).where(and(
    eq(merchandiseIntakes.storeId, storeId),
    eq(merchandiseIntakes.status, 'confirmed'),
    gte(merchandiseIntakes.createdAt, startIso),
    lt(merchandiseIntakes.createdAt, endIso),
  )).all()
  const ids = intakes.map(row => row.id)
  const lineRows = ids.length === 0
    ? []
    : db.select().from(merchandiseIntakeLines).where(inArray(merchandiseIntakeLines.intakeId, ids)).all()
  const linesByIntake = new Map<string, typeof lineRows>()
  for (const line of lineRows) {
    const list = linesByIntake.get(line.intakeId) ?? []
    list.push(line)
    linesByIntake.set(line.intakeId, list)
  }
  const nameIds = [...new Set(intakes.map(row => row.createdBy))]
  const names = new Map<string, string>()
  if (nameIds.length > 0) {
    for (const user of db.select({ id: users.id, name: users.name }).from(users).all()) {
      if (nameIds.includes(user.id)) names.set(user.id, user.name)
    }
  }
  const mapped = intakes.map(row => ({
    id: row.id,
    createdAt: row.createdAt,
    providerName: row.providerName,
    receivedByName: names.get(row.createdBy) ?? '',
    lines: (linesByIntake.get(row.id) ?? []).map(line => ({
      rubroId: line.rubroId,
      rubroName: line.rubroName,
      nameKey: line.nameKey,
      template: line.template,
      count: line.count,
      netKg: line.netKg,
      grossKg: line.grossKg,
      costUnit: line.costUnit,
      packCount: line.packCount,
      weightsKg: parseMerchWeightsJson(line.weightsJson),
    })),
  }))
  return { visits: mediaResVisits(mapped), chicken: chickenVisits(mapped), warning }
}

export async function loadAdminSummary(input: {
  storeId: string
  startIso: string
  endIso: string
  now?: Date
}): Promise<AdminSummaryData> {
  const db = getDb()
  const store = db.select({ id: stores.id }).from(stores).where(eq(stores.id, input.storeId)).get()
  if (!store) throw new Error('LOCAL_NOT_FOUND')
  const now = input.now ?? new Date()
  const shifts = await loadShifts(db, input.storeId, input.startIso, input.endIso, now)
  const visitResult = await loadVisits(db, input.storeId, input.startIso, input.endIso, now)
  const fiado = loadStoreFiado(db, input.storeId, input.startIso, input.endIso)
  return {
    shifts,
    visits: visitResult.visits,
    chicken: visitResult.chicken,
    warning: visitResult.warning,
    fiado,
  }
}
