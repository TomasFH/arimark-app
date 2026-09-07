/**
 * Job único de compactación de checkpoints (DT-07).
 *
 * Solo corre en el proceso main de una PC (nunca en el celu). Un lease en
 * Firestore evita que 3 PCs paguen las mismas ~800 lecturas por pasada.
 *
 * Worklist: docs de `debtCheckpointTails` (pares con actividad real),
 * filtrados contra el checkpoint y el corte de 5 días. Tope de pasadas y
 * de lecturas por corrida: el backlog sobrante espera a la siguiente.
 */
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import log from 'electron-log'
import {
  CHECKPOINT_FOLD_LIMIT,
  CHECKPOINT_JOB_MAX_PASSES,
  CHECKPOINT_JOB_MAX_READS,
  CHECKPOINT_JOB_MIN_INTERVAL_MS,
  CHECKPOINT_LEASE_MS,
  DEBT_CHECKPOINT_JOB_COL,
  DEBT_CHECKPOINT_JOB_DOC,
  DEBT_CHECKPOINT_TAILS_COL,
  DEBT_EVENT_SERVER_TS_FIELD,
  checkpointCutoffRank,
  checkpointCollection,
  debtCheckpointDocId,
  debtEventsCollection,
  entityIdField,
  pairHasPendingFold,
  parseCheckpointData,
  timestampToRank,
  type DebtCheckpointKind,
} from '@carniceria/shared'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { getSecret, SECRET_KEYS } from '../secureStorage'
import { advanceDebtCheckpoint } from './debtCheckpoint'

const TICK_MS = 30 * 60 * 1000

let tickTimer: ReturnType<typeof setInterval> | null = null
let running = false

export interface DebtCheckpointJobResult {
  status: 'skipped' | 'noop' | 'ran' | 'lease-held'
  reason?: string
  passes: number
  reads: number
  folded: number
  pendingPairs: number
  capped: boolean
}

export interface RunDebtCheckpointJobInput {
  tenantId: string
  holderId: string
  nowMs?: number
  firestore?: Firestore
  maxPasses?: number
  maxReads?: number
}

function jobRef(firestore: Firestore, tenantId: string) {
  return doc(firestore, 'licenses', tenantId, DEBT_CHECKPOINT_JOB_COL, DEBT_CHECKPOINT_JOB_DOC)
}

function checkpointRef(
  firestore: Firestore,
  tenantId: string,
  kind: DebtCheckpointKind,
  entityId: string,
  storeId: string,
) {
  return doc(
    firestore,
    'licenses',
    tenantId,
    checkpointCollection(kind),
    debtCheckpointDocId(entityId, storeId),
  )
}

function parseKind(raw: unknown): DebtCheckpointKind | null {
  return raw === 'provider' || raw === 'customer' ? raw : null
}

