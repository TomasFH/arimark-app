/**
 * Sync outbox de empleados (maestro) + asistencia / vales / salarios.
 *
 * Estructura:
 *   licenses/{tenantId}/employees/{id}
 *   licenses/{tenantId}/attendance/{id}
 *   licenses/{tenantId}/employeeVales/{id}
 *   licenses/{tenantId}/salaryPayments/{id}
 *
 * El maestro de empleados debe sincronizarse entre PCs: sin eso, una cajera
 * en otra máquina no ve a los carniceros dados de alta por el admin.
 *
 * No-op cuando isFirebaseAvailable() === false (APP_ENV=dev).
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
import { attendance, employeeVales, salaryPayments, employees, shifts } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

function storeIdForShift(shiftId: string | null): string | null {
  if (!shiftId) return null
  const row = getDb().select({ storeId: shifts.storeId }).from(shifts).where(eq(shifts.id, shiftId)).get()
  return row?.storeId ?? null
}

function parseValeItemsJson(raw: string | null): unknown[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

const employeeListeners: Unsubscribe[] = []

interface RemoteEmployeeDoc {
  id: string
  name: string
  weeklyWage?: number
  salary?: number
  kind?: 'butcher' | 'cashier' | string
  active?: boolean
  archivedAt?: string | null
  deleted?: boolean
  createdAt?: string
}

function employeeNameById(employeeId: string): string | null {
  const db = getDb()
  const row = db.select({ name: employees.name }).from(employees).where(eq(employees.id, employeeId)).get()
  return row?.name ?? null
}

function upsertEmployeeFromRemote(data: RemoteEmployeeDoc, docId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const id = data.id || docId
  const weeklyWage = data.weeklyWage ?? data.salary ?? 0
  const archived = Boolean(data.archivedAt) || data.active === false || data.deleted === true
  const createdAt = data.createdAt || now
  const kind = data.kind === 'cashier' ? 'cashier' as const : 'butcher' as const

  db.insert(employees).values({
    id,
    name: data.name,
    weeklyWage,
    kind,
    active: !archived,
    createdAt,
    syncedAt: now,
  })
    .onConflictDoUpdate({
      target: employees.id,
      set: {
        name: data.name,
        weeklyWage,
        kind,
        active: !archived,
        syncedAt: now,
      },
    })
    .run()
}

// ---------------------------------------------------------------------------
// Maestro: employees
// ---------------------------------------------------------------------------

export async function pushUnsyncedEmployees(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(employees).where(isNull(employees.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'employees', row.id)
      await setDoc(ref, {
        id: row.id,
        name: row.name,
        weeklyWage: row.weeklyWage,
        kind: row.kind === 'cashier' ? 'cashier' : 'butcher',
        active: row.active,
        createdAt: row.createdAt,
        deleted: false,
      }, { merge: true })

      db.update(employees).set({ syncedAt: now }).where(eq(employees.id, row.id)).run()
    } catch (err) {
      log.error('[employeeSync] Error al pushear employee', { id: row.id, err })
    }
  }

  log.info('[employeeSync] Employees pusheados', { count: pending.length })
}

export async function pullEmployeesFromFirestore(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'employees')
    const snap = await getDocs(col)

    for (const d of snap.docs) {
      try {
        const data = d.data() as RemoteEmployeeDoc
        if (!data.name) {
          log.warn('[employeeSync] Documento employee incompleto, omitido', { id: d.id })
          continue
        }
        upsertEmployeeFromRemote(data, d.id)
      } catch (err) {
        log.error('[employeeSync] Error al upsertear employee en pull', { id: d.id, err })
      }
    }

    log.info('[employeeSync] Employees bajados de Firestore', { count: snap.size })
  } catch (err) {
    log.error('[employeeSync] Error en pullEmployeesFromFirestore', err)
  }
}

export function startEmployeeSyncListener(tenantId: string): void {
  if (!isFirebaseAvailable()) {
    log.info('[employeeSync] Firebase no disponible (dev) — listener empleados omitido')
    return
  }

  if (employeeListeners.length > 0) {
    log.info('[employeeSync] Listener de employees ya activo — omitido')
    return
  }

  try {
    const app = getFirebaseApp()
    const firestore = getFirestore(app)
    const col = collection(firestore, 'licenses', tenantId, 'employees')

    const unsub = onSnapshot(col, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue
        try {
          const data = change.doc.data() as RemoteEmployeeDoc
          if (!data.name) continue
          upsertEmployeeFromRemote(data, change.doc.id)
        } catch (err) {
          log.error('[employeeSync] Error al upsertear employee desde snapshot', {
            id: change.doc.id,
            err,
          })
        }
      }
    }, err => {
      log.error('[employeeSync] Error en listener de employees', err)
    })

    employeeListeners.push(unsub)
    log.info('[employeeSync] Listener de employees iniciado')
  } catch (err) {
    log.error('[employeeSync] No se pudo iniciar el listener de employees', err)
  }
}

export function stopEmployeeSyncListener(): void {
  for (const unsub of employeeListeners) {
    try {
      unsub()
    } catch (err) {
      log.warn('[employeeSync] Error al detener listener', err)
    }
  }
  employeeListeners.length = 0
  log.info('[employeeSync] Listener de employees detenido')
}

/**
 * Push pendientes → pull fresco → listener.
 * Await en login antes de que la UI liste empleados (asistencia/vales).
 */
