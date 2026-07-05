/**
 * Motor de sincronización idempotente: celular → Firestore staging.
 *
 * Sube los turnos y ventas con syncStatus='pending' a:
 *   licenses/{licenseKey}/sync/{storeId}/shifts/{shiftId}
 *   licenses/{licenseKey}/sync/{storeId}/shifts/{shiftId}/sales/{saleId}
 *
 * Los IDs son UUIDs generados en el celular → los reintentos son seguros
 * (setDoc con merge:false sobrescribe solo si el doc no existe; el listener
 * en la PC ya marca imported).
 *
 * Disparo automático:
 *  - Al recuperar conexión (navigator.onLine / 'online' event)
 *  - Al confirmar una venta (llamado desde PosScreen)
 *  - Al abrir la app
 */
import {
  getFirestore,
  doc,
  setDoc,
  collection,
} from 'firebase/firestore'
import { firebaseApp, auth, LICENSE_KEY } from '../firebase'
import { db } from './db'
import { isOnline, onConnectivityChange } from './connectivity'
import type { LocalShift, LocalSale } from '../types/pos'

const firestore = getFirestore(firebaseApp)

let syncInProgress = false

/**
 * Intenta sincronizar todos los items pendientes.
 * Es seguro llamarla en paralelo — la segunda llamada regresa inmediatamente.
 */
export async function triggerSync(): Promise<void> {
  if (syncInProgress) return
  if (!(await isOnline())) return

  if (!auth.currentUser) return

  syncInProgress = true
  try {
    await syncPendingShifts()
  } finally {
    syncInProgress = false
  }
}

async function syncPendingShifts(): Promise<void> {
  const pendingShifts = await db.shifts
    .where('syncStatus')
    .anyOf(['pending', 'error'])
    .toArray()

  for (const shift of pendingShifts) {
    try {
      await uploadShift(shift)
    } catch {
      await db.shifts.update(shift.id, { syncStatus: 'error' })
    }
  }
}

async function uploadShift(shift: LocalShift): Promise<void> {
  const shiftRef = doc(
    firestore,
    'licenses', LICENSE_KEY,
    'sync', shift.storeId,
    'shifts', shift.id
  )

  await setDoc(shiftRef, {
    id: shift.id,
    storeId: shift.storeId,
    userId: shift.userId,
    displayName: shift.displayName,
    shiftType: shift.shiftType,
    startedAt: shift.startedAt,
    closedAt: shift.closedAt,
    openingCash: shift.openingCash,
    closingCash: shift.closingCash,
    source: 'mobile',
    importedAt: null,
  })

  // Ventas de este turno con estado pending/error.
  const pendingSales = await db.sales
    .where('shiftId')
    .equals(shift.id)
    .filter(s => s.syncStatus === 'pending' || s.syncStatus === 'error')
    .toArray()

  for (const sale of pendingSales) {
    try {
      await uploadSale(shift.storeId, shift.id, sale)
      await db.sales.update(sale.id, {
        syncStatus: 'synced',
        syncedAt: new Date().toISOString(),
      })
    } catch {
      await db.sales.update(sale.id, { syncStatus: 'error' })
    }
  }

  await db.shifts.update(shift.id, {
    syncStatus: 'synced',
    syncedAt: new Date().toISOString(),
  })
}

async function uploadSale(storeId: string, shiftId: string, sale: LocalSale): Promise<void> {
  const salesCol = collection(
    firestore,
    'licenses', LICENSE_KEY,
    'sync', storeId,
    'shifts', shiftId,
    'sales'
  )
  const saleRef = doc(salesCol, sale.id)

  await setDoc(saleRef, {
    id: sale.id,
    shiftId: sale.shiftId,
    total: sale.total,
    items: sale.items,
    payments: sale.payments,
    notes: sale.notes,
    manualEntry: sale.manualEntry,
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
    importedAt: null,
  })
}

/** Registra el listener para disparar sync al recuperar la conexión. */
export function registerOnlineListener(): void {
  onConnectivityChange((online) => {
    if (online) {
      triggerSync().catch(() => { /* silencioso */ })
    }
  })
}