async function tryAcquireLease(
  firestore: Firestore,
  tenantId: string,
  holderId: string,
  nowMs: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ref = jobRef(firestore, tenantId)
  try {
    return await runTransaction(firestore, async tx => {
      const snap = await tx.get(ref)
      const data = snap.exists() ? snap.data() as Record<string, unknown> : {}
      const lastSuccessAt = timestampToRank(data['lastSuccessAt'])
      if (lastSuccessAt && (nowMs - lastSuccessAt.seconds * 1000) < CHECKPOINT_JOB_MIN_INTERVAL_MS) {
        return { ok: false as const, reason: 'interval' }
      }
      const leaseUntil = timestampToRank(data['leaseUntil'])
      const holder = typeof data['leaseHolder'] === 'string' ? data['leaseHolder'] : null
      if (leaseUntil && leaseUntil.seconds * 1000 > nowMs && holder && holder !== holderId) {
        return { ok: false as const, reason: 'lease-held' }
      }
      tx.set(ref, {
        leaseHolder: holderId,
        leaseUntil: Timestamp.fromMillis(nowMs + CHECKPOINT_LEASE_MS),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      return { ok: true as const }
    })
  } catch (err) {
    log.warn('[debtCheckpointJob] No se pudo tomar el lease', err)
    return { ok: false, reason: 'lease-error' }
  }
}

async function releaseLease(
  firestore: Firestore,
  tenantId: string,
  holderId: string,
  nowMs: number,
  extra: { lastError?: string | null },
): Promise<void> {
  const ref = jobRef(firestore, tenantId)
  await runTransaction(firestore, async tx => {
    const snap = await tx.get(ref)
    const holder = snap.exists() ? snap.data()?.['leaseHolder'] : null
    if (holder !== holderId) return
    tx.set(ref, {
      leaseHolder: holderId,
      leaseUntil: Timestamp.fromMillis(nowMs - 1000),
      lastSuccessAt: Timestamp.fromMillis(nowMs),
      lastError: extra.lastError ?? null,
      updatedAt: serverTimestamp(),
    }, { merge: true })
  })
}

interface WorkPair {
  kind: DebtCheckpointKind
  entityId: string
  storeId: string
}

function parseTail(d: QueryDocumentSnapshot): WorkPair | null {
  const data = d.data() as Record<string, unknown>
  const kind = parseKind(data['kind'])
  const entityId = typeof data['entityId'] === 'string' ? data['entityId'] : ''
  const storeId = typeof data['storeId'] === 'string' ? data['storeId'] : ''
  if (!kind || !entityId || !storeId) return null
  return { kind, entityId, storeId }
}

async function pairStillPending(
  firestore: Firestore,
  tenantId: string,
  pair: WorkPair,
  cutoff: ReturnType<typeof checkpointCutoffRank>,
  tailData: Record<string, unknown>,
): Promise<{ pending: boolean; reads: number }> {
  const firstEventAt = timestampToRank(tailData['firstEventAt'])
  const lastEventAt = timestampToRank(tailData['lastEventAt'])
  const cpSnap = await getDoc(checkpointRef(firestore, tenantId, pair.kind, pair.entityId, pair.storeId))
  const checkpoint = parseCheckpointData(
    pair.kind,
    pair.entityId,
    pair.storeId,
    cpSnap.exists() ? cpSnap.data() as Record<string, unknown> : undefined,
  )
  if (!pairHasPendingFold({
    firstEventAt,
    lastEventAt,
    checkpointAt: checkpoint.checkpointAt,
    cutoff,
  })) {
    return { pending: false, reads: 1 }
  }

  const idField = entityIdField(pair.kind)
  const eventsRef = collection(firestore, 'licenses', tenantId, debtEventsCollection(pair.kind))
  const constraints = [
    where(idField, '==', pair.entityId),
    where('storeId', '==', pair.storeId),
    where(DEBT_EVENT_SERVER_TS_FIELD, '<=', new Timestamp(cutoff.seconds, cutoff.nanos)),
    orderBy(DEBT_EVENT_SERVER_TS_FIELD, 'asc'),
    limit(1),
  ]
  if (checkpoint.checkpointAt) {
    constraints.splice(
      2,
      0,
      where(DEBT_EVENT_SERVER_TS_FIELD, '>', new Timestamp(checkpoint.checkpointAt.seconds, checkpoint.checkpointAt.nanos)),
    )
  }
  const probe = await getDocs(query(eventsRef, ...constraints))
  return { pending: !probe.empty, reads: 1 + 1 + probe.size }
}

/**
 * Una corrida: toma lease, filtra tails con actividad compactable, drena
 * hasta el tope de pasadas/lecturas.
 */
export async function runDebtCheckpointJob(
  input: RunDebtCheckpointJobInput,
): Promise<DebtCheckpointJobResult> {
  const empty: DebtCheckpointJobResult = {
    status: 'skipped',
    passes: 0,
    reads: 0,
    folded: 0,
    pendingPairs: 0,
    capped: false,
  }
  if (!isFirebaseAvailable() && !input.firestore) {
    return { ...empty, reason: 'no-firebase' }
  }

  const firestore = input.firestore ?? getFirestore(getFirebaseApp())
  const nowMs = input.nowMs ?? Date.now()
  const maxPasses = input.maxPasses ?? CHECKPOINT_JOB_MAX_PASSES
  const maxReads = input.maxReads ?? CHECKPOINT_JOB_MAX_READS

  const lease = await tryAcquireLease(firestore, input.tenantId, input.holderId, nowMs)
  if (!lease.ok) {
    return {
      ...empty,
      status: lease.reason === 'lease-held' ? 'lease-held' : 'skipped',
      reason: lease.reason,
    }
  }

  let reads = 1
  let passes = 0
  let folded = 0
  let lastError: string | null = null
  let capped = false

  try {
    const cutoff = checkpointCutoffRank(nowMs)
    const tailsSnap = await getDocs(
      collection(firestore, 'licenses', input.tenantId, DEBT_CHECKPOINT_TAILS_COL),
    )
    reads += Math.max(1, tailsSnap.size)

    const work: WorkPair[] = []
    for (const d of tailsSnap.docs) {
      const pair = parseTail(d)
      if (!pair) continue
      const probe = await pairStillPending(firestore, input.tenantId, pair, cutoff, d.data() as Record<string, unknown>)
      reads += probe.reads
      if (probe.pending) work.push(pair)
      if (reads >= maxReads) {
        capped = true
        break
      }
    }

    for (const pair of work) {
      if (passes >= maxPasses || reads >= maxReads) {
        capped = true
        break
      }
      const result = await advanceDebtCheckpoint({
        tenantId: input.tenantId,
        kind: pair.kind,
        entityId: pair.entityId,
        storeId: pair.storeId,
        nowMs,
        firestore,
      })
      passes += 1
      reads += result.reads
      if (result.status === 'advanced') folded += result.folded

      if (result.status === 'advanced' && result.folded >= CHECKPOINT_FOLD_LIMIT) {
        if (passes >= maxPasses || reads >= maxReads) {
          capped = true
        } else {
          const again = await advanceDebtCheckpoint({
            tenantId: input.tenantId,
            kind: pair.kind,
            entityId: pair.entityId,
            storeId: pair.storeId,
            nowMs,
            firestore,
          })
          passes += 1
          reads += again.reads
          if (again.status === 'advanced') folded += again.folded
          if (again.status === 'advanced' && again.folded >= CHECKPOINT_FOLD_LIMIT) {
            capped = true
          }
        }
      }
    }

    const leftover = work.length > passes
    if (leftover) capped = true

    await releaseLease(firestore, input.tenantId, input.holderId, nowMs, { lastError })
    return {
      status: work.length === 0 && passes === 0 ? 'noop' : 'ran',
      passes,
      reads,
      folded,
      pendingPairs: work.length,
      capped,
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    log.error('[debtCheckpointJob] Falló la corrida', err)
    try {
      await releaseLease(firestore, input.tenantId, input.holderId, nowMs, { lastError })
    } catch (releaseErr) {
      log.warn('[debtCheckpointJob] No se pudo soltar el lease', releaseErr)
    }
    throw err
  }
}

export function resolveJobHolderId(): string {
  try {
    return getSecret(SECRET_KEYS.FIREBASE_ANON_UID) ?? 'desktop-unknown'
  } catch {
    return 'desktop-unknown'
  }
}

export function startDebtCheckpointJob(tenantId: string): void {
  if (!isFirebaseAvailable()) return
  if (tickTimer) return

  const kick = (): void => {
    if (running) return
    running = true
    const holderId = resolveJobHolderId()
    runDebtCheckpointJob({ tenantId, holderId })
      .then(result => {
        log.info('[debtCheckpointJob] Corrida', result)
      })
      .catch(err => {
        log.warn('[debtCheckpointJob] Error (no bloqueante)', err)
      })
      .finally(() => {
        running = false
      })
  }

  setTimeout(kick, 15_000)
  tickTimer = setInterval(kick, TICK_MS)
  log.info('[debtCheckpointJob] Scheduler iniciado')
}

export function stopDebtCheckpointJob(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}
