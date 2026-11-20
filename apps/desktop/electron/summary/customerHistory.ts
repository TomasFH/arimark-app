/**
 * Historial de un cliente en un local. Una página de 30, y la siguiente
 * arranca después de la anterior. No lee la ficha: el nombre ya está en la PC.
 */
import {
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import log from 'electron-log'
import {
  CUSTOMER_HISTORY_LIMIT,
  type CustomerHistoryMove,
  type CustomerHistoryPage,
} from '@carniceria/shared'
import { getBusinessConfig } from '../businessConfig'
import { getFirebaseApp, isFirebaseAvailable } from '../licensing/firebase'

const cursors = new Map<string, QueryDocumentSnapshot>()

function cursorKey(customerId: string, storeId: string): string {
  return `${customerId}\0${storeId}`
}

export function clearCustomerHistoryCursors(): void {
  cursors.clear()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function moveFrom(docSnap: QueryDocumentSnapshot): CustomerHistoryMove {
  const data = docSnap.data() as Record<string, unknown>
  const shiftId = data['shiftId']
  const amount = data['amount']
  return {
    id: docSnap.id,
    eventType: text(data['eventType']),
    amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : 0,
    createdAt: text(data['createdAt']),
    shiftId: typeof shiftId === 'string' && shiftId ? shiftId : null,
  }
}

/**
 * Primera página, o la siguiente si more es true.
 * Sin cursor guardado, more no vuelve a leer la primera página: falla.
 */
export async function loadCustomerHistory(input: {
  customerId: string
  storeId: string
  more: boolean
}): Promise<CustomerHistoryPage> {
  if (!isFirebaseAvailable()) throw new Error('FIREBASE_OFF')
  const key = cursorKey(input.customerId, input.storeId)
  const cursor = input.more ? cursors.get(key) : undefined
  if (input.more && !cursor) throw new Error('NO_CURSOR')

  const firestore = getFirestore(getFirebaseApp())
  const tenant = getBusinessConfig().tenant_id
  const constraints: QueryConstraint[] = [
    where('customerId', '==', input.customerId),
    where('storeId', '==', input.storeId),
    orderBy('createdAtServer', 'desc'),
  ]
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(CUSTOMER_HISTORY_LIMIT))

  let snap
  try {
    snap = await getDocs(query(
      collection(firestore, 'licenses', tenant, 'customerDebtEvents'),
      ...constraints,
    ))
  } catch (err) {
    log.error('[customerHistory] No se pudo leer el historial', {
      customerId: input.customerId,
      storeId: input.storeId,
      err,
    })
    throw err
  }

  const docs = snap.docs
  const last = docs[docs.length - 1]
  if (docs.length === CUSTOMER_HISTORY_LIMIT && last) cursors.set(key, last)
  else cursors.delete(key)
  return {
    moves: docs.map(moveFrom),
    hasMore: docs.length === CUSTOMER_HISTORY_LIMIT,
  }
}
