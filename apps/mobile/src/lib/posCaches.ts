/**
 * Caché local (Dexie) de proveedores, empleados, vales de la semana y
 * eventos de deuda. Las colecciones chicas se bajan enteras; vales/pagos
 * y deuda se piden recortados (por semana o por proveedor).
 */
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  setDoc,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { db } from './db'
import { isOnline } from './connectivity'
import { asIsoTimestamp, calcProviderBalance, providerNameKey } from './adminLedger'
import { firestorePaidAtBounds } from './week'
import type {
  CachedEmployee,
  CachedProvider,
  LocalSalaryPayment,
  LocalVale,
  SalaryValeSnapshotItem,
} from '../types/pos'

const firestore = getFirestore(firebaseApp)

function col(name: string) {
  return collection(firestore, 'licenses', LICENSE_KEY, name)
}

export function parseProviderDoc(id: string, data: Record<string, unknown>): CachedProvider | null {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) return null
  if (data.deleted === true) return null
  return {
    id: typeof data.id === 'string' ? data.id : id,
    name,
    archivedAt: asIsoTimestamp(data.archivedAt),
    updatedAt: new Date().toISOString(),
  }
}

export function parseEmployeeDoc(id: string, data: Record<string, unknown>): CachedEmployee | null {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) return null
  if (data.deleted === true) return null
  const weeklyWage = typeof data.weeklyWage === 'number'
    ? data.weeklyWage
    : (typeof data.salary === 'number' ? data.salary : 0)
  const archivedAt = asIsoTimestamp(data.archivedAt)
  const inactive = data.active === false || Boolean(archivedAt)
  return {
    id: typeof data.id === 'string' ? data.id : id,
    name,
    weeklyWage,
    kind: data.kind === 'cashier' ? 'cashier' : 'butcher',
    homeStoreId: typeof data.homeStoreId === 'string' && data.homeStoreId.trim()
      ? data.homeStoreId.trim()
      : null,
    archivedAt: inactive ? (archivedAt ?? 'inactive') : null,
    updatedAt: new Date().toISOString(),
  }
}

function parseValeSnapshot(raw: unknown): SalaryValeSnapshotItem[] | null {
  if (!Array.isArray(raw)) return null
  const items: SalaryValeSnapshotItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.id !== 'string' || typeof rec.amount !== 'number') continue
    items.push({
      id: rec.id,
      amount: rec.amount,
      description: typeof rec.description === 'string' ? rec.description : null,
      paidAt: typeof rec.paidAt === 'string' ? rec.paidAt : '',
    })
  }
  return items
}

export function parseValeDoc(id: string, data: Record<string, unknown>): LocalVale | null {
  const employeeId = typeof data.employeeId === 'string' ? data.employeeId : ''
  if (!employeeId) return null
  if (data.deleted === true || data.cancelledAt) return null
  const amount = typeof data.amount === 'number' ? data.amount : 0
  if (amount <= 0) return null
  return {
    id: typeof data.id === 'string' ? data.id : id,
    employeeId,
    employeeName: typeof data.employeeName === 'string' ? data.employeeName : '',
    shiftId: typeof data.shiftId === 'string' ? data.shiftId : '',
    storeId: typeof data.storeId === 'string' ? data.storeId : '',
    amount,
    description: typeof data.description === 'string' ? data.description : null,
    items: Array.isArray(data.items) ? data.items as LocalVale['items'] : null,
    paidAt: typeof data.paidAt === 'string' ? data.paidAt : '',
    recordedBy: typeof data.recordedBy === 'string' ? data.recordedBy : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : (typeof data.paidAt === 'string' ? data.paidAt : ''),
    syncStatus: 'synced',
    syncedAt: new Date().toISOString(),
  }
}

export function parseSalaryPaymentDoc(id: string, data: Record<string, unknown>): LocalSalaryPayment | null {
  const employeeId = typeof data.employeeId === 'string' ? data.employeeId : ''
  if (!employeeId) return null
  if (data.deleted === true) return null
  return {
    id: typeof data.id === 'string' ? data.id : id,
    employeeId,
    employeeName: typeof data.employeeName === 'string' ? data.employeeName : '',
    shiftId: typeof data.shiftId === 'string' ? data.shiftId : '',
    storeId: typeof data.storeId === 'string' ? data.storeId : '',
    amount: typeof data.amount === 'number' ? data.amount : 0,
    weekStart: typeof data.weekStart === 'string' ? data.weekStart : '',
    valesDeducted: typeof data.valesDeducted === 'number' ? data.valesDeducted : 0,
    netPaid: typeof data.netPaid === 'number' ? data.netPaid : 0,
    notes: typeof data.notes === 'string' ? data.notes : null,
    valesSnapshot: parseValeSnapshot(data.valesSnapshot),
    recordedBy: typeof data.recordedBy === 'string' ? data.recordedBy : '',
    paidAt: typeof data.paidAt === 'string' ? data.paidAt : '',
    syncStatus: 'synced',
    syncedAt: new Date().toISOString(),
  }
}

