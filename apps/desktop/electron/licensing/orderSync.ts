/**
 * Sync de pedidos con Firestore (outbox + pull + listener).
 * Path: licenses/{tenant}/orders/{id}
 */
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import { eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { orders, shifts } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { ensureUserStub } from './syncUserStub'

interface RemoteOrderDoc {
  id: string
  storeId: string
  customerName: string
  phone?: string | null
  items: string
  pickupDate: string
  timeSlot?: string | null
  pickupTime?: string | null
  priority?: boolean
  status: 'pending' | 'ready' | 'delivered' | 'cancelled'
  notes?: string | null
  depositAmount?: number
  depositMethod?: string | null
  depositPayments?: string | null
  depositShiftId?: string | null
  createdAt: string
  /** Pedidos viejos de móvil podían omitirlo; SQLite exige NOT NULL + FK. */
  createdBy?: string | null
  updatedAt?: string | null
  updatedBy?: string | null
  deleted?: boolean
}

/** Autor sintético para docs remotos sin createdBy (no romper el pull). */
export const REMOTE_ORDER_UNKNOWN_USER = 'remote-order-unknown'

function resolveRemoteCreatedBy(raw: unknown, storeId: string): string {
  const id = typeof raw === 'string' ? raw.trim() : ''
  const createdBy = id || REMOTE_ORDER_UNKNOWN_USER
  ensureUserStub(createdBy, storeId)
  return createdBy
}

function resolveRemotePriority(raw: unknown): boolean {
  return raw === true || raw === 'high'
}

function resolveRemoteDepositPayments(raw: unknown): string | null {
  if (raw == null || raw === 0 || raw === '') return null
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return JSON.stringify(raw)
  return null
}

const listeners: Unsubscribe[] = []

function upsertOrderFromRemote(data: RemoteOrderDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId

  if (data.deleted) {
    db.delete(orders).where(eq(orders.id, id)).run()
    return
  }

  const createdBy = resolveRemoteCreatedBy(data.createdBy, data.storeId)
  if (data.updatedBy) ensureUserStub(data.updatedBy, data.storeId)

  // FK opcional a shift: nullificar si el turno no existe en esta PC
  let depositShiftId: string | null = data.depositShiftId ?? null
  if (depositShiftId) {
    const shift = db.select({ id: shifts.id }).from(shifts).where(eq(shifts.id, depositShiftId)).all()[0]
    if (!shift) depositShiftId = null
  }

  db.insert(orders)
    .values({
      id,
      storeId: data.storeId,
      customerName: data.customerName,
      phone: data.phone ?? null,
      items: data.items,
      pickupDate: data.pickupDate,
      timeSlot: (data.timeSlot as 'morning' | 'afternoon' | 'specific' | null) ?? null,
      pickupTime: data.pickupTime ?? null,
      priority: resolveRemotePriority(data.priority),
      status: data.status,
      notes: data.notes ?? null,
      depositAmount: data.depositAmount ?? 0,
      depositMethod: (data.depositMethod as 'cash' | 'debit' | 'wallet' | 'credit' | null) ?? null,
      depositPayments: resolveRemoteDepositPayments(data.depositPayments),
      depositShiftId,
      createdAt: data.createdAt,
      createdBy,
      updatedAt: data.updatedAt ?? null,
      updatedBy: data.updatedBy ?? null,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: orders.id,
      set: {
        storeId: data.storeId,
        customerName: data.customerName,
        phone: data.phone ?? null,
        items: data.items,
        pickupDate: data.pickupDate,
        timeSlot: (data.timeSlot as 'morning' | 'afternoon' | 'specific' | null) ?? null,
        pickupTime: data.pickupTime ?? null,
        priority: resolveRemotePriority(data.priority),
        status: data.status,
        notes: data.notes ?? null,
        depositAmount: data.depositAmount ?? 0,
        depositMethod: (data.depositMethod as 'cash' | 'debit' | 'wallet' | 'credit' | null) ?? null,
        depositPayments: resolveRemoteDepositPayments(data.depositPayments),
        depositShiftId,
        updatedAt: data.updatedAt ?? null,
        updatedBy: data.updatedBy ?? null,
        syncedAt: now,
      },
    })
    .run()
}

export async function pushUnsyncedOrders(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(orders).where(isNull(orders.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'orders', row.id)
      await setDoc(ref, {
        id: row.id,
        storeId: row.storeId,
        customerName: row.customerName,
        phone: row.phone ?? null,
        items: row.items,
        pickupDate: row.pickupDate,
        timeSlot: row.timeSlot ?? null,
        pickupTime: row.pickupTime ?? null,
        priority: row.priority,
        status: row.status,
        notes: row.notes ?? null,
        depositAmount: row.depositAmount,
        depositMethod: row.depositMethod ?? null,
        depositPayments: row.depositPayments ?? null,
        depositShiftId: row.depositShiftId ?? null,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        updatedAt: row.updatedAt ?? null,
        updatedBy: row.updatedBy ?? null,
        deleted: false,
      }, { merge: true })

      db.update(orders).set({ syncedAt: now }).where(eq(orders.id, row.id)).run()
    } catch (err) {
      log.error('[orderSync] Error al pushear order', { id: row.id, err })
    }
  }

  log.info('[orderSync] Orders pusheados', { count: pending.length })
}

export async function markOrderDeletedInFirestore(tenantId: string, orderId: string): Promise<void> {
  if (!isFirebaseAvailable()) return
  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const ref = doc(firestore, 'licenses', tenantId, 'orders', orderId)
    await setDoc(ref, { deleted: true, deletedAt: new Date().toISOString() }, { merge: true })
  } catch (err) {
    log.error('[orderSync] Error al marcar order eliminado', { orderId, err })
  }
}

export async function pullOrdersFromFirestore(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'orders')
    const snap = await getDocs(col)

    for (const d of snap.docs) {
      try {
        upsertOrderFromRemote(d.data() as RemoteOrderDoc, d.id)
      } catch (err) {
        log.error('[orderSync] Error al upsertear order en pull', { id: d.id, err })
      }
    }

    log.info('[orderSync] Orders bajados de Firestore', { count: snap.size })
  } catch (err) {
    log.error('[orderSync] Error en pullOrdersFromFirestore', err)
  }
}

export function startOrderSyncListener(tenantId: string): void {
  if (!isFirebaseAvailable()) return
  if (listeners.length > 0) {
    log.info('[orderSync] Listener ya activo — omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'orders')

    const unsub = onSnapshot(col, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          upsertOrderFromRemote(change.doc.data() as RemoteOrderDoc, change.doc.id)
        } catch (err) {
          log.error('[orderSync] Error al upsertear order desde snapshot', { id: change.doc.id, err })
        }
      }
    }, err => {
      log.error('[orderSync] Error en listener', err)
    })

    listeners.push(unsub)
    log.info('[orderSync] Listener iniciado')
  } catch (err) {
    log.error('[orderSync] No se pudo iniciar el listener', err)
  }
}

export function stopOrderSyncListener(): void {
  for (const unsub of listeners) {
    try { unsub() } catch (err) {
      log.warn('[orderSync] Error al detener listener', err)
    }
  }
  listeners.length = 0
  log.info('[orderSync] Listener detenido')
}

export async function ensureOrdersSynced(tenantId: string): Promise<void> {
  await pushUnsyncedOrders(tenantId)
  await pullOrdersFromFirestore(tenantId)
  startOrderSyncListener(tenantId)
}
