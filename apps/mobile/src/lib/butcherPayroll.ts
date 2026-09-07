/**
 * Liquidación semanal del carnicero: solo la semana en curso.
 * Queries filtradas por employeeId — no baja toda la colección.
 * Patrón idéntico a adminPayroll.ts pero acotado a un empleado.
 */
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  query,
  where,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import type { PayrollEmployee, PayrollVale, PayrollPayment } from './payroll'
import { firestorePaidAtBounds, valeInLocalWeek } from './week'

const firestore = getFirestore(firebaseApp)
const col = (name: string) =>
  collection(firestore, 'licenses', LICENSE_KEY, name)

/**
 * Obtiene el perfil del empleado (nombre + sueldo semanal) desde Firestore.
 * Se llama una vez al abrir "Mi semana".
 */
export async function fetchButcherEmployee(
  employeeId: string,
): Promise<PayrollEmployee | null> {
  const ref = doc(firestore, 'licenses', LICENSE_KEY, 'employees', employeeId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  const data = snap.data() as Record<string, unknown>
  if (data['deleted'] === true) return null
  const weeklyWage =
    typeof data['weeklyWage'] === 'number' ? data['weeklyWage']
    : typeof data['salary'] === 'number' ? data['salary']
    : 0
  return {
    id: snap.id,
    name: typeof data['name'] === 'string' ? data['name'] : '',
    weeklyWage,
    archivedAt: typeof data['archivedAt'] === 'string' ? data['archivedAt'] : null,
    deleted: false,
  }
}

/**
 * Suscripción en vivo a los vales de la semana del carnicero.
 * Filtra por `employeeId` y `paidAt` en el rango UTC holgado;
 * el filtro civil exacto se aplica en `buildWeeklyPayroll` (valeInLocalWeek).
 */
export function subscribeButcherVales(
  employeeId: string,
  weekStart: string,
  weekEnd: string,
  onData: (vales: PayrollVale[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  const { from, to } = firestorePaidAtBounds(weekStart, weekEnd)
  const q = query(
    col('employeeVales'),
    where('employeeId', '==', employeeId),
    where('paidAt', '>=', from),
    where('paidAt', '<=', to),
  )
  return onSnapshot(
    q,
    snap => {
      const list: PayrollVale[] = []
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
        if (data['deleted'] === true) continue
        const paidAt = typeof data['paidAt'] === 'string' ? data['paidAt'] : ''
        if (!valeInLocalWeek(paidAt, weekStart, weekEnd)) continue
        list.push({
          id: typeof data['id'] === 'string' ? data['id'] : d.id,
          employeeId,
          amount: typeof data['amount'] === 'number' ? data['amount'] : 0,
          description: typeof data['description'] === 'string' ? data['description'] : null,
          paidAt,
          deleted: false,
          cancelledAt: typeof data['cancelledAt'] === 'string' ? data['cancelledAt'] : null,
        })
      }
      onData(list)
    },
    err => onError(err.message || 'No se pudieron cargar los vales.'),
  )
}

/**
 * Suscripción al pago de sueldo de la semana del carnicero.
 * Un solo documento (si ya fue pagado).
 */
export function subscribeButcherPayment(
  employeeId: string,
  weekStart: string,
  onData: (payment: PayrollPayment | null) => void,
  onError: (message: string) => void,
): Unsubscribe {
  const q = query(
    col('salaryPayments'),
    where('employeeId', '==', employeeId),
    where('weekStart', '==', weekStart),
  )
  return onSnapshot(
    q,
    snap => {
      const first = snap.docs.find(d => (d.data() as Record<string, unknown>)['deleted'] !== true)
      if (!first) {
        onData(null)
        return
      }
      const data = first.data() as Record<string, unknown>
      const raw = data['valesSnapshot']
      let valesSnapshot: PayrollVale[] | null = null
      if (Array.isArray(raw)) {
        valesSnapshot = raw
          .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
          .map(v => ({
            id: typeof v['id'] === 'string' ? v['id'] : '',
            employeeId: typeof v['employeeId'] === 'string' ? v['employeeId'] : employeeId,
            amount: typeof v['amount'] === 'number' ? v['amount'] : 0,
            description: typeof v['description'] === 'string' ? v['description'] : null,
            paidAt: typeof v['paidAt'] === 'string' ? v['paidAt'] : '',
          }))
      }
      onData({
        id: typeof data['id'] === 'string' ? data['id'] : first.id,
        employeeId,
        amount: typeof data['amount'] === 'number' ? data['amount'] : 0,
        valesDeducted: typeof data['valesDeducted'] === 'number' ? data['valesDeducted'] : 0,
        netPaid: typeof data['netPaid'] === 'number' ? data['netPaid'] : 0,
        notes: typeof data['notes'] === 'string' ? data['notes'] : null,
        paidAt: typeof data['paidAt'] === 'string' ? data['paidAt'] : '',
        valesSnapshot,
      })
    },
    err => onError(err.message || 'No se pudo cargar el pago de sueldo.'),
  )
}
