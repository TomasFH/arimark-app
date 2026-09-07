/**
 * Avance de checkpoint de deuda en Firestore (DT-07 / DT-08).
 *
 * No se cablea a pantallas ni listeners en este cambio: solo el esquema
 * de escritura y `advanceDebtCheckpoint`.
 *
 * Documento:
 *   licenses/{tenant}/providerDebtCheckpoints/{entityId}__{storeId}
 *   licenses/{tenant}/customerDebtCheckpoints/{entityId}__{storeId}
 *
 *   {
 *     kind, entityId, storeId,
 *     saldoAcumulado: number,
 *     checkpointAt: Timestamp,   // frontera = createdAtServer del último evento plegado
 *     updatedAt: serverTimestamp(),
 *     foldedCount: number
 *   }
 *
 * Eventos nuevos (contrato de write, a aplicar en los setDoc):
 *   createdAtServer: serverTimestamp()
 *
 * Transacción:
 *   1. Query fuera del tx: eventos con createdAtServer > checkpointAt
 *      y createdAtServer <= now−5d, limit 400.
 *   2. runTransaction: relee checkpoint; si la frontera cambió, conflict.
 *      Relee cada evento candidato (lock). Pliega. Escribe checkpoint.
 *   Firestore no permite queries dentro de runTransaction; por eso el query
 *   va afuera y el tx revalida cada doc.
 */

import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore'
import {
  CHECKPOINT_FOLD_LIMIT,
  DEBT_EVENT_SERVER_TS_FIELD,
  checkpointCollection,
  checkpointCutoffRank,
  debtCheckpointDocId,
  debtEventsCollection,
  emptyCheckpoint,
  entityIdField,
  estimateAdvanceReads,
  foldEventsIntoCheckpoint,
  parseCheckpointData,
  parseCompactableEvent,
  ranksEqual,
  timestampToRank,
  type DebtCheckpointFields,
  type DebtCheckpointKind,
  type TsRank,
} from '@carniceria/shared'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'

export class CheckpointConflictError extends Error {
  constructor() {
    super('CHECKPOINT_CONFLICT')
    this.name = 'CheckpointConflictError'
  }
}

export type AdvanceDebtCheckpointResult =
  | { status: 'noop'; checkpoint: DebtCheckpointFields; reads: number }
  | { status: 'advanced'; checkpoint: DebtCheckpointFields; folded: number; reads: number }

export interface AdvanceDebtCheckpointInput {
  tenantId: string
  kind: DebtCheckpointKind
  entityId: string
  storeId: string
  nowMs?: number
  firestore?: Firestore
}

function rankToTimestamp(rank: TsRank): Timestamp {
  return new Timestamp(rank.seconds, rank.nanos)
}

function checkpointRef(firestore: Firestore, tenantId: string, kind: DebtCheckpointKind, entityId: string, storeId: string) {
  return doc(
    firestore,
    'licenses',
    tenantId,
    checkpointCollection(kind),
    debtCheckpointDocId(entityId, storeId),
  )
}

function eventsCol(firestore: Firestore, tenantId: string, kind: DebtCheckpointKind) {
  return collection(firestore, 'licenses', tenantId, debtEventsCollection(kind))
}

/** Campos de servidor que todo evento nuevo debe incluir en setDoc. */
export function debtEventServerTimestampFields(): { createdAtServer: ReturnType<typeof serverTimestamp> } {
  return { createdAtServer: serverTimestamp() }
}

export function buildCheckpointWritePayload(checkpoint: DebtCheckpointFields): Record<string, unknown> {
  return {
    kind: checkpoint.kind,
    entityId: checkpoint.entityId,
    storeId: checkpoint.storeId,
    saldoAcumulado: checkpoint.saldoAcumulado,
    checkpointAt: checkpoint.checkpointAt ? rankToTimestamp(checkpoint.checkpointAt) : null,
    updatedAt: serverTimestamp(),
    foldedCount: checkpoint.foldedCount,
  }
}

/**
 * Una pasada (hasta CHECKPOINT_FOLD_LIMIT eventos). Si folded === limit,
 * el caller puede volver a invocar hasta drenar.
 */
export async function advanceDebtCheckpoint(
  input: AdvanceDebtCheckpointInput,
  attempt = 0,
): Promise<AdvanceDebtCheckpointResult> {
  if (!isFirebaseAvailable() && !input.firestore) {
    return { status: 'noop', checkpoint: emptyCheckpoint(input.kind, input.entityId, input.storeId), reads: 0 }
  }

  const firestore = input.firestore ?? getFirestore(getFirebaseApp())
  const nowMs = input.nowMs ?? Date.now()
  const cutoff = checkpointCutoffRank(nowMs)
  const cpRef = checkpointRef(firestore, input.tenantId, input.kind, input.entityId, input.storeId)

  const cpSnap = await getDoc(cpRef)
  const expected = parseCheckpointData(
    input.kind,
    input.entityId,
    input.storeId,
    cpSnap.exists() ? cpSnap.data() as Record<string, unknown> : undefined,
  )

  const idField = entityIdField(input.kind)
  const constraints: QueryConstraint[] = [
    where(idField, '==', input.entityId),
    where('storeId', '==', input.storeId),
    where(DEBT_EVENT_SERVER_TS_FIELD, '<=', rankToTimestamp(cutoff)),
    orderBy(DEBT_EVENT_SERVER_TS_FIELD, 'asc'),
    limit(CHECKPOINT_FOLD_LIMIT),
  ]
  if (expected.checkpointAt) {
    constraints.splice(
      2,
      0,
      where(DEBT_EVENT_SERVER_TS_FIELD, '>', rankToTimestamp(expected.checkpointAt)),
    )
  }

  const snap = await getDocs(query(eventsCol(firestore, input.tenantId, input.kind), ...constraints))
  const queryReads = 1 + snap.size
  if (snap.empty) {
    return { status: 'noop', checkpoint: expected, reads: 1 + queryReads }
  }

  try {
    return await runTransaction(firestore, async tx => {
      const freshSnap = await tx.get(cpRef)
      const current = parseCheckpointData(
        input.kind,
        input.entityId,
        input.storeId,
        freshSnap.exists() ? freshSnap.data() as Record<string, unknown> : undefined,
      )
      if (!ranksEqual(current.checkpointAt, expected.checkpointAt)) {
        throw new CheckpointConflictError()
      }

      const events = []
      for (const d of snap.docs) {
        const locked = await tx.get(d.ref)
        if (!locked.exists()) continue
        const parsed = parseCompactableEvent(input.kind, locked.id, locked.data() as Record<string, unknown>)
        if (!parsed) continue
        events.push(parsed)
      }

      const folded = foldEventsIntoCheckpoint({
        kind: input.kind,
        current,
        cutoff,
        events,
      })
      if (folded.folded === 0) {
        return {
          status: 'noop' as const,
          checkpoint: current,
          reads: estimateAdvanceReads(snap.size),
        }
      }

      tx.set(cpRef, buildCheckpointWritePayload(folded.next), { merge: true })
      return {
        status: 'advanced' as const,
        checkpoint: folded.next,
        folded: folded.folded,
        reads: estimateAdvanceReads(snap.size),
      }
    })
  } catch (err) {
    if (err instanceof CheckpointConflictError && attempt < 3) {
      return advanceDebtCheckpoint(input, attempt + 1)
    }
    throw err
  }
}

export function timestampFromRankForTests(rank: TsRank): Timestamp {
  return rankToTimestamp(rank)
}

export { timestampToRank }
