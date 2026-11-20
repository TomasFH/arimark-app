/**
 * Sync de transferencias entre locales.
 * Outbox por documento: solo filas con syncedAt vacío.
 * El pull es un rango de occurredAt. No hay listener y no se baja la colección entera.
 *
 * Path: licenses/{tenantId}/storeTransfers/{id}
 */
import { collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, setDoc, where } from 'firebase/firestore'
import log from 'electron-log'
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm'
import {
  STORE_TRANSFER_NAME_MAX,
  STORE_TRANSFER_NOTES_MAX,
  STORE_TRANSFER_PENDING_LIMIT,
  STORE_TRANSFER_QUANTITY_MAX,
  STORE_TRANSFER_UNITS,
  STORE_TRANSFER_VALUE_MAX,
  pendingStoreTransfers,
  type StoreTransferStatus,
  type StoreTransferUnit,
} from '@carniceria/shared'
import { getDb } from '../db/client'
import { storeTransfers } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

const STATUSES = new Set<string>(['pending', 'confirmed', 'cancelled'])

type RemoteTransfer = {
  id: string
  productName: string
  quantity: number
  unit: StoreTransferUnit
  fromStoreId: string
  toStoreId: string
  occurredAt: string
  notes: string | null
  estimatedValue: number | null
  status: StoreTransferStatus
  receivedQuantity: number | null
  hasDifference: boolean
  confirmedAt: string | null
  confirmedBy: string | null
  createdAt: string
  createdBy: string
  updatedAt: string | null
  updatedBy: string | null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > max) return null
  return trimmed
}

function optionalNotes(value: unknown): string | null | undefined {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.trim().length > STORE_TRANSFER_NOTES_MAX) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function optionalValue(value: unknown): number | null | undefined {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value < 0 || value > STORE_TRANSFER_VALUE_MAX) return undefined
  return value
}

export function parseStoreTransferDoc(id: string, data: Record<string, unknown>): RemoteTransfer | null {
  if (data['deleted'] === true) return null
  const status = data['status']
  if (typeof status !== 'string' || !STATUSES.has(status)) return null
  const productName = text(data['productName'], STORE_TRANSFER_NAME_MAX)
  const unit = data['unit']
  if (!productName || typeof unit !== 'string' || !(STORE_TRANSFER_UNITS as readonly string[]).includes(unit)) {
    return null
  }
  const quantity = data['quantity']
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > STORE_TRANSFER_QUANTITY_MAX) {
    return null
  }
  const fromStoreId = text(data['fromStoreId'], 128)
  const toStoreId = text(data['toStoreId'], 128)
  const occurredAt = text(data['occurredAt'], 40)
  const createdAt = text(data['createdAt'], 40)
  const createdBy = text(data['createdBy'], 128)
  if (!fromStoreId || !toStoreId || fromStoreId === toStoreId || !occurredAt || !createdAt || !createdBy) {
    return null
  }
  const notes = optionalNotes(data['notes'])
  const estimatedValue = optionalValue(data['estimatedValue'])
  if (notes === undefined || estimatedValue === undefined) return null

  let receivedQuantity: number | null = null
  if (status === 'confirmed') {
    const received = data['receivedQuantity']
    if (typeof received !== 'number' || !Number.isFinite(received) || received < 0 || received > STORE_TRANSFER_QUANTITY_MAX) {
      return null
    }
    receivedQuantity = received
  }

  const confirmedAt = status === 'confirmed' ? text(data['confirmedAt'], 40) : null
  const confirmedBy = status === 'confirmed' ? text(data['confirmedBy'], 128) : null
  if (status === 'confirmed' && (!confirmedAt || !confirmedBy)) return null

  return {
    id,
    productName,
    quantity,
    unit: unit as StoreTransferUnit,
    fromStoreId,
    toStoreId,
    occurredAt,
    notes,
    estimatedValue,
    status: status as StoreTransferStatus,
    receivedQuantity,
    hasDifference: status === 'confirmed' && receivedQuantity !== quantity,
    confirmedAt,
    confirmedBy,
    createdAt,
    createdBy,
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : null,
    updatedBy: typeof data['updatedBy'] === 'string' ? data['updatedBy'] : null,
  }
}

