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
  createdAtInsideCheckpoint,
  debtCheckpointDocId,
  type TsRank,
  parseCheckpointData,
  parseCompactableEvent,
  PROVIDER_DEBT_CHECKPOINTS_COL,
  PROVIDER_DEBT_EVENTS_COL,
} from '@carniceria/shared'
import { getBusinessConfig } from '../businessConfig'
import { getFirebaseApp } from './firebase'

export interface ProviderAccountSliceEvent {
  id: string
  type: 'debt' | 'payment'
  amount: number
  createdAt: string
  createdBy: string
  expenseId: string | null
  notes: string | null
}

export interface ProviderAccountSlice {
  openingBalance: number
  hasCheckpoint: boolean
  checkpointAt: TsRank | null
  events: ProviderAccountSliceEvent[]
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Checkpoint de un local y solo los eventos posteriores. No baja el ledger plegado. */
export async function readProviderAccountSlice(
  providerId: string,
  storeId: string,
): Promise<ProviderAccountSlice> {
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
  const events: ProviderAccountSliceEvent[] = []
  for (const row of snap.docs) {
    const data = row.data() as Record<string, unknown>
    const parsed = parseCompactableEvent('provider', row.id, data)
    if (!parsed || parsed.deleted === true) continue
    const createdAt = textOrNull(data.createdAt) ?? textOrNull(data.date) ?? ''
    events.push({
      id: row.id,
      type: parsed.providerType === 'payment' ? 'payment' : 'debt',
      amount: parsed.amount,
      createdAt,
      createdBy: textOrNull(data.createdBy) ?? '',
      expenseId: textOrNull(data.expenseId),
      notes: textOrNull(data.notes) ?? textOrNull(data.description),
    })
  }
  const visible = events.filter(event => !createdAtInsideCheckpoint(event.createdAt, checkpoint.checkpointAt))
  return {
    openingBalance: checkpoint.saldoAcumulado,
    hasCheckpoint: checkpoint.checkpointAt != null,
    checkpointAt: checkpoint.checkpointAt,
    events: visible,
  }
}

export async function readProviderCheckpointBalance(
  providerId: string,
  storeId: string,
): Promise<number> {
  const slice = await readProviderAccountSlice(providerId, storeId)
  return slice.events.reduce(
    (sum, event) => sum + (event.type === 'debt' ? event.amount : -event.amount),
    slice.openingBalance,
  )
}
