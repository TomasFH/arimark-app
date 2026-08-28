/**
 * Lecturas Firestore de liquidación: una semana, no la colección entera.
 */
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import log from 'electron-log'
import { getBusinessConfig } from '../businessConfig'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import type {
  RemoteEmployeeValeRow,
  SalaryPaymentRow,
  SalaryValeSnapshotItem,
} from '../../src/types/hw-api'

function addDaysUtc(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Recorte holgado (1 día a cada lado); el filtro civil lo hace la UI. */
export function firestorePaidAtBounds(weekStart: string, weekEnd: string): { from: string; to: string } {
  return {
    from: `${addDaysUtc(weekStart, -1)}T00:00:00.000Z`,
    to: `${addDaysUtc(weekEnd, 1)}T23:59:59.999Z`,
  }
}

function parseSnapshot(raw: unknown): SalaryValeSnapshotItem[] | null {
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

export async function fetchSalaryPaymentsByWeekStart(weekStart: string): Promise<SalaryPaymentRow[]> {
  if (!isFirebaseAvailable()) return []

  try {
    const config = getBusinessConfig()
    const firestore = getFirestore(getFirebaseApp())
    const col = collection(firestore, 'licenses', config.tenant_id, 'salaryPayments')
    const snap = await getDocs(query(col, where('weekStart', '==', weekStart)))
    const rows: SalaryPaymentRow[] = []
    for (const d of snap.docs) {
      const v = d.data() as Record<string, unknown>
      if (v.deleted === true) continue
      const employeeId = typeof v.employeeId === 'string' ? v.employeeId : ''
      if (!employeeId) continue
      rows.push({
        id: typeof v.id === 'string' ? v.id : d.id,
        employeeId,
        shiftId: typeof v.shiftId === 'string' ? v.shiftId : null,
        amount: typeof v.amount === 'number' ? v.amount : 0,
        weekStart: typeof v.weekStart === 'string' ? v.weekStart : weekStart,
        valesDeducted: typeof v.valesDeducted === 'number' ? v.valesDeducted : 0,
        netPaid: typeof v.netPaid === 'number' ? v.netPaid : 0,
        recordedBy: typeof v.recordedBy === 'string' ? v.recordedBy : '',
        paidAt: typeof v.paidAt === 'string' ? v.paidAt : '',
        notes: typeof v.notes === 'string' ? v.notes : null,
        valesSnapshot: parseSnapshot(v.valesSnapshot),
      })
    }
    return rows
  } catch (err) {
    log.error('[salaryFirestore] Error al leer salaryPayments de la semana', { weekStart, err })
    return []
  }
}

export async function fetchValesInPaidAtRange(
  fromIso: string,
  toIso: string,
): Promise<RemoteEmployeeValeRow[]> {
  if (!isFirebaseAvailable()) return []

  try {
    const config = getBusinessConfig()
    const firestore = getFirestore(getFirebaseApp())
    const col = collection(firestore, 'licenses', config.tenant_id, 'employeeVales')
    const snap = await getDocs(
      query(col, where('paidAt', '>=', fromIso), where('paidAt', '<=', toIso)),
    )
    const rows: RemoteEmployeeValeRow[] = []
    for (const d of snap.docs) {
      const v = d.data() as Record<string, unknown>
      if (v.deleted === true) continue
      const employeeId = typeof v.employeeId === 'string' ? v.employeeId : ''
      if (!employeeId) continue
      const itemsRaw = Array.isArray(v.items) ? v.items : []
      rows.push({
        id: typeof v.id === 'string' ? v.id : d.id,
        employeeId,
        employeeName: typeof v.employeeName === 'string' ? v.employeeName : employeeId,
        storeId: typeof v.storeId === 'string' ? v.storeId : null,
        shiftId: typeof v.shiftId === 'string' ? v.shiftId : null,
        amount: typeof v.amount === 'number' ? v.amount : 0,
        description: typeof v.description === 'string' ? v.description : null,
        items: itemsRaw.map(item => {
          const rec = item && typeof item === 'object' ? item as Record<string, unknown> : {}
          return {
            productName: typeof rec.productName === 'string' ? rec.productName : '(producto)',
            quantity: typeof rec.quantity === 'number' ? rec.quantity : 0,
            unitPrice: typeof rec.unitPrice === 'number' ? rec.unitPrice : 0,
            subtotal: typeof rec.subtotal === 'number' ? rec.subtotal : 0,
          }
        }),
        paidAt: typeof v.paidAt === 'string' ? v.paidAt : (typeof v.createdAt === 'string' ? v.createdAt : ''),
        createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
        cancelledAt: typeof v.cancelledAt === 'string' ? v.cancelledAt : null,
      })
    }
    return rows
  } catch (err) {
    log.error('[salaryFirestore] Error al leer vales del recorte', { fromIso, toIso, err })
    return []
  }
}
