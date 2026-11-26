/**
 * Checkpoint de fiado de un cliente en un local, más los eventos con
 * createdAtServer estrictamente posterior. No baja el libro plegado.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  Timestamp,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import {
  CUSTOMER_DEBT_CHECKPOINTS_COL,
  CUSTOMER_DEBT_EVENTS_COL,
  debtCheckpointDocId,
  parseCheckpointData,
  parseCompactableEvent,
  type CompactableDebtEvent,
} from '@carniceria/shared'
import { getBusinessConfig } from '../businessConfig'
import { signedCustomerAmount, type CustomerLedgerEvent, type CustomerRemoteSlice } from './customerStoreBalance'
import { getFirebaseApp } from './firebase'

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function paymentMethodOf(value: unknown): CustomerLedgerEvent['paymentMethod'] {
  if (value === 'cash' || value === 'debit' || value === 'wallet' || value === 'credit') return value
  return null
}

/** Corte de un local y solo la cola. Si no hay documento, el corte está vacío. */
export async function readCustomerAccountSlice(
  customerId: string,
  storeId: string,
): Promise<CustomerRemoteSlice> {
  const tenant = getBusinessConfig().tenant_id
  const firestore = getFirestore(getFirebaseApp())
  const checkpointSnap = await getDoc(doc(
    firestore,
    'licenses',
    tenant,
    CUSTOMER_DEBT_CHECKPOINTS_COL,
    debtCheckpointDocId(customerId, storeId),
  ))
  const checkpoint = parseCheckpointData(
    'customer',
    customerId,
    storeId,
    checkpointSnap.exists() ? checkpointSnap.data() as Record<string, unknown> : undefined,
  )
  const constraints: QueryConstraint[] = [
    where('customerId', '==', customerId),
    where('storeId', '==', storeId),
    orderBy('createdAtServer', 'asc'),
  ]
  if (checkpoint.checkpointAt) {
    constraints.splice(2, 0, where(
      'createdAtServer',
      '>',
      new Timestamp(checkpoint.checkpointAt.seconds, checkpoint.checkpointAt.nanos),
    ))
  }
  const snap = await getDocs(query(
    collection(firestore, 'licenses', tenant, CUSTOMER_DEBT_EVENTS_COL),
    ...constraints,
  ))
  const events: CompactableDebtEvent[] = []
  const display: CustomerLedgerEvent[] = []
  for (const row of snap.docs) {
    const data = row.data() as Record<string, unknown>
    const parsed = parseCompactableEvent('customer', row.id, data)
    if (!parsed || parsed.deleted === true) continue
    events.push(parsed)
    const eventType = parsed.customerEventType ?? 'created'
    display.push({
      id: row.id,
      customerId,
      storeId,
      eventType,
      amount: signedCustomerAmount(eventType, parsed.amount),
      createdAt: textOrNull(data.createdAt) ?? new Date(parsed.serverAt.seconds * 1000).toISOString(),
      syncedAt: textOrNull(data.createdAt),
      saleId: textOrNull(data.saleId),
      dueDate: textOrNull(data.dueDate),
      notes: textOrNull(data.notes),
      paymentMethod: paymentMethodOf(data.paymentMethod),
      createdBy: textOrNull(data.createdBy) ?? '',
    })
  }
  return { checkpoint, events, display }
}
