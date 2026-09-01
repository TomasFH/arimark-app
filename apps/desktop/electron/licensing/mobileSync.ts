/**
 * Listener de importación de turnos móviles a SQLite.
 *
 * Escucha la colección Firestore staging:
 *   licenses/{licenseKey}/sync/{storeId}/shifts/{shiftId}
 * y sus subcolecciones de ventas y gastos.
 *
 * Un turno abierto se deja con importedAt=null para que los hijos posteriores
 * (ventas, gastos, anulaciones) se importen cuando el celu actualiza el doc.
 * Recién al cerrar se marca importedAt.
 *
 * Los turnos importados tienen source='mobile' y NO interactúan con
 * la lógica de turno activo del desktop (DT-06).
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
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedShifts } from './shiftSync'
import { pushUnsyncedSales } from './saleSync'
import { pushUnsyncedExpenses } from './expenseSync'
import { pushUnsyncedVales, pushUnsyncedSalaryPayments } from './employeeSync'
import { pushUnsyncedProviders, pushUnsyncedDebtEvents } from './providerSync'
import {
  applyMobileShiftImport,
  type MobileExpenseImport,
  type MobileSaleImport,
  type MobileSalaryImport,
  type MobileShiftImport,
  type MobileValeImport,
} from './mobileSyncImport'

interface MobileShift extends MobileShiftImport {
  importedAt: Timestamp | string | null
}

interface MobileSale extends MobileSaleImport {
  importedAt?: Timestamp | string | null
}

interface MobileExpense extends MobileExpenseImport {
  importedAt?: Timestamp | string | null
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

    // Turnos aún no cerrados-e-importados. Los abiertos quedan acá a propósito.
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

  const salesCol = collection(
    firestore,
    'licenses', licenseKey,
    'sync', storeId,
    'shifts', shiftData.id,
    'sales'
  )
  const expensesCol = collection(
    firestore,
    'licenses', licenseKey,
    'sync', storeId,
    'shifts', shiftData.id,
    'expenses'
  )
  const valesCol = collection(
    firestore,
    'licenses', licenseKey,
    'sync', storeId,
    'shifts', shiftData.id,
    'vales'
  )
  const salaryCol = collection(
    firestore,
    'licenses', licenseKey,
    'sync', storeId,
    'shifts', shiftData.id,
    'salaryPayments'
  )

  const [salesSnap, expensesSnap, valesSnap, salarySnap] = await Promise.all([
    getDocs(salesCol),
    getDocs(expensesCol),
    getDocs(valesCol),
    getDocs(salaryCol),
  ])
  const salesData: MobileSale[] = salesSnap.docs.map(d => d.data() as MobileSale)
  const expensesData: MobileExpense[] = expensesSnap.docs.map(d => d.data() as MobileExpense)
  const valesData: MobileValeImport[] = valesSnap.docs.map(d => d.data() as MobileValeImport)
  const salaryData: MobileSalaryImport[] = salarySnap.docs.map(d => d.data() as MobileSalaryImport)

  const shiftImport: MobileShiftImport = {
    id: shiftData.id,
    storeId: shiftData.storeId ?? storeId,
    userId: shiftData.userId,
    displayName: shiftData.displayName,
    shiftType: shiftData.shiftType,
    startedAt: shiftData.startedAt,
    closedAt: shiftData.closedAt,
    openingCash: shiftData.openingCash,
    closingCash: shiftData.closingCash,
  }

  const result = applyMobileShiftImport(
    db,
    storeId,
    shiftImport,
    salesData,
    expensesData,
    valesData,
    salaryData,
  )

  log.info('[mobileSync] Turno procesado', {
    shiftId: shiftData.id,
    insertedShift: result.insertedShift,
    salesInserted: result.salesInserted,
    salesCancelled: result.salesCancelled,
    expensesInserted: result.expensesInserted,
    valesInserted: result.valesInserted,
    salaryInserted: result.salaryInserted,
    shouldMarkImported: result.shouldMarkImported,
  })

  if (result.shouldMarkImported) {
    await markShiftImported(licenseKey, storeId, shiftData.id, firestore)
  }

  try {
    const tenantId = getBusinessConfig().tenant_id
    await pushUnsyncedShifts(tenantId)
    await pushUnsyncedSales(tenantId)
    await pushUnsyncedExpenses(tenantId)
    await pushUnsyncedProviders(tenantId)
    await pushUnsyncedDebtEvents(tenantId)
    await pushUnsyncedVales(tenantId)
    await pushUnsyncedSalaryPayments(tenantId)
  } catch (err) {
    log.warn('[mobileSync] push operativo post-import falló (no bloqueante)', err)
  }
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
