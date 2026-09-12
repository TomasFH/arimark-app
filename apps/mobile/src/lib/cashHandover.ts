import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore'
import { parseBillLines, type BillLine } from '@carniceria/shared'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { db } from './db'
import { isOnline } from './connectivity'

export interface CashHandoverSnapshot {
  fromShiftId: string
  fromUserId: string
  fromCashierName: string
  fromClosedAt: string
  bills: BillLine[]
  counted: boolean
}

async function lastLocalClosed(storeId: string): Promise<CashHandoverSnapshot | null> {
  const closed = (await db.shifts.where('storeId').equals(storeId).toArray())
    .filter(s => Boolean(s.closedAt))
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
  const shift = closed[0]
  if (!shift?.closedAt) return null
  const bills = parseBillLines(shift.closingBills)
  return {
    fromShiftId: shift.id,
    fromUserId: shift.userId,
    fromCashierName: shift.displayName,
    fromClosedAt: shift.closedAt,
    bills,
    counted: shift.closingBillsCounted === true || bills.length > 0,
  }
}

export async function fetchCashHandover(storeId: string): Promise<CashHandoverSnapshot | null> {
  const local = await lastLocalClosed(storeId)
  if (!(await isOnline())) return local

  try {
    const firestore = getFirestore(firebaseApp)
    const snap = await getDocs(query(
      collection(firestore, 'licenses', LICENSE_KEY, 'shifts'),
      where('storeId', '==', storeId),
      orderBy('startedAt', 'desc'),
      limit(8),
    ))
    for (const d of snap.docs) {
      const data = d.data() as {
        id?: string
        closedAt?: string | null
        userId?: string
        cashierName?: string | null
        displayName?: string
        closingBills?: unknown
        closingBillsCounted?: boolean
      }
      if (!data.closedAt || !data.userId) continue
      const bills = parseBillLines(data.closingBills)
      const remote: CashHandoverSnapshot = {
        fromShiftId: data.id ?? d.id,
        fromUserId: data.userId,
        fromCashierName: (data.cashierName ?? data.displayName ?? data.userId).trim() || data.userId,
        fromClosedAt: data.closedAt,
        bills,
        counted: data.closingBillsCounted === true || bills.length > 0,
      }
      if (!local || remote.fromClosedAt > local.fromClosedAt) return remote
      return local
    }
  } catch {
    return local
  }
  return local
}
