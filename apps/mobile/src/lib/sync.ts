/**
 * Motor de sincronización idempotente: celular → Firestore staging.
 *
 * Sube los turnos y ventas/gastos con syncStatus='pending'|'error' a:
 *   licenses/{licenseKey}/sync/{storeId}/shifts/{shiftId}
 *   licenses/{licenseKey}/sync/{storeId}/shifts/{shiftId}/sales/{saleId}
 *   licenses/{licenseKey}/sync/{storeId}/shifts/{shiftId}/expenses/{expenseId}
 *
 * También escribe copias operativas (historial admin / fiado / vales / sueldo):
 *   licenses/{licenseKey}/shifts/{id}
 *   licenses/{licenseKey}/sales/{id}
 *   licenses/{licenseKey}/expenses/{id}
 *   licenses/{licenseKey}/customers/{id}
 *   licenses/{licenseKey}/customerDebtEvents/{id}
 *   licenses/{licenseKey}/employeeVales/{id}
 *   licenses/{licenseKey}/salaryPayments/{id}
 *   licenses/{licenseKey}/providers/{id}
 *   licenses/{licenseKey}/providerDebtEvents/{id}
 *
 * Un turno ya marcado `synced` se vuelve a subir si tiene hijos pending/error
 * (ventas posteriores, gastos, anulaciones). En esos updates no se pisa
 * `importedAt` — solo el create inicial lo setea a null.
 *
 * Disparo automático:
 *  - Al recuperar conexión (navigator.onLine / 'online' event)
 *  - Al confirmar una venta / gasto (llamado desde PosScreen)
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
import {
  buildCustomerFirestorePayload,
  buildDebtEventFirestorePayload,
  buildExpenseOpsPayload,
  buildExpenseStagingPayload,
  buildProviderDebtEventOpsPayload,
  buildProviderOpsPayload,
  buildSalaryPaymentOpsPayload,
  buildSaleFirestorePayload,
  buildSaleOpsPayload,
  buildShiftFirestorePayload,
  buildShiftOpsPayload,
  buildValeOpsPayload,
  collectShiftIdsToSync,
  isInitialShiftUpload,
} from './syncPayloads'
import { providerNameKey } from './adminLedger'
import { debtEventServerTimestampFields, touchDebtCheckpointTail } from './debtCheckpointWrite'
import type { LocalExpense, LocalSale, LocalShift } from '../types/pos'

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
  const [statusShifts, pendingSales, pendingExpenses, pendingVales, pendingSalary] = await Promise.all([
    db.shifts.where('syncStatus').anyOf(['pending', 'error']).toArray(),
    db.sales.where('syncStatus').anyOf(['pending', 'error']).toArray(),
    db.expenses.where('syncStatus').anyOf(['pending', 'error']).toArray(),
    db.vales.where('syncStatus').anyOf(['pending', 'error']).toArray(),
    db.salaryPayments.where('syncStatus').anyOf(['pending', 'error']).toArray(),
  ])

  const shiftIds = collectShiftIdsToSync(
    statusShifts,
    pendingSales,
    pendingExpenses,
    [...pendingVales, ...pendingSalary],
  )
  const shiftsToUpload: LocalShift[] = []
  const seen = new Set<string>()

  for (const shift of statusShifts) {
    seen.add(shift.id)
    shiftsToUpload.push(shift)
  }

  for (const id of shiftIds) {
    if (seen.has(id)) continue
    const shift = await db.shifts.get(id)
    if (shift) {
      seen.add(id)
      shiftsToUpload.push(shift)
    }
  }

  for (const shift of shiftsToUpload) {
    try {
      await uploadShift(shift)
    } catch (err) {
      console.error('[sync] Error al subir turno', shift.id, err)
      await db.shifts.update(shift.id, { syncStatus: 'error' })
    }
  }
}

async function uploadShift(shift: LocalShift): Promise<void> {
  const shiftRef = doc(
    firestore,
    'licenses', LICENSE_KEY,
    'sync', shift.storeId,
    'shifts', shift.id,
  )

  const now = new Date().toISOString()
  const isCreate = isInitialShiftUpload(shift.syncedAt)
  await setDoc(shiftRef, buildShiftFirestorePayload(shift, now, isCreate), { merge: true })

  const opsShiftRef = doc(firestore, 'licenses', LICENSE_KEY, 'shifts', shift.id)
  await setDoc(opsShiftRef, buildShiftOpsPayload(shift, now), { merge: true })

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
    } catch (err) {
      console.error('[sync] Error al subir venta', sale.id, err)
      await db.sales.update(sale.id, { syncStatus: 'error' })
    }
  }

  const pendingExpenses = await db.expenses
    .where('shiftId')
    .equals(shift.id)
    .filter(e => e.syncStatus === 'pending' || e.syncStatus === 'error')
    .toArray()

  for (const expense of pendingExpenses) {
    try {
      await uploadExpense(shift.storeId, shift.id, expense)
      await db.expenses.update(expense.id, {
        syncStatus: 'synced',
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[sync] Error al subir gasto', expense.id, err)
      await db.expenses.update(expense.id, { syncStatus: 'error' })
    }
  }

  const pendingVales = await db.vales
    .where('shiftId')
    .equals(shift.id)
    .filter(v => v.syncStatus === 'pending' || v.syncStatus === 'error')
    .toArray()

  for (const vale of pendingVales) {
    try {
      await uploadVale(shift.storeId, shift.id, vale.id)
      await db.vales.update(vale.id, {
        syncStatus: 'synced',
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[sync] Error al subir vale', vale.id, err)
      await db.vales.update(vale.id, { syncStatus: 'error' })
    }
  }

  const pendingSalary = await db.salaryPayments
    .where('shiftId')
    .equals(shift.id)
    .filter(p => p.syncStatus === 'pending' || p.syncStatus === 'error')
    .toArray()

  for (const payment of pendingSalary) {
    try {
      await uploadSalaryPayment(shift.storeId, shift.id, payment.id)
      await db.salaryPayments.update(payment.id, {
        syncStatus: 'synced',
        syncedAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[sync] Error al subir liquidación', payment.id, err)
      await db.salaryPayments.update(payment.id, { syncStatus: 'error' })
    }
  }

  await db.shifts.update(shift.id, {
    syncStatus: 'synced',
    syncedAt: now,
  })
}

async function uploadSale(storeId: string, shiftId: string, sale: LocalSale): Promise<void> {
  const salesCol = collection(
    firestore,
    'licenses', LICENSE_KEY,
    'sync', storeId,
    'shifts', shiftId,
    'sales',
  )
  const saleRef = doc(salesCol, sale.id)
  await setDoc(saleRef, buildSaleFirestorePayload(sale), { merge: true })

  const opsSaleRef = doc(firestore, 'licenses', LICENSE_KEY, 'sales', sale.id)
  await setDoc(opsSaleRef, buildSaleOpsPayload(sale), { merge: true })

  if (sale.isDebt === true) {
    const customerPayload = buildCustomerFirestorePayload(sale)
    const debtPayload = buildDebtEventFirestorePayload(sale)
    if (customerPayload) {
      const customerRef = doc(firestore, 'licenses', LICENSE_KEY, 'customers', customerPayload.id)
      await setDoc(customerRef, customerPayload, { merge: true })
    }
    if (debtPayload) {
      const eventRef = doc(firestore, 'licenses', LICENSE_KEY, 'customerDebtEvents', debtPayload.id)
      await setDoc(eventRef, { ...debtPayload, ...debtEventServerTimestampFields() }, { merge: true })
      await touchDebtCheckpointTail({
        kind: 'customer',
        entityId: debtPayload.customerId,
        storeId: debtPayload.storeId,
      })
    }
  }
}

async function uploadExpense(storeId: string, shiftId: string, expense: LocalExpense): Promise<void> {
  if (expense.providerId && expense.providerName) {
    const providerRef = doc(firestore, 'licenses', LICENSE_KEY, 'providers', expense.providerId)
    await setDoc(providerRef, buildProviderOpsPayload({
      id: expense.providerId,
      name: expense.providerName,
      nameKey: providerNameKey(expense.providerName),
      createdAt: expense.createdAt,
      createdBy: expense.createdBy,
    }), { merge: true })
  }

  const expensesCol = collection(
    firestore,
    'licenses', LICENSE_KEY,
    'sync', storeId,
    'shifts', shiftId,
    'expenses',
  )
  const stagingRef = doc(expensesCol, expense.id)
  await setDoc(stagingRef, buildExpenseStagingPayload(expense), { merge: true })

  const opsRef = doc(firestore, 'licenses', LICENSE_KEY, 'expenses', expense.id)
  await setDoc(opsRef, buildExpenseOpsPayload(expense), { merge: true })

  const events = await db.providerDebtEvents
    .where('expenseId')
    .equals(expense.id)
    .filter(e => e.syncStatus === 'pending' || e.syncStatus === 'error')
    .toArray()

  for (const event of events) {
    const eventRef = doc(firestore, 'licenses', LICENSE_KEY, 'providerDebtEvents', event.id)
    await setDoc(eventRef, { ...buildProviderDebtEventOpsPayload(event), ...debtEventServerTimestampFields() }, { merge: true })
    await touchDebtCheckpointTail({
      kind: 'provider',
      entityId: event.providerId,
      storeId: event.storeId,
    })
    await db.providerDebtEvents.update(event.id, {
      syncStatus: 'synced',
      syncedAt: new Date().toISOString(),
    })
  }
}

async function uploadVale(storeId: string, shiftId: string, valeId: string): Promise<void> {
  const vale = await db.vales.get(valeId)
  if (!vale) return
  const payload = buildValeOpsPayload(vale)
  const stagingCol = collection(
    firestore,
    'licenses', LICENSE_KEY,
    'sync', storeId,
    'shifts', shiftId,
    'vales',
  )
  await setDoc(doc(stagingCol, vale.id), payload, { merge: true })
  await setDoc(doc(firestore, 'licenses', LICENSE_KEY, 'employeeVales', vale.id), payload, { merge: true })
}

async function uploadSalaryPayment(storeId: string, shiftId: string, paymentId: string): Promise<void> {
  const payment = await db.salaryPayments.get(paymentId)
  if (!payment) return
  const payload = buildSalaryPaymentOpsPayload(payment)
  const stagingCol = collection(
    firestore,
    'licenses', LICENSE_KEY,
    'sync', storeId,
    'shifts', shiftId,
    'salaryPayments',
  )
  await setDoc(doc(stagingCol, payment.id), payload, { merge: true })
  await setDoc(doc(firestore, 'licenses', LICENSE_KEY, 'salaryPayments', payment.id), payload, { merge: true })
}

/** Registra el listener para disparar sync al recuperar la conexión. */
export function registerOnlineListener(): void {
  onConnectivityChange((online) => {
    if (online) {
      triggerSync().catch((err: unknown) => {
        console.error('[sync] Error al disparar sync por reconexión', err)
      })
    }
  })
}
