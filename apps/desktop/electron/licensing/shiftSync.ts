/**
 * Servicio de sincronización de turnos con Firestore.
 *
 * Estructura Firestore:
 *   licenses/{tenantId}/shifts/{shiftId}
 *
 * Responsabilidades:
 *   1. pushUnsyncedShifts — envía filas locales con syncedAt=null a Firestore
 *                           y marca syncedAt tras cada push exitoso.
 *   2. reconcileStoreShifts — baja turnos remotos y aplica cierres hechos en
 *                           otra PC/ventana, para no bloquear la caja con un
 *                           turno que ya se cerró (o para ver uno abierto).
 *
 * Al abrir un turno: syncedAt queda null → se pushea.
 * Al cerrar un turno: el handler debe setear syncedAt=null de nuevo → re-push
 * con closedAt / closingCash / etc.
 *
 * Un `closedAt` o un monto en null no se publican encima de un cierre o de un
 * número que ya está en Firestore. Si la ficha local sigue abierta y la nube
 * ya tiene cierre, esta PC lo adopta y no la vuelve a subir como abierta.
 *
 * No-op completo cuando isFirebaseAvailable() === false (entorno dev).
 */

import { getFirestore, doc, setDoc, collection, getDocs, getDoc, query, where, orderBy, limit } from 'firebase/firestore'
import log from 'electron-log'
import { eq, isNull } from 'drizzle-orm'
import {
  compactBillLines,
  parseBillLines,
  type BillLine,
} from '@carniceria/shared'
import { getDb } from '../db/client'
import { shifts, users, stores } from '../db/schema'
import {
  declaredCashLeft,
  insertBillLinesIfNone,
  readBillLines,
  readLastClosedHandover,
  type CashHandoverSnapshot,
} from '../db/billCountStore'
import { closingCashFromParts, finiteAmount } from '../db/shiftCloseAmounts'
import { snapshotShiftMoney } from '../db/shiftMoney'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

interface RemoteShiftDoc {
  id?: string
  storeId?: string
  userId?: string
  cashierName?: string | null
  shiftType?: 'morning' | 'evening'
  startedAt?: string
  closedAt?: string | null
  openingCash?: number
  closingCash?: number | null
  safeAmount?: number | null
  deliveredAmount?: number | null
  deliveredTo?: string | null
  notes?: string | null
  source?: 'desktop' | 'mobile'
  openingBills?: unknown
  closingBills?: unknown
  handoverExpectedBills?: unknown
  openingBillsCounted?: boolean
  closingBillsCounted?: boolean
  handoverFromShiftId?: string | null
  handoverFromCashierName?: string | null
  handoverFromClosedAt?: string | null
  cashLeft?: number | null
  closedByUserId?: string | null
  closedByName?: string | null
  soldTotal?: number | null
  cashTotal?: number | null
  cardWalletTotal?: number | null
  debtTotal?: number | null
  expenseTotal?: number | null
  contributionTotal?: number | null
  walletCashTotal?: number | null
  debitTotal?: number | null
  walletTotal?: number | null
  creditTotal?: number | null
  moneySnapshottedAt?: string | null
}

export interface ReconcileShiftsFilter {
  storeId?: string
  userId?: string
}

function shiftBillFirestoreFields(shiftId: string, row: {
  openingCounted: boolean
  closingCounted: boolean
  handoverFromShiftId: string | null
  handoverFromCashierName: string | null
  handoverFromClosedAt: string | null
}): {
  openingBills: BillLine[]
  closingBills: BillLine[]
  handoverExpectedBills: BillLine[]
  openingBillsCounted: boolean
  closingBillsCounted: boolean
  handoverFromShiftId: string | null
  handoverFromCashierName: string | null
  handoverFromClosedAt: string | null
} {
  const db = getDb()
  return {
    openingBills: readBillLines(db, shiftId, 'opening'),
    closingBills: readBillLines(db, shiftId, 'closing'),
    handoverExpectedBills: readBillLines(db, shiftId, 'expected'),
    openingBillsCounted: Boolean(row.openingCounted),
    closingBillsCounted: Boolean(row.closingCounted),
    handoverFromShiftId: row.handoverFromShiftId ?? null,
    handoverFromCashierName: row.handoverFromCashierName ?? null,
    handoverFromClosedAt: row.handoverFromClosedAt ?? null,
  }
}

