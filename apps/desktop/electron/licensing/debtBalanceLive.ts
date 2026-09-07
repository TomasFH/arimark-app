/**
 * Listener padre/hijo de saldo (DT-07).
 *
 * Padre: documentos de checkpoint.
 * Hijo: eventos con createdAtServer > checkpointAt. Si la frontera cambia,
 * se desuscribe el hijo, se vacía la cola y se vuelve a suscribir — nunca
 * se combina un checkpoint nuevo con eventos de la query anterior.
 */
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import log from 'electron-log'
import {
  CUSTOMER_DEBT_CHECKPOINTS_COL,
  CUSTOMER_DEBT_EVENTS_COL,
  DEBT_CHECKPOINT_TAILS_COL,
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
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { applyRemoteProviderDebtEvent } from './providerSync'
import { applyRemoteCustomerDebtEvent } from './customerDebtSync'
import { notifyRenderer } from './notifyRenderer'
import { IPC } from '../ipc/channels'

interface PairChild {
  generation: number
  bound: TsRank | null
  checkpoint: DebtCheckpointFields
  events: Map<string, CompactableDebtEvent>
  unsub: Unsubscribe | null
}

const children = new Map<string, PairChild>()
const unsubs: Unsubscribe[] = []
const saldoCache = new Map<string, number>()

function pairKey(kind: DebtCheckpointKind, entityId: string, storeId: string): string {
  return `${kind}:${debtCheckpointDocId(entityId, storeId)}`
}

function rankToTimestamp(rank: TsRank): Timestamp {
  return new Timestamp(rank.seconds, rank.nanos)
}

function emitPair(key: string, child: PairChild): void {
  const saldo = liveSaldoFromCheckpoint(
    child.checkpoint.kind,
    child.checkpoint,
    [...child.events.values()],
  )
  saldoCache.set(key, saldo)
  notifyRenderer(IPC.DEBT_SYNC_UPDATED)
}

function unbind(key: string): void {
  const child = children.get(key)
  if (!child) return
  child.generation += 1
  try { child.unsub?.() } catch { /* already gone */ }
  children.delete(key)
  saldoCache.delete(key)
}

function bindPair(
  firestore: Firestore,
  tenantId: string,
  checkpoint: DebtCheckpointFields,
): void {
  const key = pairKey(checkpoint.kind, checkpoint.entityId, checkpoint.storeId)
  const bound = checkpoint.checkpointAt
  const existing = children.get(key)
  if (existing && !shouldRebindDebtEventsListener(existing.bound, bound)) {
    existing.checkpoint = checkpoint
    emitPair(key, existing)
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

  const idField = entityIdField(checkpoint.kind)
  const colName = checkpoint.kind === 'provider' ? PROVIDER_DEBT_EVENTS_COL : CUSTOMER_DEBT_EVENTS_COL
  const constraints = [
    where(idField, '==', checkpoint.entityId),
    where('storeId', '==', checkpoint.storeId),
    orderBy(DEBT_EVENT_SERVER_TS_FIELD, 'asc'),
  ]
  if (bound) {
    constraints.splice(2, 0, where(DEBT_EVENT_SERVER_TS_FIELD, '>', rankToTimestamp(bound)))
  }
  const q = query(collection(firestore, 'licenses', tenantId, colName), ...constraints)

  child.unsub = onSnapshot(q, snap => {
    const live = children.get(key)
    if (!live || live.generation !== generation) return
    live.events.clear()
    for (const d of snap.docs) {
      const parsed = parseCompactableEvent(checkpoint.kind, d.id, d.data() as Record<string, unknown>)
      if (parsed) live.events.set(d.id, parsed)
      const data = d.data() as Record<string, unknown>
      if (checkpoint.kind === 'provider') {
        applyRemoteProviderDebtEvent({
          id: (data['id'] as string | undefined) ?? d.id,
          storeId: data['storeId'] as string | undefined,
          providerId: data['providerId'] as string | null | undefined,
          provider: data['provider'] as string | undefined,
          type: data['type'] as 'debt' | 'payment' | undefined,
          amount: data['amount'] as number | undefined,
          expenseId: data['expenseId'] as string | null | undefined,
          shiftId: data['shiftId'] as string | null | undefined,
          createdAt: data['createdAt'] as string | undefined,
          date: data['date'] as string | undefined,
          createdBy: data['createdBy'] as string | undefined,
          deleted: data['deleted'] as boolean | undefined,
          description: data['description'] as string | null | undefined,
          notes: data['notes'] as string | null | undefined,
        }, d.id)
      } else {
        applyRemoteCustomerDebtEvent({
          id: (data['id'] as string | undefined) ?? d.id,
          customerId: data['customerId'] as string,
          saleId: (data['saleId'] as string | null | undefined) ?? null,
          storeId: data['storeId'] as string,
          eventType: data['eventType'] as 'created' | 'debt' | 'partial_payment' | 'paid' | 'cancelled' | 'reopened',
          amount: data['amount'] as number,
          dueDate: (data['dueDate'] as string | null | undefined) ?? null,
          notes: (data['notes'] as string | null | undefined) ?? null,
          paymentMethod: (data['paymentMethod'] as 'cash' | 'debit' | 'wallet' | 'credit' | null | undefined) ?? null,
          shiftId: (data['shiftId'] as string | null | undefined) ?? null,
          createdAt: data['createdAt'] as string | undefined,
          createdBy: data['createdBy'] as string | undefined,
          deleted: data['deleted'] as boolean | undefined,
        }, d.id)
      }
    }
    emitPair(key, live)
  }, err => {
    log.error('[debtBalanceLive] Error en listener de eventos', { key, err })
  })
}

function listenCheckpoints(
  firestore: Firestore,
  tenantId: string,
  kind: DebtCheckpointKind,
): Unsubscribe {
  const colName = kind === 'provider' ? PROVIDER_DEBT_CHECKPOINTS_COL : CUSTOMER_DEBT_CHECKPOINTS_COL
  return onSnapshot(collection(firestore, 'licenses', tenantId, colName), snap => {
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      const entityId = typeof data['entityId'] === 'string' ? data['entityId'] : ''
      const storeId = typeof data['storeId'] === 'string' ? data['storeId'] : ''
      if (!entityId || !storeId) continue
      bindPair(firestore, tenantId, parseCheckpointData(kind, entityId, storeId, data))
    }
  }, err => {
    log.error('[debtBalanceLive] Error en listener de checkpoints', { kind, err })
  })
}

function listenTails(firestore: Firestore, tenantId: string): Unsubscribe {
  return onSnapshot(collection(firestore, 'licenses', tenantId, DEBT_CHECKPOINT_TAILS_COL), snap => {
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>
      const kind = data['kind'] === 'customer' ? 'customer' : data['kind'] === 'provider' ? 'provider' : null
      const entityId = typeof data['entityId'] === 'string' ? data['entityId'] : ''
      const storeId = typeof data['storeId'] === 'string' ? data['storeId'] : ''
      if (!kind || !entityId || !storeId) continue
      const key = pairKey(kind, entityId, storeId)
      if (children.has(key)) continue
      bindPair(firestore, tenantId, emptyCheckpoint(kind, entityId, storeId))
    }
  }, err => {
    log.error('[debtBalanceLive] Error en listener de tails', err)
  })
}