function toFirestore(row: RemoteTransfer): Record<string, unknown> {
  return {
    id: row.id,
    productName: row.productName,
    quantity: row.quantity,
    unit: row.unit,
    fromStoreId: row.fromStoreId,
    toStoreId: row.toStoreId,
    occurredAt: row.occurredAt,
    notes: row.notes,
    estimatedValue: row.estimatedValue,
    status: row.status,
    receivedQuantity: row.receivedQuantity,
    hasDifference: row.hasDifference,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    deleted: false,
  }
}

function rowToRemote(row: typeof storeTransfers.$inferSelect): RemoteTransfer {
  return {
    id: row.id,
    productName: row.productName,
    quantity: row.quantity,
    unit: row.unit,
    fromStoreId: row.fromStoreId,
    toStoreId: row.toStoreId,
    occurredAt: row.occurredAt,
    notes: row.notes,
    estimatedValue: row.estimatedValue,
    status: row.status,
    receivedQuantity: row.receivedQuantity,
    hasDifference: row.hasDifference,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

function saveRemote(remote: RemoteTransfer, syncedAt: string): void {
  const db = getDb()
  const values = {
    productName: remote.productName,
    quantity: remote.quantity,
    unit: remote.unit,
    fromStoreId: remote.fromStoreId,
    toStoreId: remote.toStoreId,
    occurredAt: remote.occurredAt,
    notes: remote.notes,
    estimatedValue: remote.estimatedValue,
    status: remote.status,
    receivedQuantity: remote.receivedQuantity,
    hasDifference: remote.hasDifference,
    confirmedAt: remote.confirmedAt,
    confirmedBy: remote.confirmedBy,
    createdAt: remote.createdAt,
    createdBy: remote.createdBy,
    updatedAt: remote.updatedAt,
    updatedBy: remote.updatedBy,
    syncedAt,
  }
  db.insert(storeTransfers).values({ id: remote.id, ...values }).onConflictDoUpdate({
    target: storeTransfers.id,
    set: values,
  }).run()
}

export async function pushUnsyncedStoreTransfers(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(storeTransfers).where(isNull(storeTransfers.syncedAt)).all()
  if (pending.length === 0) return

  const firestore = getFirestore(getFirebaseApp())
  const now = new Date().toISOString()
  let pushed = 0

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'storeTransfers', row.id)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>
        if (data['status'] === 'confirmed' || data['status'] === 'cancelled') {
          const remote = parseStoreTransferDoc(row.id, data)
          if (!remote) {
            log.error('[storeTransferSync] La copia remota no se pudo leer', { id: row.id })
            continue
          }
          saveRemote(remote, now)
          continue
        }
      }

      await setDoc(ref, toFirestore(rowToRemote(row)), { merge: true })
      db.update(storeTransfers).set({ syncedAt: now }).where(eq(storeTransfers.id, row.id)).run()
      pushed += 1
    } catch (err) {
      log.error('[storeTransferSync] Error al pushear transferencia', { id: row.id, err })
    }
  }

  if (pushed > 0) log.info('[storeTransferSync] Transferencias pusheadas', { count: pushed })
}

/**
 * Baja las transferencias cuya fecha cae en [startIso, endIso).
 * Una sola consulta por occurredAt. No pisa una fila local que todavía no subió.
 */
export async function pullStoreTransfersForRange(
  tenantId: string,
  startIso: string,
  endIso: string,
): Promise<number> {
  if (!isFirebaseAvailable()) return 0

  const firestore = getFirestore(getFirebaseApp())
  const q = query(
    collection(firestore, 'licenses', tenantId, 'storeTransfers'),
    where('occurredAt', '>=', startIso),
    where('occurredAt', '<', endIso),
  )
  const snap = await getDocs(q)
  const db = getDb()
  const now = new Date().toISOString()
  let upserted = 0

  for (const item of snap.docs) {
    try {
      const data = item.data() as Record<string, unknown>
      const remote = parseStoreTransferDoc(item.id, data)
      if (!remote) continue
      const existing = db.select({ syncedAt: storeTransfers.syncedAt })
        .from(storeTransfers)
        .where(eq(storeTransfers.id, remote.id))
        .get()
      if (existing && existing.syncedAt === null) continue
      saveRemote(remote, now)
      upserted += 1
    } catch (err) {
      log.error('[storeTransferSync] Error al bajar transferencia', { id: item.id, err })
    }
  }

  if (upserted > 0) {
    log.info('[storeTransferSync] Transferencias bajadas del rango', { count: upserted })
  }
  return upserted
}