function applyRemoteShiftBills(
  shiftId: string,
  data: RemoteShiftDoc,
  alreadyOpeningCounted: boolean,
  alreadyClosingCounted: boolean,
): void {
  const db = getDb()
  if (!alreadyOpeningCounted) {
    insertBillLinesIfNone(db, shiftId, 'opening', parseBillLines(data.openingBills))
    insertBillLinesIfNone(db, shiftId, 'expected', parseBillLines(data.handoverExpectedBills))
  }
  if (!alreadyClosingCounted) {
    insertBillLinesIfNone(db, shiftId, 'closing', parseBillLines(data.closingBills))
  }
}

type LocalShift = typeof shifts.$inferSelect

function remoteText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Número para el push.
 * Un valor local (incluso 0) se publica.
 * Null local no pisa un número que ya está en Firestore: se omite (undefined).
 * Si en la nube tampoco hay número, se manda null para dejar el campo explícito.
 */
function amountForPush(localVal: number | null, remoteVal: unknown): number | null | undefined {
  if (typeof localVal === 'number' && Number.isFinite(localVal)) return localVal
  if (typeof remoteVal === 'number' && Number.isFinite(remoteVal)) return undefined
  return null
}

function textForPush(localVal: string | null, remoteVal: unknown): string | null | undefined {
  if (typeof localVal === 'string' && localVal.length > 0) return localVal
  if (typeof remoteVal === 'string' && remoteVal.length > 0) return undefined
  return null
}

function flagForPush(localVal: boolean, remoteVal: unknown): boolean | undefined {
  if (localVal) return true
  if (remoteVal === true) return undefined
  return false
}

function billsForPush(localBills: BillLine[], remoteVal: unknown): BillLine[] | undefined {
  if (localBills.length > 0) return localBills
  if (Array.isArray(remoteVal) && remoteVal.length > 0) return undefined
  return localBills
}

