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
 * No-op completo cuando isFirebaseAvailable() === false (entorno dev).
 */

import { getFirestore, doc, setDoc, collection, getDocs, getDoc, query, where } from 'firebase/firestore'
import log from 'electron-log'
import { eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { shifts, users, stores } from '../db/schema'
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
}

export interface ReconcileShiftsFilter {
  storeId?: string
  userId?: string
}

/**
 * Busca shifts locales con syncedAt=null y los sube a Firestore.
 * Marca syncedAt en SQLite tras cada push exitoso.
 */
export async function pushUnsyncedShifts(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(shifts).where(isNull(shifts.syncedAt)).all()

  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const s of pending) {
    try {
      // Resolver nombre del cajero desde el cache local de usuarios.
      const userRow = db.select({ name: users.name }).from(users).where(eq(users.id, s.userId)).all()[0]
      const cashierName = userRow?.name ?? null

      const ref = doc(firestore, 'licenses', tenantId, 'shifts', s.id)
      await setDoc(ref, {
        id: s.id,
        storeId: s.storeId,
        userId: s.userId,
        cashierName,
        shiftType: s.shiftType,
        startedAt: s.startedAt,
        closedAt: s.closedAt ?? null,
        openingCash: s.openingCash,
        closingCash: s.closingCash ?? null,
        safeAmount: s.safeAmount ?? null,
        deliveredAmount: s.deliveredAmount ?? null,
        deliveredTo: s.deliveredTo ?? null,
        notes: s.notes ?? null,
        source: s.source,
      }, { merge: true })

      db.update(shifts)
        .set({ syncedAt: now })
        .where(eq(shifts.id, s.id))
        .run()
    } catch (err) {
      log.error('[shiftSync] Error al pushear shift', { id: s.id, err })
    }
  }

  log.info('[shiftSync] Shifts pusheados', { count: pending.length })
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
        db.insert(shifts).values({
          id,
          storeId,
          userId,
          shiftType,
          startedAt,
          closedAt: remoteClosedAt,
          openingCash: Number(data.openingCash ?? 0),
          closingCash: data.closingCash ?? null,
          safeAmount: data.safeAmount ?? null,
          deliveredAmount: data.deliveredAmount ?? null,
          deliveredTo: data.deliveredTo ?? null,
          notes: data.notes ?? null,
          source,
          syncedAt: now,
        }).run()
        applied++
        continue
      }

      if (remoteClosedAt && !local.closedAt) {
        db.update(shifts).set({
          closedAt: remoteClosedAt,
          closingCash: data.closingCash ?? local.closingCash,
          safeAmount: data.safeAmount ?? local.safeAmount,
          deliveredAmount: data.deliveredAmount ?? local.deliveredAmount,
          deliveredTo: data.deliveredTo ?? local.deliveredTo,
          notes: data.notes ?? local.notes,
          syncedAt: now,
        }).where(eq(shifts.id, id)).run()
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
      const remoteClosedAt = data.closedAt ?? null
      if (!remoteClosedAt) continue
      db.update(shifts).set({
        closedAt: remoteClosedAt,
        closingCash: data.closingCash ?? local.closingCash,
        safeAmount: data.safeAmount ?? local.safeAmount,
        deliveredAmount: data.deliveredAmount ?? local.deliveredAmount,
        deliveredTo: data.deliveredTo ?? local.deliveredTo,
        notes: data.notes ?? local.notes,
        syncedAt: now,
      }).where(eq(shifts.id, local.id)).run()
      applied++
    }

    log.info('[shiftSync] Shifts reconciliados desde Firestore', { count: snap.size, applied })
  } catch (err) {
    log.error('[shiftSync] Error en reconcileStoreShifts', err)
  }

  await pushUnsyncedShifts(tenantId)
}