function toListRow(remote: RemoteTransfer): StoreTransferListRow {
  return {
    id: remote.id,
    productName: remote.productName,
    quantity: remote.quantity,
    unit: remote.unit,
    fromStoreId: remote.fromStoreId,
    toStoreId: remote.toStoreId,
    occurredAt: remote.occurredAt,
    notes: remote.notes,
    estimatedValue: remote.estimatedValue,
    status: remote.status,
    receivedQuantity: remote.receivedQuantity,
    hasDifference: remote.hasDifference,
    confirmedAt: remote.confirmedAt,
    confirmedBy: remote.confirmedBy,
    createdAt: remote.createdAt,
    createdBy: remote.createdBy,
  }
}

/**
 * Pendientes del resumen. Una consulta por licencia, sin caché y sin listener.
 * Pide uno más que el tope para saber si la lista quedó corta.
 */
export async function loadPendingStoreTransfers(
  tenantId: string,
  startIso: string,
  endIso: string,
): Promise<{ ok: true; rows: StoreTransferListRow[]; incomplete: boolean } | { ok: false; reason: 'OFFLINE' }> {
  if (!isFirebaseAvailable()) return { ok: false, reason: 'OFFLINE' }

  const firestore = getFirestore(getFirebaseApp())
  const q = query(
    collection(firestore, 'licenses', tenantId, 'storeTransfers'),
    where('status', '==', 'pending'),
    where('occurredAt', '>=', startIso),
    where('occurredAt', '<', endIso),
    orderBy('occurredAt'),
    limit(STORE_TRANSFER_PENDING_LIMIT + 1),
  )
  const snap = await getDocs(q)
  const parsed: StoreTransferListRow[] = []
  for (const item of snap.docs) {
    const remote = parseStoreTransferDoc(item.id, item.data() as Record<string, unknown>)
    if (remote) parsed.push(toListRow(remote))
  }
  const pending = pendingStoreTransfers(parsed)
  return {
    ok: true,
    rows: pending.rows,
    incomplete: snap.docs.length > STORE_TRANSFER_PENDING_LIMIT || pending.incomplete,
  }
}

export interface StoreTransferListRow {
  id: string
  productName: string
  quantity: number
  unit: StoreTransferUnit
  fromStoreId: string
  toStoreId: string
  occurredAt: string
  notes: string | null
  estimatedValue: number | null
  status: StoreTransferStatus
  receivedQuantity: number | null
  hasDifference: boolean
  confirmedAt: string | null
  confirmedBy: string | null
  createdAt: string
  createdBy: string
}

const pulledRanges = new Set<string>()

export function clearStoreTransferPullCache(): void {
  pulledRanges.clear()
}

function readRange(startIso: string, endIso: string): StoreTransferListRow[] {
  return getDb().select().from(storeTransfers).where(and(
    gte(storeTransfers.occurredAt, startIso),
    lt(storeTransfers.occurredAt, endIso),
  )).orderBy(desc(storeTransfers.occurredAt)).all().map(row => ({
    id: row.id,
    productName: row.productName,
    quantity: row.quantity,
    unit: row.unit,
    fromStoreId: row.fromStoreId,
    toStoreId: row.toStoreId,
    occurredAt: row.occurredAt,
    notes: row.notes,
    estimatedValue: row.estimatedValue,
    status: row.status,
    receivedQuantity: row.receivedQuantity,
    hasDifference: row.hasDifference,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  }))
}

/**
 * La primera vez del rango en esta sesión baja de Firestore.
 * Las siguientes leen solo SQLite, hasta que Actualizar pide refresh.
 */
export async function listStoreTransfersForRange(
  tenantId: string,
  startIso: string,
  endIso: string,
  refresh: boolean,
): Promise<StoreTransferListRow[]> {
  const key = `${tenantId}\0${startIso}\0${endIso}`
  if (refresh || !pulledRanges.has(key)) {
    await pullStoreTransfersForRange(tenantId, startIso, endIso)
    pulledRanges.add(key)
  }
  return readRange(startIso, endIso)
}
