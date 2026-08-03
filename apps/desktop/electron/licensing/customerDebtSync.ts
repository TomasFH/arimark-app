/**
 * Sync de clientes de fiado + ledger debt_events con Firestore.
 * Paths:
 *   licenses/{tenant}/customers/{id}
 *   licenses/{tenant}/customerDebtEvents/{id}
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
import { customers, debtEvents, sales } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { ensureUserStub } from './syncUserStub'

interface RemoteCustomerDoc {
  id: string
  storeId: string
  name: string
  dni?: string | null
  phone?: string | null
  type?: 'restaurant' | 'wholesale' | 'other' | null
  notes?: string | null
  active?: boolean
  createdAt: string
  createdBy: string
  deleted?: boolean
}

interface RemoteDebtEventDoc {
  id: string
  customerId: string
  saleId?: string | null
  storeId: string
  eventType: 'created' | 'partial_payment' | 'paid' | 'cancelled' | 'reopened'
  amount: number
  dueDate?: string | null
  notes?: string | null
  createdAt: string
  createdBy: string
  deleted?: boolean
}

const customerListeners: Unsubscribe[] = []
const debtListeners: Unsubscribe[] = []

function upsertCustomerFromRemote(data: RemoteCustomerDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId

  if (data.deleted) {
    // No hard-delete si hay eventos locales; marcar inactivo
    db.update(customers).set({ active: false, syncedAt: now }).where(eq(customers.id, id)).run()
    return
  }

  ensureUserStub(data.createdBy, data.storeId)

  db.insert(customers)
    .values({
      id,
      storeId: data.storeId,
      name: data.name,
      dni: data.dni ?? null,
      phone: data.phone ?? null,
      type: data.type ?? null,
      notes: data.notes ?? null,
      active: data.active ?? true,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: customers.id,
      set: {
        storeId: data.storeId,
        name: data.name,
        dni: data.dni ?? null,
        phone: data.phone ?? null,
        type: data.type ?? null,
        notes: data.notes ?? null,
        active: data.active ?? true,
        syncedAt: now,
      },
    })
    .run()
}

function upsertDebtEventFromRemote(data: RemoteDebtEventDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId

  if (data.deleted) {
    db.delete(debtEvents).where(eq(debtEvents.id, id)).run()
    return
  }

  // Requiere el cliente en cache
  const customer = db.select({ id: customers.id }).from(customers).where(eq(customers.id, data.customerId)).all()[0]
  if (!customer) {
    log.warn('[customerDebtSync] Debt event sin cliente local — omitido', { id, customerId: data.customerId })
    return
  }

  ensureUserStub(data.createdBy, data.storeId)

  let saleId: string | null = data.saleId ?? null
  if (saleId) {
    const sale = db.select({ id: sales.id }).from(sales).where(eq(sales.id, saleId)).all()[0]
    if (!sale) saleId = null
  }

  db.insert(debtEvents)
    .values({
      id,
      customerId: data.customerId,
      saleId,
      storeId: data.storeId,
      eventType: data.eventType,
      amount: data.amount,
      dueDate: data.dueDate ?? null,
      notes: data.notes ?? null,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: debtEvents.id,
      set: {
        customerId: data.customerId,
        saleId,
        storeId: data.storeId,
        eventType: data.eventType,
        amount: data.amount,
        dueDate: data.dueDate ?? null,
        notes: data.notes ?? null,
        syncedAt: now,
      },
    })
    .run()
}

export async function pushUnsyncedCustomers(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(customers).where(isNull(customers.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'customers', row.id)
      await setDoc(ref, {
        id: row.id,
        storeId: row.storeId,
        name: row.name,
        dni: row.dni ?? null,
        phone: row.phone ?? null,
        type: row.type ?? null,
        notes: row.notes ?? null,
        active: row.active,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        deleted: false,
      }, { merge: true })

      db.update(customers).set({ syncedAt: now }).where(eq(customers.id, row.id)).run()
    } catch (err) {
      log.error('[customerDebtSync] Error al pushear customer', { id: row.id, err })
    }
  }

  log.info('[customerDebtSync] Customers pusheados', { count: pending.length })
}

export async function pushUnsyncedCustomerDebtEvents(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(debtEvents).where(isNull(debtEvents.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'customerDebtEvents', row.id)
      await setDoc(ref, {
        id: row.id,
        customerId: row.customerId,
        saleId: row.saleId ?? null,
        storeId: row.storeId,
        eventType: row.eventType,
        amount: row.amount,
        dueDate: row.dueDate ?? null,
        notes: row.notes ?? null,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        deleted: false,
      }, { merge: true })

      db.update(debtEvents).set({ syncedAt: now }).where(eq(debtEvents.id, row.id)).run()
    } catch (err) {
      log.error('[customerDebtSync] Error al pushear debt event', { id: row.id, err })
    }
  }

  log.info('[customerDebtSync] Customer debt events pusheados', { count: pending.length })
}

export async function pullCustomersFromFirestore(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'customers')
    const snap = await getDocs(col)

    for (const d of snap.docs) {
      try {
        upsertCustomerFromRemote(d.data() as RemoteCustomerDoc, d.id)
      } catch (err) {
        log.error('[customerDebtSync] Error al upsertear customer en pull', { id: d.id, err })
      }
    }

    log.info('[customerDebtSync] Customers bajados', { count: snap.size })
  } catch (err) {
    log.error('[customerDebtSync] Error en pullCustomersFromFirestore', err)
  }
}

export async function pullCustomerDebtEventsFromFirestore(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'customerDebtEvents')
    const snap = await getDocs(col)

    for (const d of snap.docs) {
      try {
        upsertDebtEventFromRemote(d.data() as RemoteDebtEventDoc, d.id)
      } catch (err) {
        log.error('[customerDebtSync] Error al upsertear debt event en pull', { id: d.id, err })
      }
    }

    log.info('[customerDebtSync] Customer debt events bajados', { count: snap.size })
  } catch (err) {
    log.error('[customerDebtSync] Error en pullCustomerDebtEventsFromFirestore', err)
  }
}

export function startCustomerDebtSyncListener(tenantId: string): void {
  if (!isFirebaseAvailable()) return
  if (customerListeners.length > 0 || debtListeners.length > 0) {
    log.info('[customerDebtSync] Listeners ya activos — omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)

    const customersCol = collection(firestore, 'licenses', tenantId, 'customers')
    const unsubCustomers = onSnapshot(customersCol, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          upsertCustomerFromRemote(change.doc.data() as RemoteCustomerDoc, change.doc.id)
        } catch (err) {
          log.error('[customerDebtSync] Error snapshot customer', { id: change.doc.id, err })
        }
      }
    }, err => log.error('[customerDebtSync] Error listener customers', err))

    const debtsCol = collection(firestore, 'licenses', tenantId, 'customerDebtEvents')
    const unsubDebts = onSnapshot(debtsCol, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          upsertDebtEventFromRemote(change.doc.data() as RemoteDebtEventDoc, change.doc.id)
        } catch (err) {
          log.error('[customerDebtSync] Error snapshot debt event', { id: change.doc.id, err })
        }
      }
    }, err => log.error('[customerDebtSync] Error listener debt events', err))

    customerListeners.push(unsubCustomers)
    debtListeners.push(unsubDebts)
    log.info('[customerDebtSync] Listeners iniciados')
  } catch (err) {
    log.error('[customerDebtSync] No se pudieron iniciar listeners', err)
  }
}

export function stopCustomerDebtSyncListener(): void {
  for (const unsub of [...customerListeners, ...debtListeners]) {
    try { unsub() } catch (err) {
      log.warn('[customerDebtSync] Error al detener listener', err)
    }
  }
  customerListeners.length = 0
  debtListeners.length = 0
  log.info('[customerDebtSync] Listeners detenidos')
}

/** Push customers → push events → pull customers → pull events → listeners. */
export async function ensureCustomerDebtsSynced(tenantId: string): Promise<void> {
  await pushUnsyncedCustomers(tenantId)
  await pushUnsyncedCustomerDebtEvents(tenantId)
  await pullCustomersFromFirestore(tenantId)
  await pullCustomerDebtEventsFromFirestore(tenantId)
  startCustomerDebtSyncListener(tenantId)
}

export async function pushUnsyncedCustomerDebtOps(tenantId: string): Promise<void> {
  await pushUnsyncedCustomers(tenantId)
  await pushUnsyncedCustomerDebtEvents(tenantId)
}
