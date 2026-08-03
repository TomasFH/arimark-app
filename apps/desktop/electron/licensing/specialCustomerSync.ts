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
import { ensureUserStub } from './syncUserStub'

interface RemoteSpecialCustomerDoc {
  id: string
  storeId?: string | null
  name: string
  notes?: string | null
  createdAt: string
  createdBy: string
  updatedAt?: string | null
  updatedBy?: string | null
  deleted?: boolean
}

interface RemoteSpecialPriceDoc {
  id: string
  specialCustomerId: string
  productId: string
  price: number
  notes?: string | null
  updatedAt: string
  updatedBy: string
  deleted?: boolean
}

const customerListeners: Unsubscribe[] = []
const priceListeners: Unsubscribe[] = []

function upsertSpecialCustomerFromRemote(data: RemoteSpecialCustomerDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId
  const fallbackStore = data.storeId || '00000000-0000-0000-0000-000000000001'

  if (data.deleted) {
    db.delete(specialCustomerPrices).where(eq(specialCustomerPrices.specialCustomerId, id)).run()
    db.delete(specialCustomers).where(eq(specialCustomers.id, id)).run()
    return
  }

  ensureUserStub(data.createdBy, fallbackStore)
  if (data.updatedBy) ensureUserStub(data.updatedBy, fallbackStore)

  db.insert(specialCustomers)
    .values({
      id,
      storeId: data.storeId ?? null,
      name: data.name,
      notes: data.notes ?? null,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
      updatedAt: data.updatedAt ?? null,
      updatedBy: data.updatedBy ?? null,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: specialCustomers.id,
      set: {
        storeId: data.storeId ?? null,
        name: data.name,
        notes: data.notes ?? null,
        updatedAt: data.updatedAt ?? null,
        updatedBy: data.updatedBy ?? null,
        syncedAt: now,
      },
    })
    .run()
}

function upsertSpecialPriceFromRemote(data: RemoteSpecialPriceDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId

  if (data.deleted) {
    db.delete(specialCustomerPrices).where(eq(specialCustomerPrices.id, id)).run()
    return
  }

  const parent = db.select({ id: specialCustomers.id })
    .from(specialCustomers)
    .where(eq(specialCustomers.id, data.specialCustomerId))
    .all()[0]
  if (!parent) {
    log.warn('[specialCustomerSync] Precio sin cliente especial local — omitido', {
      id,
      specialCustomerId: data.specialCustomerId,
    })
    return
  }

  const product = db.select({ id: products.id }).from(products).where(eq(products.id, data.productId)).all()[0]
  if (!product) {
    log.warn('[specialCustomerSync] Precio sin producto local — omitido', { id, productId: data.productId })
    return
  }

  ensureUserStub(data.updatedBy, '00000000-0000-0000-0000-000000000001')

  db.insert(specialCustomerPrices)
    .values({
      id,
      specialCustomerId: data.specialCustomerId,
      productId: data.productId,
      price: data.price,
      notes: data.notes ?? null,
      updatedAt: data.updatedAt,
      updatedBy: data.updatedBy,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: specialCustomerPrices.id,
      set: {
        specialCustomerId: data.specialCustomerId,
        productId: data.productId,
        price: data.price,
        notes: data.notes ?? null,
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
        syncedAt: now,
      },
    })
    .run()
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
  log.info('[specialCustomerSync] Listeners detenidos')
}

export async function ensureSpecialCustomersSynced(tenantId: string): Promise<void> {
  await pushUnsyncedSpecialCustomers(tenantId)
  await pushUnsyncedSpecialCustomerPrices(tenantId)
  await pullSpecialCustomersFromFirestore(tenantId)
  await pullSpecialCustomerPricesFromFirestore(tenantId)
  startSpecialCustomerSyncListener(tenantId)
}

export async function pushUnsyncedSpecialCustomerOps(tenantId: string): Promise<void> {
  await pushUnsyncedSpecialCustomers(tenantId)
  await pushUnsyncedSpecialCustomerPrices(tenantId)
}