function withoutUndefined(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Copia el cierre remoto sobre una ficha local todavía abierta.
 * No toca ventas, gastos, señas ni fiados.
 * Si esta PC tiene esos movimientos, calcula la plata y deja el turno para re-subir.
 * Si no los tiene, no calcula y no vuelve a publicar la ficha.
 */
function adoptRemoteClose(
  local: LocalShift,
  data: RemoteShiftDoc,
  now: string,
): 'money' | 'close-only' | 'noop' {
  const remoteClosedAt = remoteText(data.closedAt)
  if (!remoteClosedAt || local.closedAt) return 'noop'

  const db = getDb()
  const cashLeft = finiteAmount(data.cashLeft)
  const delivered = finiteAmount(data.deliveredAmount)
  const remoteClosing = finiteAmount(data.closingCash)
  const closingCash = remoteClosing ?? closingCashFromParts(cashLeft, delivered)
  const safeAmount = finiteAmount(data.safeAmount)
  const deliveredTo = remoteText(data.deliveredTo)
  const notes = remoteText(data.notes)
  const closedByUserId = remoteText(data.closedByUserId)
  const closedByName = remoteText(data.closedByName)
  const money = snapshotShiftMoney(db, local, now)

  db.update(shifts).set({
    closedAt: remoteClosedAt,
    ...(cashLeft != null ? { cashLeft } : {}),
    ...(delivered != null ? { deliveredAmount: delivered } : {}),
    ...(closingCash != null ? { closingCash } : {}),
    ...(safeAmount != null ? { safeAmount } : {}),
    ...(deliveredTo != null ? { deliveredTo } : {}),
    ...(notes != null && !local.notes ? { notes } : {}),
    ...(closedByUserId != null ? { closedByUserId } : {}),
    ...(closedByName != null ? { closedByName } : {}),
    ...(money ?? {}),
    closingCounted: local.closingCounted || data.closingBillsCounted === true,
    syncedAt: money ? null : now,
  }).where(eq(shifts.id, local.id)).run()

  applyRemoteShiftBills(local.id, data, Boolean(local.openingCounted), Boolean(local.closingCounted))
  log.info('[shiftSync] Cierre remoto adoptado', { id: local.id, money: Boolean(money) })
  return money ? 'money' : 'close-only'
}

function shiftPushPayload(
  row: LocalShift,
  remote: RemoteShiftDoc | null,
  cashierName: string | null,
): Record<string, unknown> {
  const bills = shiftBillFirestoreFields(row.id, row)
  const openingBills = billsForPush(bills.openingBills, remote?.openingBills)
  const closingBills = billsForPush(bills.closingBills, remote?.closingBills)
  const expectedBills = billsForPush(bills.handoverExpectedBills, remote?.handoverExpectedBills)
  const openingCounted = flagForPush(bills.openingBillsCounted, remote?.openingBillsCounted)
  const closingCounted = flagForPush(bills.closingBillsCounted, remote?.closingBillsCounted)

  return {
    id: row.id,
    storeId: row.storeId,
    userId: row.userId,
    shiftType: row.shiftType,
    startedAt: row.startedAt,
    openingCash: row.openingCash,
    source: row.source,
    ...withoutUndefined({
      cashierName: textForPush(cashierName, remote?.cashierName),
      closedAt: textForPush(row.closedAt, remote?.closedAt),
      closingCash: amountForPush(row.closingCash, remote?.closingCash),
      safeAmount: amountForPush(row.safeAmount, remote?.safeAmount),
      deliveredAmount: amountForPush(row.deliveredAmount, remote?.deliveredAmount),
      deliveredTo: textForPush(row.deliveredTo, remote?.deliveredTo),
      notes: textForPush(row.notes, remote?.notes),
      cashLeft: amountForPush(row.cashLeft, remote?.cashLeft),
      closedByUserId: textForPush(row.closedByUserId, remote?.closedByUserId),
      closedByName: textForPush(row.closedByName, remote?.closedByName),
      soldTotal: amountForPush(row.soldTotal, remote?.soldTotal),
      cashTotal: amountForPush(row.cashTotal, remote?.cashTotal),
      cardWalletTotal: amountForPush(row.cardWalletTotal, remote?.cardWalletTotal),
      debtTotal: amountForPush(row.debtTotal, remote?.debtTotal),
      expenseTotal: amountForPush(row.expenseTotal, remote?.expenseTotal),
      contributionTotal: amountForPush(row.contributionTotal, remote?.contributionTotal),
      walletCashTotal: amountForPush(row.walletCashTotal, remote?.walletCashTotal),
      debitTotal: amountForPush(row.debitTotal, remote?.debitTotal),
      walletTotal: amountForPush(row.walletTotal, remote?.walletTotal),
      creditTotal: amountForPush(row.creditTotal, remote?.creditTotal),
      moneySnapshottedAt: textForPush(row.moneySnapshottedAt, remote?.moneySnapshottedAt),
      openingBills,
      closingBills,
      handoverExpectedBills: expectedBills,
      openingBillsCounted: openingCounted,
      closingBillsCounted: closingCounted,
      handoverFromShiftId: textForPush(row.handoverFromShiftId, remote?.handoverFromShiftId),
      handoverFromCashierName: textForPush(row.handoverFromCashierName, remote?.handoverFromCashierName),
      handoverFromClosedAt: textForPush(row.handoverFromClosedAt, remote?.handoverFromClosedAt),
    }),
  }
}

/**
 * Busca shifts locales con syncedAt=null y los sube a Firestore.
 * Marca syncedAt en SQLite tras cada push exitoso.
 * Antes de subir una ficha abierta, si Firestore ya tiene cierre, lo adopta.
 */
export async function pushUnsyncedShifts(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(shifts).where(isNull(shifts.syncedAt)).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()
  let pushed = 0

  for (const pendingRow of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'shifts', pendingRow.id)
      let remote: RemoteShiftDoc | null = null
      try {
        const remoteSnap = await getDoc(ref)
        if (remoteSnap.exists()) remote = remoteSnap.data() as RemoteShiftDoc
      } catch (err) {
        log.error('[shiftSync] No se pudo leer el turno remoto; no se sube para no pisar un cierre', {
          id: pendingRow.id,
          err,
        })
        continue
      }

      let row = pendingRow
      if (!row.closedAt && remoteText(remote?.closedAt)) {
        const adopted = adoptRemoteClose(row, remote ?? {}, now)
        if (adopted !== 'money') continue
        const reloaded = db.select().from(shifts).where(eq(shifts.id, row.id)).get()
        if (!reloaded?.closedAt) continue
        row = reloaded
      }

      const userRow = db.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).all()[0]
      const cashierName = userRow?.name?.trim() ? userRow.name.trim() : null

      await setDoc(ref, shiftPushPayload(row, remote, cashierName), { merge: true })

      db.update(shifts)
        .set({ syncedAt: now })
        .where(eq(shifts.id, row.id))
        .run()
      pushed++
    } catch (err) {
      log.error('[shiftSync] Error al pushear shift', { id: pendingRow.id, err })
    }
  }

  log.info('[shiftSync] Shifts pusheados', { count: pushed })
}