export async function listCachedProviders(): Promise<CachedProvider[]> {
  const all = await db.providers.toArray()
  return all
    .filter(p => !p.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function listCachedEmployees(opts?: { includeArchived?: boolean }): Promise<CachedEmployee[]> {
  const all = await db.employees.toArray()
  return all
    .filter(e => opts?.includeArchived || !e.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function refreshProvidersCache(): Promise<void> {
  if (!(await isOnline())) return
  const snap = await getDocs(col('providers'))
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    if (data.deleted === true) {
      await db.providers.delete(typeof data.id === 'string' ? data.id : d.id)
      continue
    }
    const parsed = parseProviderDoc(d.id, data)
    if (!parsed) continue
    await db.providers.put(parsed)
  }
}

export async function refreshEmployeesCache(): Promise<void> {
  if (!(await isOnline())) return
  const snap = await getDocs(col('employees'))
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    if (data.deleted === true) {
      await db.employees.delete(typeof data.id === 'string' ? data.id : d.id)
      continue
    }
    const parsed = parseEmployeeDoc(d.id, data)
    if (!parsed) continue
    await db.employees.put(parsed)
  }
}

export async function refreshWeekPayrollCache(weekStart: string, weekEnd: string): Promise<void> {
  if (!(await isOnline())) return
  const bounds = firestorePaidAtBounds(weekStart, weekEnd)

  const valesQ = query(
    col('employeeVales'),
    where('paidAt', '>=', bounds.from),
    where('paidAt', '<=', bounds.to),
  )
  const payQ = query(col('salaryPayments'), where('weekStart', '==', weekStart))
  const [valesSnap, paySnap] = await Promise.all([getDocs(valesQ), getDocs(payQ)])

  for (const d of valesSnap.docs) {
    const parsed = parseValeDoc(d.id, d.data() as Record<string, unknown>)
    if (!parsed) continue
    const local = await db.vales.get(parsed.id)
    if (local && local.syncStatus === 'pending') continue
    await db.vales.put(parsed)
  }

  for (const d of paySnap.docs) {
    const parsed = parseSalaryPaymentDoc(d.id, d.data() as Record<string, unknown>)
    if (!parsed) continue
    const local = await db.salaryPayments.get(parsed.id)
    if (local && local.syncStatus === 'pending') continue
    const byWeek = await db.salaryPayments
      .where('weekStart')
      .equals(weekStart)
      .filter(p => p.employeeId === parsed.employeeId)
      .first()
    if (byWeek && byWeek.syncStatus === 'pending') continue
    await db.salaryPayments.put(parsed)
  }
}

export async function refreshPosCaches(weekStart: string, weekEnd: string): Promise<void> {
  await Promise.all([
    refreshProvidersCache(),
    refreshEmployeesCache(),
    refreshWeekPayrollCache(weekStart, weekEnd),
  ])
}

export async function getProviderBalance(providerId: string, storeId: string): Promise<number> {
  const localEvents = await db.providerDebtEvents
    .where('providerId')
    .equals(providerId)
    .filter(e => e.storeId === storeId)
    .toArray()

  let remote: Array<{ type: 'debt' | 'payment'; amount: number }> = []
  let usedRemote = false
  try {
    if (await isOnline()) {
      const q = query(col('providerDebtEvents'), where('providerId', '==', providerId))
      const snap = await getDocs(q)
      usedRemote = true
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        if (data.deleted === true) continue
        if (data.storeId !== storeId) continue
        const type = data.type === 'payment' ? 'payment' : 'debt'
        const amount = typeof data.amount === 'number' ? data.amount : 0
        remote.push({ type, amount })
        const local = localEvents.find(e => e.id === d.id)
        if (!local) {
          await db.providerDebtEvents.put({
            id: d.id,
            expenseId: typeof data.expenseId === 'string' ? data.expenseId : '',
            shiftId: typeof data.shiftId === 'string' ? data.shiftId : '',
            storeId,
            providerId,
            providerName: typeof data.provider === 'string' ? data.provider : '',
            type,
            amount,
            createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
            createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
            syncStatus: 'synced',
            syncedAt: new Date().toISOString(),
          })
        }
      }
    }
  } catch (err) {
    console.error('[posCaches] No se pudo leer deuda remota', err)
    usedRemote = false
  }

  if (!usedRemote) {
    return calcProviderBalance(localEvents.map(e => ({ type: e.type, amount: e.amount })))
  }

  const pending = localEvents.filter(e => e.syncStatus !== 'synced')
  return calcProviderBalance([
    ...remote,
    ...pending.map(e => ({ type: e.type, amount: e.amount })),
  ])
}

export async function upsertCachedProvider(input: {
  id: string
  name: string
  createdBy: string
}): Promise<void> {
  const now = new Date().toISOString()
  await db.providers.put({
    id: input.id,
    name: input.name,
    archivedAt: null,
    updatedAt: now,
  })
  if (!(await isOnline())) return
  await setDoc(doc(firestore, 'licenses', LICENSE_KEY, 'providers', input.id), {
    id: input.id,
    name: input.name,
    nameKey: providerNameKey(input.name),
    archivedAt: null,
    deleted: false,
    createdAt: now,
    createdBy: input.createdBy,
  }, { merge: true })
}

export function filterProviders(providers: CachedProvider[], queryText: string): CachedProvider[] {
  const q = queryText.trim().toLowerCase()
  if (!q) return providers
  return providers.filter(p => p.name.toLowerCase().includes(q))
}