export function startDebtBalanceLiveSync(tenantId: string, firestore?: Firestore): void {
  if (!isFirebaseAvailable() && !firestore) return
  if (unsubs.length > 0) return
  try {
    const db = firestore ?? getFirestore(getFirebaseApp())
    unsubs.push(listenCheckpoints(db, tenantId, 'provider'))
    unsubs.push(listenCheckpoints(db, tenantId, 'customer'))
    unsubs.push(listenTails(db, tenantId))
    log.info('[debtBalanceLive] Listeners de checkpoint iniciados')
  } catch (err) {
    log.error('[debtBalanceLive] No se pudieron iniciar listeners', err)
  }
}

export function stopDebtBalanceLiveSync(): void {
  for (const key of [...children.keys()]) unbind(key)
  for (const u of unsubs) {
    try { u() } catch (err) {
      log.warn('[debtBalanceLive] Error al detener listener', err)
    }
  }
  unsubs.length = 0
  saldoCache.clear()
}

export function getLiveProviderStoreBalances(): Array<{ providerId: string; storeId: string; balance: number }> {
  const out: Array<{ providerId: string; storeId: string; balance: number }> = []
  for (const [key, child] of children) {
    if (child.checkpoint.kind !== 'provider') continue
    const balance = saldoCache.get(key)
    if (balance == null) continue
    out.push({
      providerId: child.checkpoint.entityId,
      storeId: child.checkpoint.storeId,
      balance,
    })
  }
  return out
}

export function getLiveDebtBalance(
  kind: DebtCheckpointKind,
  entityId: string,
  storeId?: string,
): number | null {
  if (storeId) return saldoCache.get(pairKey(kind, entityId, storeId)) ?? null
  let total = 0
  let any = false
  const needle = `${kind}:${entityId.replace(/\//g, '_')}__`
  for (const [key, value] of saldoCache) {
    if (!key.startsWith(needle)) continue
    total += value
    any = true
  }
  return any ? total : null
}