export async function ensureEmployeesSynced(tenantId: string): Promise<void> {
  await pushUnsyncedEmployees(tenantId)
  await pullEmployeesFromFirestore(tenantId)
  startEmployeeSyncListener(tenantId)
}

// ---------------------------------------------------------------------------
// Asistencia / vales / salarios
// ---------------------------------------------------------------------------

export async function pushUnsyncedAttendance(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(attendance).where(isNull(attendance.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'attendance', row.id)
      await setDoc(ref, {
        id: row.id,
        employeeId: row.employeeId,
        employeeName: employeeNameById(row.employeeId),
        date: row.date,
        status: row.status,
        note: row.note ?? null,
        recordedBy: row.recordedBy,
        createdAt: row.createdAt,
        deleted: false,
      }, { merge: true })

      db.update(attendance).set({ syncedAt: now }).where(eq(attendance.id, row.id)).run()
    } catch (err) {
      log.error('[employeeSync] Error al pushear attendance', { id: row.id, err })
    }
  }

  log.info('[employeeSync] Attendance pusheada', { count: pending.length })
}

export async function pushUnsyncedVales(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(employeeVales).where(isNull(employeeVales.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'employeeVales', row.id)
      await setDoc(ref, {
        id: row.id,
        employeeId: row.employeeId,
        employeeName: employeeNameById(row.employeeId),
        storeId: storeIdForShift(row.shiftId),
        shiftId: row.shiftId ?? null,
        amount: row.amount,
        description: row.description ?? null,
        items: parseValeItemsJson(row.items),
        paidAt: row.paidAt,
        recordedBy: row.recordedBy,
        createdAt: row.createdAt,
        cancelledAt: row.cancelledAt ?? null,
        cancelledBy: row.cancelledBy ?? null,
        deleted: false,
      }, { merge: true })

      db.update(employeeVales).set({ syncedAt: now }).where(eq(employeeVales.id, row.id)).run()
    } catch (err) {
      log.error('[employeeSync] Error al pushear vale', { id: row.id, err })
    }
  }

  log.info('[employeeSync] Vales pusheados', { count: pending.length })
}

export async function pushUnsyncedSalaryPayments(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return

  const db = getDb()
  const pending = db.select().from(salaryPayments).where(isNull(salaryPayments.syncedAt)).all()
  if (pending.length === 0) return

  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()

  for (const row of pending) {
    try {
      const ref = doc(firestore, 'licenses', tenantId, 'salaryPayments', row.id)
      await setDoc(ref, {
        id: row.id,
        employeeId: row.employeeId,
        employeeName: employeeNameById(row.employeeId),
        shiftId: row.shiftId ?? null,
        amount: row.amount,
        weekStart: row.weekStart,
        valesDeducted: row.valesDeducted,
        netPaid: row.netPaid,
        recordedBy: row.recordedBy,
        paidAt: row.paidAt,
        notes: row.notes ?? null,
        valesSnapshot: parseValeItemsJson(row.valesSnapshot),
        deleted: false,
      }, { merge: true })

      db.update(salaryPayments).set({ syncedAt: now }).where(eq(salaryPayments.id, row.id)).run()
    } catch (err) {
      log.error('[employeeSync] Error al pushear salary payment', { id: row.id, err })
    }
  }

  log.info('[employeeSync] Salary payments pusheados', { count: pending.length })
}

/** Drena outbox: maestro primero, luego eventos operativos. */
export async function pushUnsyncedEmployeeOps(tenantId: string): Promise<void> {
  await pushUnsyncedEmployees(tenantId)
  await pushUnsyncedAttendance(tenantId)
  await pushUnsyncedVales(tenantId)
  await pushUnsyncedSalaryPayments(tenantId)
}
