/**
 * Sync de clientes especiales + precios con Firestore.
 * Paths:
 *   licenses/{tenant}/specialCustomers/{id}
 *   licenses/{tenant}/specialCustomerPrices/{id}
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
import { specialCustomers, specialCustomerPrices, products } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { ensureUserStub, existingStoreIdOrNull } from './syncUserStub'
import { notifyRenderer } from './notifyRenderer'
import { IPC } from '../ipc/channels'

interface RemoteSpecialCustomerDoc {
  id: string
  storeId?: string | null
  name: string
  notes?: string | null
  createdAt?: string
  createdBy?: string
  updatedAt?: string | null
  updatedBy?: string | null
  deleted?: boolean
}

interface RemoteSpecialPriceDoc {
  id: string
  specialCustomerId: string
  productId: string
  price?: number
  specialPrice?: number
  notes?: string | null
  updatedAt?: string
  updatedBy?: string
  deleted?: boolean
}

const customerListeners: Unsubscribe[] = []
const priceListeners: Unsubscribe[] = []

const MAX_PENDING_PRICES = 500
const pendingSpecialPrices = new Map<string, { data: RemoteSpecialPriceDoc; docId: string }>()

function notifySpecialCustomersUpdated(): void {
  notifyRenderer(IPC.SPECIAL_CUSTOMER_SYNC_UPDATED)
}

function upsertSpecialCustomerFromRemote(data: RemoteSpecialCustomerDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId
  const createdBy = data.createdBy || 'remote-special-unknown'
  const createdAt = data.createdAt || now

  if (data.deleted) {
    db.delete(specialCustomerPrices).where(eq(specialCustomerPrices.specialCustomerId, id)).run()
    db.delete(specialCustomers).where(eq(specialCustomers.id, id)).run()
    return
  }

  if (!data.name) {
    log.warn('[specialCustomerSync] Cliente especial sin nombre — omitido', { id })
    return
  }

  const storeId = existingStoreIdOrNull(data.storeId)
  ensureUserStub(createdBy, storeId)
  if (data.updatedBy) ensureUserStub(data.updatedBy, storeId)

  db.insert(specialCustomers)
    .values({
      id,
      storeId,
      name: data.name,
      notes: data.notes ?? null,
      createdAt,
      createdBy,
      updatedAt: data.updatedAt ?? null,
      updatedBy: data.updatedBy ?? null,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: specialCustomers.id,
      set: {
        storeId,
        name: data.name,
        notes: data.notes ?? null,
        updatedAt: data.updatedAt ?? null,
        updatedBy: data.updatedBy ?? null,
        syncedAt: now,
      },
    })
    .run()

  retryPendingSpecialPrices()
  notifySpecialCustomersUpdated()
}

function queuePendingSpecialPrice(data: RemoteSpecialPriceDoc, docId: string): void {
  if (pendingSpecialPrices.size >= MAX_PENDING_PRICES && !pendingSpecialPrices.has(docId)) {
    const oldest = pendingSpecialPrices.keys().next().value
    if (oldest) pendingSpecialPrices.delete(oldest)
  }
  pendingSpecialPrices.set(docId, { data, docId })
}

function retryPendingSpecialPrices(): void {
  for (const [id, item] of [...pendingSpecialPrices.entries()]) {
    if (upsertSpecialPriceFromRemote(item.data, item.docId, false)) {
      pendingSpecialPrices.delete(id)
    }
  }
}

function upsertSpecialPriceFromRemote(
  data: RemoteSpecialPriceDoc,
  docId: string,
  enqueueIfOrphan = true,
): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId

  if (data.deleted) {
    db.delete(specialCustomerPrices).where(eq(specialCustomerPrices.id, id)).run()
    pendingSpecialPrices.delete(id)
    notifySpecialCustomersUpdated()
    return true
  }

  const parent = db.select({ id: specialCustomers.id })
    .from(specialCustomers)
    .where(eq(specialCustomers.id, data.specialCustomerId))
    .all()[0]
  if (!parent) {
    log.warn('[specialCustomerSync] Precio sin cliente especial local — en cola', {
      id,
      specialCustomerId: data.specialCustomerId,
    })
    if (enqueueIfOrphan) queuePendingSpecialPrice(data, docId)
    return false
  }

  const product = db.select({ id: products.id }).from(products).where(eq(products.id, data.productId)).all()[0]
  if (!product) {
    log.warn('[specialCustomerSync] Precio sin producto local — en cola', { id, productId: data.productId })
    if (enqueueIfOrphan) queuePendingSpecialPrice(data, docId)
    return false
  }

  const price = data.price ?? data.specialPrice ?? 0
  const updatedAt = data.updatedAt || now
  const updatedBy = data.updatedBy || 'remote-special-unknown'
  ensureUserStub(updatedBy)

  db.insert(specialCustomerPrices)
    .values({
      id,
      specialCustomerId: data.specialCustomerId,
      productId: data.productId,
      price,
      notes: data.notes ?? null,
      updatedAt,
      updatedBy,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: specialCustomerPrices.id,
      set: {
        specialCustomerId: data.specialCustomerId,
        productId: data.productId,
        price,
        notes: data.notes ?? null,
        updatedAt,
        updatedBy,
        syncedAt: now,
      },
    })
    .run()

  notifySpecialCustomersUpdated()
  return true
}

export async function pushUnsyncedSpecialCustomers(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(specialCustomers).where(isNull(specialCustomers.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'specialCustomers', row.id)
      await setDoc(ref, {
        id: row.id,
        storeId: row.storeId ?? null,
        name: row.name,
        notes: row.notes ?? null,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        updatedAt: row.updatedAt ?? null,
        updatedBy: row.updatedBy ?? null,
        deleted: false,
      }, { merge: true })

      db.update(specialCustomers).set({ syncedAt: now }).where(eq(specialCustomers.id, row.id)).run()
    } catch (err) {
      log.error('[specialCustomerSync] Error al pushear special customer', { id: row.id, err })
    }
  }

  log.info('[specialCustomerSync] Special customers pusheados', { count: pending.length })
}

export async function pushUnsyncedSpecialCustomerPrices(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(specialCustomerPrices).where(isNull(specialCustomerPrices.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'specialCustomerPrices', row.id)
      await setDoc(ref, {
        id: row.id,
        specialCustomerId: row.specialCustomerId,
        productId: row.productId,
        price: row.price,
        notes: row.notes ?? null,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        deleted: false,
      }, { merge: true })

      db.update(specialCustomerPrices).set({ syncedAt: now }).where(eq(specialCustomerPrices.id, row.id)).run()
    } catch (err) {
      log.error('[specialCustomerSync] Error al pushear precio especial', { id: row.id, err })
    }
  }

  log.info('[specialCustomerSync] Special customer prices pusheados', { count: pending.length })
}

export async function markSpecialCustomerDeletedInFirestore(tenantId: string, id: string): Promise<void> {
  if (!isFirebaseAvailable()) return
  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const now = new Date().toISOString()
    await setDoc(
      doc(firestore, 'licenses', tenantId, 'specialCustomers', id),
      { deleted: true, deletedAt: now },
      { merge: true },
    )
  } catch (err) {
    log.error('[specialCustomerSync] Error al marcar special customer eliminado', { id, err })
  }
}

export async function markSpecialCustomerPriceDeletedInFirestore(tenantId: string, id: string): Promise<void> {
  if (!isFirebaseAvailable()) return
  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    await setDoc(
      doc(firestore, 'licenses', tenantId, 'specialCustomerPrices', id),
      { deleted: true, deletedAt: new Date().toISOString() },
      { merge: true },
    )
  } catch (err) {
    log.error('[specialCustomerSync] Error al marcar precio especial eliminado', { id, err })
  }
}

export async function pullSpecialCustomersFromFirestore(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'specialCustomers')
    const snap = await getDocs(col)

    for (const d of snap.docs) {
      try {
        upsertSpecialCustomerFromRemote(d.data() as RemoteSpecialCustomerDoc, d.id)
      } catch (err) {
        log.error('[specialCustomerSync] Error pull special customer', { id: d.id, err })
      }
    }

    log.info('[specialCustomerSync] Special customers bajados', { count: snap.size })
  } catch (err) {
    log.error('[specialCustomerSync] Error en pullSpecialCustomersFromFirestore', err)
  }
}

export async function pullSpecialCustomerPricesFromFirestore(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'specialCustomerPrices')
    const snap = await getDocs(col)

    for (const d of snap.docs) {
      try {
        upsertSpecialPriceFromRemote(d.data() as RemoteSpecialPriceDoc, d.id)
      } catch (err) {
        log.error('[specialCustomerSync] Error pull precio especial', { id: d.id, err })
      }
    }

    log.info('[specialCustomerSync] Special customer prices bajados', { count: snap.size })
  } catch (err) {
    log.error('[specialCustomerSync] Error en pullSpecialCustomerPricesFromFirestore', err)
  }
}

export function startSpecialCustomerSyncListener(tenantId: string): void {
  if (!isFirebaseAvailable()) return
  if (customerListeners.length > 0 || priceListeners.length > 0) {
    log.info('[specialCustomerSync] Listeners ya activos — omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)

    const customersCol = collection(firestore, 'licenses', tenantId, 'specialCustomers')
    const unsubCustomers = onSnapshot(customersCol, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          upsertSpecialCustomerFromRemote(change.doc.data() as RemoteSpecialCustomerDoc, change.doc.id)
        } catch (err) {
          log.error('[specialCustomerSync] Error snapshot customer', { id: change.doc.id, err })
        }
      }
    }, err => log.error('[specialCustomerSync] Error listener customers', err))

    const pricesCol = collection(firestore, 'licenses', tenantId, 'specialCustomerPrices')
    const unsubPrices = onSnapshot(pricesCol, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          upsertSpecialPriceFromRemote(change.doc.data() as RemoteSpecialPriceDoc, change.doc.id)
        } catch (err) {
          log.error('[specialCustomerSync] Error snapshot price', { id: change.doc.id, err })
        }
      }
    }, err => log.error('[specialCustomerSync] Error listener prices', err))

    customerListeners.push(unsubCustomers)
    priceListeners.push(unsubPrices)
    log.info('[specialCustomerSync] Listeners iniciados')
  } catch (err) {
    log.error('[specialCustomerSync] No se pudieron iniciar listeners', err)
  }
}

export function stopSpecialCustomerSyncListener(): void {
  for (const unsub of [...customerListeners, ...priceListeners]) {
    try { unsub() } catch (err) {
      log.warn('[specialCustomerSync] Error al detener listener', err)
    }
  }
  customerListeners.length = 0
  priceListeners.length = 0
  pendingSpecialPrices.clear()
  log.info('[specialCustomerSync] Listeners detenidos')
}

export async function ensureSpecialCustomersSynced(tenantId: string): Promise<void> {
  await pushUnsyncedSpecialCustomers(tenantId)
  await pushUnsyncedSpecialCustomerPrices(tenantId)
  await pullSpecialCustomersFromFirestore(tenantId)
  await pullSpecialCustomerPricesFromFirestore(tenantId)
  retryPendingSpecialPrices()
  startSpecialCustomerSyncListener(tenantId)
  notifySpecialCustomersUpdated()
}

export async function pushUnsyncedSpecialCustomerOps(tenantId: string): Promise<void> {
  await pushUnsyncedSpecialCustomers(tenantId)
  await pushUnsyncedSpecialCustomerPrices(tenantId)
}
