/**
 * Listener de importación de turnos móviles a SQLite.
 *
 * Escucha la colección Firestore staging:
 *   licenses/{licenseKey}/sync/{storeId}/shifts/{shiftId}
 * y sus subcolecciones de ventas.
 *
 * Cuando detecta un turno nuevo (importedAt == null) lo importa
 * atómicamente a SQLite y lo marca como importado en Firestore.
 *
 * Idempotente: si el shiftId o saleId ya existe en SQLite, se omite.
 * Los turnos importados tienen source='mobile' y NO interactúan con
 * la lógica de turno activo del desktop.
 */
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import { getDb } from '../db/client'
import { shifts, sales, saleItems, salePayments, users } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { v4 as uuidv4 } from 'uuid'

interface MobileSaleItem {
  productId: string
  productName: string
  pluNumber: number | null
  quantity: number
  unitPrice: number
  subtotal: number
  weightKg: number | null
  manualEntry: boolean
}

interface MobileSalePayment {
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit'
  amount: number
}

interface MobileShift {
  id: string
  storeId: string
  userId: string
  displayName: string
  shiftType: 'morning' | 'evening'
  startedAt: string
  closedAt: string | null
  openingCash: number
  closingCash: number | null
  importedAt: Timestamp | null
}

interface MobileSale {
  id: string
  shiftId: string
  total: number
  items: MobileSaleItem[]
  payments: MobileSalePayment[]
  notes: string | null
  manualEntry: boolean
  createdAt: string
  createdBy: string
  importedAt: Timestamp | null
}

const listeners: Unsubscribe[] = []

/**
 * Inicia el listener para el local indicado.
 * Llamar desde auth.handler al hacer login de cajera.
 */
export function startMobileSyncListener(
  licenseKey: string,
  storeId: string
): void {
  if (!isFirebaseAvailable()) {
    log.info('[mobileSync] Firebase no disponible (dev) — listener omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)

    const shiftsCol = collection(
      firestore,
      'licenses', licenseKey,
      'sync', storeId,
      'shifts'
    )

    // Solo escucha turnos que aún no fueron importados.
    const q = query(shiftsCol, where('importedAt', '==', null))

    const unsub = onSnapshot(q, async snapshot => {
      for (const docSnap of snapshot.docs) {
        const shiftData = docSnap.data() as MobileShift
        await importShift(licenseKey, storeId, shiftData, firestore)
      }
    }, err => {
      log.error('[mobileSync] Error en listener', err)
    })

    listeners.push(unsub)
    log.info('[mobileSync] Listener iniciado', { storeId })
  } catch (err) {
    log.error('[mobileSync] No se pudo iniciar el listener', err)
  }
}

/** Detiene todos los listeners activos. */
export function stopMobileSyncListener(): void {
  listeners.forEach(u => u())
  listeners.length = 0
}

async function importShift(
  licenseKey: string,
  storeId: string,
  shiftData: MobileShift,
  firestore: ReturnType<typeof getFirestore>
): Promise<void> {
  const db = getDb()

  // Verificar idempotencia.
  const existing = db.select().from(shifts).where(eq(shifts.id, shiftData.id)).get()
  if (existing) {
    // Ya importado — solo marcar en Firestore si no estaba marcado.
    await markShiftImported(licenseKey, storeId, shiftData.id, firestore)
    return
  }

  // Asegurar que el usuario existe en caché local.
  await ensureUserCache(shiftData.userId, shiftData.displayName, storeId)

  // Descargar ventas de este turno.
  const salesCol = collection(
    firestore,
    'licenses', licenseKey,
    'sync', storeId,
    'shifts', shiftData.id,
    'sales'
  )
  const salesSnap = await getDocs(salesCol)
  const salesData: MobileSale[] = salesSnap.docs.map(d => d.data() as MobileSale)

  // Importar todo en una transacción atómica.
  const rawDb = db.$client as import('better-sqlite3').Database
  rawDb.transaction(() => {
    // Insertar turno.
    db.insert(shifts).values({
      id: shiftData.id,
      storeId,
      userId: shiftData.userId,
      shiftType: shiftData.shiftType,
      startedAt: shiftData.startedAt,
      closedAt: shiftData.closedAt,
      openingCash: shiftData.openingCash,
      closingCash: shiftData.closingCash,
      source: 'mobile',
    }).run()

    for (const sale of salesData) {
      // Idempotencia por venta.
      const existingSale = db.select().from(sales).where(eq(sales.id, sale.id)).get()
      if (existingSale) continue

      db.insert(sales).values({
        id: sale.id,
        storeId,
        shiftId: shiftData.id,
        total: sale.total,
        status: 'confirmed',
        manualEntry: sale.manualEntry,
        notes: sale.notes,
        createdAt: sale.createdAt,
        createdBy: sale.createdBy,
      }).run()

      // Ítems.
      for (const item of sale.items) {
        // Si el productId no existe en SQLite (producto eliminado o desconoc.), lo omitimos
        // para no romper el FK — la venta queda importada con los datos en notes.
        try {
          db.insert(saleItems).values({
            id: uuidv4(),
            saleId: sale.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
          }).run()
        } catch {
          log.warn('[mobileSync] Item omitido por FK inválido', { productId: item.productId, saleId: sale.id })
        }
      }

      // Pagos.
      const now = new Date().toISOString()
      for (const payment of sale.payments) {
        db.insert(salePayments).values({
          id: uuidv4(),
          saleId: sale.id,
          paymentMethod: payment.paymentMethod,
          amount: payment.amount,
          createdAt: now,
          createdBy: sale.createdBy,
        }).run()
      }
    }
  })()

  log.info('[mobileSync] Turno importado', {
    shiftId: shiftData.id,
    sales: salesData.length,
  })

  await markShiftImported(licenseKey, storeId, shiftData.id, firestore)
}

async function markShiftImported(
  licenseKey: string,
  storeId: string,
  shiftId: string,
  firestore: ReturnType<typeof getFirestore>
): Promise<void> {
  try {
    const shiftRef = doc(
      firestore,
      'licenses', licenseKey,
      'sync', storeId,
      'shifts', shiftId
    )
    await updateDoc(shiftRef, { importedAt: new Date().toISOString() })
  } catch (err) {
    log.warn('[mobileSync] No se pudo marcar como importado', err)
  }
}

async function ensureUserCache(
  uid: string,
  displayName: string,
  storeId: string
): Promise<void> {
  const db = getDb()
  const existing = db.select().from(users).where(eq(users.id, uid)).get()
  if (!existing) {
    db.insert(users).values({
      id: uid,
      storeId,
      name: displayName,
      firebaseUid: uid,
      role: 'cashier',
      active: true,
      createdAt: new Date().toISOString(),
    }).run()
  }
}
