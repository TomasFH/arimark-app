/**
 * Listener padre/hijo de saldo en el celu.
 * El padre es el doc de checkpoint; el hijo se rearma si cambia checkpointAt.
 */
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import {
  DEBT_CHECKPOINT_TAILS_COL,
  CUSTOMER_DEBT_CHECKPOINTS_COL,
  CUSTOMER_DEBT_EVENTS_COL,
  DEBT_EVENT_SERVER_TS_FIELD,
  PROVIDER_DEBT_CHECKPOINTS_COL,
  PROVIDER_DEBT_EVENTS_COL,
  debtCheckpointDocId,
  emptyCheckpoint,
  entityIdField,
  liveSaldoFromCheckpoint,
  parseCheckpointData,
  parseCompactableEvent,
  shouldRebindDebtEventsListener,
  type CompactableDebtEvent,
  type DebtCheckpointFields,
  type DebtCheckpointKind,
  type TsRank,
} from '@carniceria/shared'

const firestore = getFirestore(firebaseApp)

export interface LiveBalanceSnapshot {
  balances: Map<string, number>
}

interface PairChild {
  generation: number
  bound: TsRank | null
  checkpoint: DebtCheckpointFields
  events: Map<string, CompactableDebtEvent>
  unsub: Unsubscribe | null
}

function pairKey(kind: DebtCheckpointKind, entityId: string, storeId: string): string {
  return `${kind}:${debtCheckpointDocId(entityId, storeId)}`
}

function rankToTimestamp(rank: TsRank): Timestamp {
  return new Timestamp(rank.seconds, rank.nanos)
}

export function subscribeKindBalances(
  kind: DebtCheckpointKind,
  onChange: (balances: Map<string, number>) => void,
): Unsubscribe {
  const children = new Map<string, PairChild>()
  const parents: Unsubscribe[] = []

  const emit = (): void => {
    const balances = new Map<string, number>()
    for (const child of children.values()) {
      const saldo = liveSaldoFromCheckpoint(
        child.checkpoint.kind,
        child.checkpoint,
        [...child.events.values()],
      )
      const prev = balances.get(child.checkpoint.entityId) ?? 0
      balances.set(child.checkpoint.entityId, prev + saldo)
    }
    onChange(balances)
  }

  const bind = (checkpoint: DebtCheckpointFields): void => {
    const key = pairKey(checkpoint.kind, checkpoint.entityId, checkpoint.storeId)
    const bound = checkpoint.checkpointAt
    const existing = children.get(key)
    if (existing && !shouldRebindDebtEventsListener(existing.bound, bound)) {
      existing.checkpoint = checkpoint
      emit()
      return
    }
    const generation = (existing?.generation ?? 0) + 1
    existing?.unsub?.()
    const child: PairChild = {
      generation,
      bound,
      checkpoint,
      events: new Map(),
      unsub: null,
    }
    children.set(key, child)
    const idField = entityIdField(kind)
    const colName = kind === 'provider' ? PROVIDER_DEBT_EVENTS_COL : CUSTOMER_DEBT_EVENTS_COL
    const constraints = [
      where(idField, '==', checkpoint.entityId),
      where('storeId', '==', checkpoint.storeId),
      orderBy(DEBT_EVENT_SERVER_TS_FIELD, 'asc'),
    ]
    if (bound) {
      constraints.splice(2, 0, where(DEBT_EVENT_SERVER_TS_FIELD, '>', rankToTimestamp(bound)))
    }
    const q = query(collection(firestore, 'licenses', LICENSE_KEY, colName), ...constraints)
    child.unsub = onSnapshot(q, snap => {
      const live = children.get(key)
      if (!live || live.generation !== generation) return
      live.events.clear()
      for (const d of snap.docs) {
        const parsed = parseCompactableEvent(kind, d.id, d.data() as Record<string, unknown>)
        if (parsed) live.events.set(d.id, parsed)
      }
      emit()
    })
  }

  const cpCol = kind === 'provider' ? PROVIDER_DEBT_CHECKPOINTS_COL : CUSTOMER_DEBT_CHECKPOINTS_COL
  parents.push(onSnapshot(collection(firestore, 'licenses', LICENSE_KEY, cpCol), snap => {
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      const entityId = typeof data['entityId'] === 'string' ? data['entityId'] : ''
      const storeId = typeof data['storeId'] === 'string' ? data['storeId'] : ''
      if (!entityId || !storeId) continue
      bind(parseCheckpointData(kind, entityId, storeId, data))
    }
  }))

  parents.push(onSnapshot(collection(firestore, 'licenses', LICENSE_KEY, DEBT_CHECKPOINT_TAILS_COL), snap => {
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      if (data['kind'] !== kind) continue
      const entityId = typeof data['entityId'] === 'string' ? data['entityId'] : ''
      const storeId = typeof data['storeId'] === 'string' ? data['storeId'] : ''
      if (!entityId || !storeId) continue
      if (children.has(pairKey(kind, entityId, storeId))) continue
      bind(emptyCheckpoint(kind, entityId, storeId))
    }
  }))

  return () => {
    for (const child of children.values()) child.unsub?.()
    children.clear()
    for (const u of parents) u()
  }
}