function ensureUserStub(userId: string, name: string | null | undefined, storeId: string): void {
  const db = getDb()
  const existing = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()
  if (existing) return
  const now = new Date().toISOString()
  db.insert(users).values({
    id: userId,
    name: name && name.trim() !== '' ? name : 'Cajera',
    storeId,
    role: 'cashier',
    active: true,
    createdAt: now,
  }).run()
}

/**
 * Baja turnos de Firestore y alinea el SQLite local:
 *  - Si el remoto está cerrado y el local sigue abierto → cierra el local.
 *  - Si el remoto existe y no está en SQLite → lo inserta (para poder retomarlo o cerrarlo).
 *  - Si el local está cerrado y el remoto sigue abierto → marca syncedAt=null para re-pushear el cierre.
 *
 * Luego drena el outbox local. No-op en APP_ENV=dev.
 */
export async function reconcileStoreShifts(
  tenantId: string,
  filter: ReconcileShiftsFilter = {},
): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'shifts')
    const constraints = [where('closedAt', '==', null)]
    if (filter.storeId) constraints.unshift(where('storeId', '==', filter.storeId))
    else if (filter.userId) constraints.unshift(where('userId', '==', filter.userId))
    const snap = await getDocs(query(col, ...constraints))

    const db = getDb()
    const now = new Date().toISOString()
    let applied = 0

    for (const d of snap.docs) {
      const data = d.data() as RemoteShiftDoc
      const id = data.id || d.id
      const storeId = data.storeId
      const userId = data.userId
      const shiftType = data.shiftType
      const startedAt = data.startedAt
      if (!storeId || !userId || !shiftType || !startedAt) {
        log.warn('[shiftSync] Documento shift incompleto, omitido', { id })
        continue
      }
      if (shiftType !== 'morning' && shiftType !== 'evening') continue

      const storeRow = db.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).get()
      if (!storeRow) {
        log.warn('[shiftSync] Shift remoto omitido: local no está en cache', { id, storeId })
        continue
      }

      try {
        ensureUserStub(userId, data.cashierName, storeId)
      } catch (err) {
        log.warn('[shiftSync] No se pudo crear stub de usuario para shift remoto', { id, userId, err })
        continue
      }

      const local = db.select().from(shifts).where(eq(shifts.id, id)).get()
      const remoteClosedAt = data.closedAt ?? null
      const source = data.source === 'mobile' ? 'mobile' : 'desktop'

      if (!local) {
        const cashLeft = finiteAmount(data.cashLeft)
        const delivered = finiteAmount(data.deliveredAmount)
        const closingCash = finiteAmount(data.closingCash) ?? closingCashFromParts(cashLeft, delivered)
        db.insert(shifts).values({
          id,
          storeId,
          userId,
          shiftType,
          startedAt,
          closedAt: remoteClosedAt,
          openingCash: Number(data.openingCash ?? 0),
          closingCash,
          safeAmount: finiteAmount(data.safeAmount),
          deliveredAmount: delivered,
          deliveredTo: data.deliveredTo ?? null,
          notes: data.notes ?? null,
          source,
          syncedAt: now,
          openingCounted: data.openingBillsCounted === true,
          closingCounted: data.closingBillsCounted === true,
          handoverFromShiftId: data.handoverFromShiftId ?? null,
          handoverFromCashierName: data.handoverFromCashierName ?? null,
          handoverFromClosedAt: data.handoverFromClosedAt ?? null,
          cashLeft,
          closedByUserId: remoteText(data.closedByUserId),
          closedByName: remoteText(data.closedByName),
          openedLocally: false,
          soldTotal: finiteAmount(data.soldTotal),
          cashTotal: finiteAmount(data.cashTotal),
          cardWalletTotal: finiteAmount(data.cardWalletTotal),
          debtTotal: finiteAmount(data.debtTotal),
          expenseTotal: finiteAmount(data.expenseTotal),
          contributionTotal: finiteAmount(data.contributionTotal),
          walletCashTotal: finiteAmount(data.walletCashTotal),
          debitTotal: finiteAmount(data.debitTotal),
          walletTotal: finiteAmount(data.walletTotal),
          creditTotal: finiteAmount(data.creditTotal),
          moneySnapshottedAt: remoteText(data.moneySnapshottedAt),
        }).run()
        applyRemoteShiftBills(id, data, false, false)
        applied++
        continue
      }

      if (remoteClosedAt && !local.closedAt) {
        adoptRemoteClose(local, data, now)
        applied++
        continue
      }

      if (local.closedAt && !remoteClosedAt) {
        db.update(shifts).set({ syncedAt: null }).where(eq(shifts.id, id)).run()
        applied++
      }
    }

    const seenRemote = new Set(snap.docs.map(d => d.id))
    const localOpen = db.select().from(shifts).where(isNull(shifts.closedAt)).all()
      .filter(row => {
        if (filter.storeId && row.storeId !== filter.storeId) return false
        if (filter.userId && row.userId !== filter.userId) return false
        return !seenRemote.has(row.id)
      })
    for (const local of localOpen) {
      const remoteSnap = await getDoc(doc(firestore, 'licenses', tenantId, 'shifts', local.id))
      if (!remoteSnap.exists()) continue
      const data = remoteSnap.data() as RemoteShiftDoc
      if (!remoteText(data.closedAt)) continue
      adoptRemoteClose(local, data, now)
      applied++
    }

    log.info('[shiftSync] Shifts reconciliados desde Firestore', { count: snap.size, applied })
  } catch (err) {
    log.error('[shiftSync] Error en reconcileStoreShifts', err)
  }

  await pushUnsyncedShifts(tenantId)
}

