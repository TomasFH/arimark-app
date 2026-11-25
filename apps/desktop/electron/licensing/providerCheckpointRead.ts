/**
 * Saldo compartido de un proveedor en un local: el documento de checkpoint
 * más los eventos con createdAtServer estrictamente posterior. Es la misma
 * cuenta que arma el listener de debtBalanceLive, para cuando ese par
 * todavía no está en memoria.
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
  debtCheckpointDocId,
  liveSaldoFromCheckpoint,
  parseCheckpointData,
  parseCompactableEvent,
  PROVIDER_DEBT_CHECKPOINTS_COL,
  PROVIDER_DEBT_EVENTS_COL,
} from '@carniceria/shared'
import { getBusinessConfig } from '../businessConfig'
import { getFirebaseApp } from './firebase'

export async function readProviderCheckpointBalance(
  providerId: string,
  storeId: string,
): Promise<number> {
  const tenant = getBusinessConfig().tenant_id
  const firestore = getFirestore(getFirebaseApp())
  const checkpointSnap = await getDoc(doc(
    firestore,
    'licenses',
    tenant,
    PROVIDER_DEBT_CHECKPOINTS_COL,
    debtCheckpointDocId(providerId, storeId),
  ))
  const checkpoint = parseCheckpointData(
    'provider',
    providerId,
    storeId,
    checkpointSnap.exists() ? checkpointSnap.data() as Record<string, unknown> : undefined,
  )
  const constraints: QueryConstraint[] = [
    where('providerId', '==', providerId),
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
    collection(firestore, 'licenses', tenant, PROVIDER_DEBT_EVENTS_COL),
    ...constraints,
  ))
  const events = []
  for (const row of snap.docs) {
    const parsed = parseCompactableEvent('provider', row.id, row.data() as Record<string, unknown>)
    if (parsed) events.push(parsed)
  }
  return liveSaldoFromCheckpoint('provider', checkpoint, events)
}
