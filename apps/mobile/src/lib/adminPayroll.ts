/**
 * Vales de la semana para liquidación: query por `paidAt`, no la colección entera.
 * Mientras la pantalla está abierta, `onSnapshot` del mismo recorte (en vivo, cupo chico).
 */
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  type Unsubscribe,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import type { PayrollPayment, PayrollVale } from './payroll'

const firestore = getFirestore(firebaseApp)

function parseVale(id: string, data: Record<string, unknown>): PayrollVale | null {
  const employeeId = typeof data.employeeId === 'string' ? data.employeeId : ''
  if (!employeeId) return null
  const paidAt = typeof data.paidAt === 'string' ? data.paidAt : ''
  const amount = typeof data.amount === 'number' ? data.amount : 0
  const description = typeof data.description === 'string' ? data.description : null
  const cancelledAt = typeof data.cancelledAt === 'string' ? data.cancelledAt : null
  return {
    id: typeof data.id === 'string' ? data.id : id,
    employeeId,
    amount,
    description,
    paidAt,
    deleted: data.deleted === true,
    cancelledAt,
  }
}

export function subscribeValesInPaidAtRange(
  fromIso: string,
  toIso: string,
  onData: (vales: PayrollVale[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  const col = collection(firestore, 'licenses', LICENSE_KEY, 'employeeVales')
  const q = query(
    col,
    where('paidAt', '>=', fromIso),
    where('paidAt', '<=', toIso),
  )
  return onSnapshot(
    q,
    snap => {
      const list: PayrollVale[] = []
      for (const d of snap.docs) {
        const parsed = parseVale(d.id, d.data() as Record<string, unknown>)
        if (parsed) list.push(parsed)
      }
      onData(list)
    },
    err => {
      onError(err.message || 'No se pudieron leer los vales de la semana.')
    },
  )
}

export async function fetchValesInPaidAtRange(fromIso: string, toIso: string): Promise<PayrollVale[]> {
  const col = collection(firestore, 'licenses', LICENSE_KEY, 'employeeVales')
  const q = query(
    col,
    where('paidAt', '>=', fromIso),
    where('paidAt', '<=', toIso),
  )
  const snap = await getDocs(q)
  const list: PayrollVale[] = []
  for (const d of snap.docs) {
    const parsed = parseVale(d.id, d.data() as Record<string, unknown>)
    if (parsed) list.push(parsed)
  }
  return list
}

function parseSnapshot(raw: unknown): PayrollVale[] | null {
  if (!Array.isArray(raw)) return null
  const items: PayrollVale[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.id !== 'string' || typeof rec.amount !== 'number') continue
    items.push({
      id: rec.id,
      employeeId: typeof rec.employeeId === 'string' ? rec.employeeId : '',
      amount: rec.amount,
      description: typeof rec.description === 'string' ? rec.description : null,
      paidAt: typeof rec.paidAt === 'string' ? rec.paidAt : '',
    })
  }
  return items
}

export function subscribeSalaryPaymentsForWeek(
  weekStart: string,
  onData: (payments: PayrollPayment[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  const col = collection(firestore, 'licenses', LICENSE_KEY, 'salaryPayments')
  const q = query(col, where('weekStart', '==', weekStart))
  return onSnapshot(
    q,
    snap => {
      const list: PayrollPayment[] = []
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        if (data.deleted === true) continue
        const employeeId = typeof data.employeeId === 'string' ? data.employeeId : ''
        if (!employeeId) continue
        list.push({
          id: typeof data.id === 'string' ? data.id : d.id,
          employeeId,
          amount: typeof data.amount === 'number' ? data.amount : 0,
          valesDeducted: typeof data.valesDeducted === 'number' ? data.valesDeducted : 0,
          netPaid: typeof data.netPaid === 'number' ? data.netPaid : 0,
          notes: typeof data.notes === 'string' ? data.notes : null,
          paidAt: typeof data.paidAt === 'string' ? data.paidAt : '',
          valesSnapshot: parseSnapshot(data.valesSnapshot),
        })
      }
      onData(list)
    },
    err => {
      onError(err.message || 'No se pudieron leer los pagos de la semana.')
    },
  )
}

export async function fetchSalaryPaymentsForWeek(weekStart: string): Promise<PayrollPayment[]> {
  const col = collection(firestore, 'licenses', LICENSE_KEY, 'salaryPayments')
  const q = query(col, where('weekStart', '==', weekStart))
  const snap = await getDocs(q)
  const list: PayrollPayment[] = []
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    if (data.deleted === true) continue
    const employeeId = typeof data.employeeId === 'string' ? data.employeeId : ''
    if (!employeeId) continue
    list.push({
      id: typeof data.id === 'string' ? data.id : d.id,
      employeeId,
      amount: typeof data.amount === 'number' ? data.amount : 0,
      valesDeducted: typeof data.valesDeducted === 'number' ? data.valesDeducted : 0,
      netPaid: typeof data.netPaid === 'number' ? data.netPaid : 0,
      notes: typeof data.notes === 'string' ? data.notes : null,
      paidAt: typeof data.paidAt === 'string' ? data.paidAt : '',
      valesSnapshot: parseSnapshot(data.valesSnapshot),
    })
  }
  return list
}