function handoverFromRemoteDoc(id: string, data: RemoteShiftDoc): CashHandoverSnapshot | null {
  if (!data.closedAt || !data.userId) return null
  const bills = parseBillLines(data.closingBills)
  return {
    fromShiftId: data.id || id,
    fromUserId: data.userId,
    fromCashierName: data.cashierName?.trim() || data.userId,
    fromClosedAt: data.closedAt,
    bills: compactBillLines(bills),
    counted: data.closingBillsCounted === true || bills.length > 0,
    cashLeft: declaredCashLeft(
      finiteAmount(data.cashLeft),
      finiteAmount(data.closingCash),
      finiteAmount(data.deliveredAmount),
    ),
  }
}

async function fetchRemoteLastClosedHandover(
  tenantId: string,
  storeId: string,
): Promise<CashHandoverSnapshot | null> {
  if (!isFirebaseAvailable()) return null

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const col = collection(firestore, 'licenses', tenantId, 'shifts')
  const snap = await getDocs(query(
    col,
    where('storeId', '==', storeId),
    orderBy('startedAt', 'desc'),
    limit(8),
  ))

  for (const d of snap.docs) {
    const data = d.data() as RemoteShiftDoc
    const handover = handoverFromRemoteDoc(d.id, data)
    if (handover) return handover
  }
  return null
}

/**
 * Último cierre del local para precargar la grilla de apertura.
 * Prefiere el más reciente entre SQLite y Firestore (query acotada).
 */
export async function loadCashHandoverForStore(
  tenantId: string,
  storeId: string,
): Promise<CashHandoverSnapshot | null> {
  const db = getDb()
  const local = readLastClosedHandover(db, storeId)

  try {
    const remote = await fetchRemoteLastClosedHandover(tenantId, storeId)
    if (!remote) return local
    if (!local || remote.fromClosedAt > local.fromClosedAt) {
      const existing = db.select().from(shifts).where(eq(shifts.id, remote.fromShiftId)).get()
      if (existing && !existing.closingCounted) {
        applyRemoteShiftBills(existing.id, {
          closingBills: remote.bills,
          closingBillsCounted: remote.counted,
        }, Boolean(existing.openingCounted), Boolean(existing.closingCounted))
        if (remote.counted) {
          db.update(shifts).set({ closingCounted: true }).where(eq(shifts.id, existing.id)).run()
        }
      }
      return remote
    }
  } catch (err) {
    log.warn('[shiftSync] No se pudo leer el último cierre remoto', err)
  }

  return local
}
