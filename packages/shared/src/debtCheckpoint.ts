/**
 * Checkpoint de saldo (DT-07 / DT-08) — lógica pura, sin Firebase.
 *
 * Un documento por (proveedor|cliente + local). El saldo vigente es
 * `saldoAcumulado` + eventos con `createdAtServer` estrictamente posterior
 * a `checkpointAt`. Los eventos no se borran.
 *
 * `checkpointAt` es la frontera de compactación (Timestamp de servidor del
 * último evento ya sumado), no el instante en que corrimos la transacción.
 * Si fuera `now`, los eventos de los últimos 5 días nunca entrarían al saldo.
 *
 * Margen de 5 días: no se pliegan eventos con createdAtServer > (now − 5d).
 * Cubre sync offline: un gasto hecho ayer puede subirse hoy con Timestamp
 * de servidor de hoy; no debe quedar “atrás” de un checkpoint escrito anoche
 * con reloj de cliente.
 *
 * Reloj de negocio vs servidor:
 * - `createdAt` (ISO del cliente) sigue existiendo para mostrar “qué día fue”.
 * - `createdAtServer` (Timestamp de servidor) es el único campo de ordenamiento
 *   del checkpoint. Los eventos nuevos tienen que escribirlo con serverTimestamp().
 */

export const DEBT_EVENT_SERVER_TS_FIELD = 'createdAtServer' as const

export const CHECKPOINT_SAFETY_MS = 5 * 24 * 60 * 60 * 1000

/** Tope por transacción (límite Firestore ~500 docs; dejamos holgura). */
export const CHECKPOINT_FOLD_LIMIT = 400

export const PROVIDER_DEBT_EVENTS_COL = 'providerDebtEvents'
export const CUSTOMER_DEBT_EVENTS_COL = 'customerDebtEvents'
export const PROVIDER_DEBT_CHECKPOINTS_COL = 'providerDebtCheckpoints'
export const CUSTOMER_DEBT_CHECKPOINTS_COL = 'customerDebtCheckpoints'
export const DEBT_CHECKPOINT_TAILS_COL = 'debtCheckpointTails'
export const DEBT_CHECKPOINT_JOB_COL = 'ops'
export const DEBT_CHECKPOINT_JOB_DOC = 'debtCheckpointJob'

/** Pasadas de `advanceDebtCheckpoint` por corrida del job (1 pasada ≤ 400 eventos). */
export const CHECKPOINT_JOB_MAX_PASSES = 8

/**
 * Tope de lecturas estimadas por corrida (query + relecturas del tx).
 * La primera corrida post-backfill deja el resto del backlog para mañana.
 */
export const CHECKPOINT_JOB_MAX_READS = 4000

export const CHECKPOINT_JOB_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000
export const CHECKPOINT_LEASE_MS = 15 * 60 * 1000

export type DebtCheckpointKind = 'provider' | 'customer'

/** Orden total de un Timestamp de Firestore (seconds + nanoseconds). */
export interface TsRank {
  seconds: number
  nanos: number
}

export interface DebtCheckpointFields {
  kind: DebtCheckpointKind
  entityId: string
  storeId: string
  saldoAcumulado: number
  /** Frontera: last createdAtServer plegado. Null = todavía no se plegó nada. */
  checkpointAt: TsRank | null
  foldedCount: number
}

export type ProviderDebtEventType = 'debt' | 'payment'

const CUSTOMER_CHARGE = new Set<string>(['created', 'debt', 'reopened'])
const CUSTOMER_PAYMENT = new Set<string>(['partial_payment', 'paid', 'cancelled'])

export function debtCheckpointDocId(entityId: string, storeId: string): string {
  const clean = (s: string) => s.replace(/\//g, '_')
  return `${clean(entityId)}__${clean(storeId)}`
}

export function checkpointCollection(kind: DebtCheckpointKind): string {
  return kind === 'provider' ? PROVIDER_DEBT_CHECKPOINTS_COL : CUSTOMER_DEBT_CHECKPOINTS_COL
}

export function debtEventsCollection(kind: DebtCheckpointKind): string {
  return kind === 'provider' ? PROVIDER_DEBT_EVENTS_COL : CUSTOMER_DEBT_EVENTS_COL
}

export function entityIdField(kind: DebtCheckpointKind): 'providerId' | 'customerId' {
  return kind === 'provider' ? 'providerId' : 'customerId'
}

export function msToTsRank(ms: number): TsRank {
  const seconds = Math.floor(ms / 1000)
  const nanos = Math.floor((ms % 1000) * 1e6)
  return { seconds, nanos }
}

export function checkpointCutoffRank(nowMs: number): TsRank {
  return msToTsRank(nowMs - CHECKPOINT_SAFETY_MS)
}

export function compareTsRank(a: TsRank, b: TsRank): number {
  if (a.seconds !== b.seconds) return a.seconds - b.seconds
  return a.nanos - b.nanos
}

export function ranksEqual(a: TsRank | null, b: TsRank | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return a.seconds === b.seconds && a.nanos === b.nanos
}

export function maxTsRank(a: TsRank, b: TsRank): TsRank {
  return compareTsRank(a, b) >= 0 ? a : b
}

/**
 * ¿Este evento puede plegarse al saldo acumulado?
 * Estrictamente posterior al checkpoint y no más nuevo que el corte de 5 días.
 */
export function eventBelongsInCheckpoint(
  eventAt: TsRank,
  checkpointAt: TsRank | null,
  cutoff: TsRank,
): boolean {
  if (compareTsRank(eventAt, cutoff) > 0) return false
  if (checkpointAt == null) return true
  return compareTsRank(eventAt, checkpointAt) > 0
}

export function applyProviderEventToSaldo(
  saldo: number,
  type: ProviderDebtEventType,
  amount: number,
): number {
  const amt = Math.abs(amount)
  return type === 'debt' ? saldo + amt : saldo - amt
}

export function applyCustomerEventToSaldo(
  saldo: number,
  eventType: string,
  amount: number,
): number {
  const amt = Math.abs(amount)
  if (CUSTOMER_CHARGE.has(eventType)) return saldo + amt
  if (CUSTOMER_PAYMENT.has(eventType)) return saldo - amt
  return saldo + amount
}

export interface CompactableDebtEvent {
  id: string
  serverAt: TsRank
  deleted?: boolean
  providerType?: ProviderDebtEventType
  customerEventType?: string
  amount: number
}

export interface FoldCheckpointInput {
  kind: DebtCheckpointKind
  current: DebtCheckpointFields
  cutoff: TsRank
  events: CompactableDebtEvent[]
}

export interface FoldCheckpointResult {
  next: DebtCheckpointFields
  folded: number
}

/**
 * Aplica candidatos ya leídos (la transacción Firestore re-valida cada doc).
 * No muta `current`. Eventos deleted o fuera de ventana se ignoran.
 */
export function foldEventsIntoCheckpoint(input: FoldCheckpointInput): FoldCheckpointResult {
  let saldo = input.current.saldoAcumulado
  let checkpointAt = input.current.checkpointAt
  let foldedCount = input.current.foldedCount
  let folded = 0

  const sorted = [...input.events].sort((a, b) => {
    const cmp = compareTsRank(a.serverAt, b.serverAt)
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
  })

  for (const ev of sorted) {
    if (!eventBelongsInCheckpoint(ev.serverAt, checkpointAt, input.cutoff)) continue

    // Deleted no cambia el saldo, pero sí consume la frontera. Si no,
    // el próximo avance volvería a leer el mismo doc para siempre.
    if (ev.deleted !== true) {
      if (input.kind === 'provider') {
        const type = ev.providerType === 'payment' ? 'payment' : 'debt'
        saldo = applyProviderEventToSaldo(saldo, type, ev.amount)
      } else {
        saldo = applyCustomerEventToSaldo(saldo, ev.customerEventType ?? 'created', ev.amount)
      }
    }

    checkpointAt = checkpointAt == null ? ev.serverAt : maxTsRank(checkpointAt, ev.serverAt)
    foldedCount += 1
    folded += 1
  }

  return {
    folded,
    next: {
      kind: input.kind,
      entityId: input.current.entityId,
      storeId: input.current.storeId,
      saldoAcumulado: saldo,
      checkpointAt,
      foldedCount,
    },
  }
}

export function emptyCheckpoint(
  kind: DebtCheckpointKind,
  entityId: string,
  storeId: string,
): DebtCheckpointFields {
  return {
    kind,
    entityId,
    storeId,
    saldoAcumulado: 0,
    checkpointAt: null,
    foldedCount: 0,
  }
}

export function timestampToRank(value: unknown): TsRank | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return msToTsRank(value)
  if (value instanceof Date) return msToTsRank(value.getTime())
  if (typeof value === 'object') {
    const rec = value as {
      toMillis?: () => number
      seconds?: number
      nanoseconds?: number
    }
    if (typeof rec.seconds === 'number') {
      return {
        seconds: rec.seconds,
        nanos: typeof rec.nanoseconds === 'number' ? rec.nanoseconds : 0,
      }
    }
    if (typeof rec.toMillis === 'function') return msToTsRank(rec.toMillis())
  }
  return null
}

export function shouldRebindDebtEventsListener(
  previousBound: TsRank | null,
  nextBound: TsRank | null,
): boolean {
  return !ranksEqual(previousBound, nextBound)
}

/**
 * Lecturas aproximadas de una pasada: getDoc checkpoint + getDocs
 * + relock del checkpoint + relock de cada evento del query.
 */
export function estimateAdvanceReads(querySize: number): number {
  return 2 + 2 * Math.max(0, querySize)
}

/**
 * ¿Este par tiene algo que plegar? Compara el último evento contra el
 * checkpoint y exige que el primero sea anterior o igual al corte de 5 días.
 * No mete en el worklist a todos los proveedores/clientes: solo a los que
 * ya tuvieron actividad (un doc de tail) y todavía tienen cola compactable.
 */
export function pairHasPendingFold(input: {
  firstEventAt: TsRank | null
  lastEventAt: TsRank | null
  checkpointAt: TsRank | null
  cutoff: TsRank
}): boolean {
  const { firstEventAt, lastEventAt, checkpointAt, cutoff } = input
  if (firstEventAt == null || lastEventAt == null) return false
  if (checkpointAt != null && compareTsRank(lastEventAt, checkpointAt) <= 0) return false
  return compareTsRank(firstEventAt, cutoff) <= 0
}

export function liveSaldoFromCheckpoint(
  kind: DebtCheckpointKind,
  checkpoint: DebtCheckpointFields,
  events: CompactableDebtEvent[],
): number {
  let saldo = checkpoint.saldoAcumulado
  const sorted = [...events].sort((a, b) => {
    const cmp = compareTsRank(a.serverAt, b.serverAt)
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
  })
  for (const ev of sorted) {
    if (ev.deleted === true) continue
    if (checkpoint.checkpointAt && compareTsRank(ev.serverAt, checkpoint.checkpointAt) <= 0) continue
    if (kind === 'provider') {
      const type = ev.providerType === 'payment' ? 'payment' : 'debt'
      saldo = applyProviderEventToSaldo(saldo, type, ev.amount)
    } else {
      saldo = applyCustomerEventToSaldo(saldo, ev.customerEventType ?? 'created', ev.amount)
    }
  }
  return saldo
}

export type CreatedAtServerBackfillPlan =
  | { action: 'skip'; reason: 'already-has-server-ts' }
  | { action: 'assign'; source: 'createdAt' | 'date'; iso: string; rank: TsRank }
  | { action: 'leave-unset'; reason: 'missing' | 'unparseable'; raw: unknown }

function isoToRank(value: unknown): { iso: string; rank: TsRank } | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const ms = Date.parse(trimmed)
  if (!Number.isFinite(ms)) return null
  return { iso: trimmed, rank: msToTsRank(ms) }
}

/**
 * Plan de backfill de `createdAtServer` para un evento viejo.
 * No usa el reloj de ahora: copia `createdAt` (ISO de negocio) o, si falta,
 * `date`. Si no hay nada parseable, el evento queda SIN createdAtServer
 * (no entra al checkpoint ni al listener de cola).
 */
export function planCreatedAtServerBackfill(data: Record<string, unknown>): CreatedAtServerBackfillPlan {
  if (timestampToRank(data[DEBT_EVENT_SERVER_TS_FIELD]) != null) {
    return { action: 'skip', reason: 'already-has-server-ts' }
  }
  const fromCreated = isoToRank(data['createdAt'])
  if (fromCreated) {
    return { action: 'assign', source: 'createdAt', iso: fromCreated.iso, rank: fromCreated.rank }
  }
  const fromDate = isoToRank(data['date'])
  if (fromDate) {
    return { action: 'assign', source: 'date', iso: fromDate.iso, rank: fromDate.rank }
  }
  const raw = data['createdAt'] ?? data['date'] ?? null
  if (raw == null || raw === '') return { action: 'leave-unset', reason: 'missing', raw }
  return { action: 'leave-unset', reason: 'unparseable', raw }
}

export function parseCompactableEvent(
  kind: DebtCheckpointKind,
  id: string,
  data: Record<string, unknown>,
): CompactableDebtEvent | null {
  const serverAt = timestampToRank(data[DEBT_EVENT_SERVER_TS_FIELD])
  if (serverAt == null) return null
  const amount = typeof data.amount === 'number' ? data.amount : 0
  if (kind === 'provider') {
    return {
      id,
      serverAt,
      deleted: data.deleted === true,
      providerType: data.type === 'payment' ? 'payment' : 'debt',
      amount,
    }
  }
  return {
    id,
    serverAt,
    deleted: data.deleted === true,
    customerEventType: typeof data.eventType === 'string' ? data.eventType : 'created',
    amount,
  }
}

export function parseCheckpointData(
  kind: DebtCheckpointKind,
  entityId: string,
  storeId: string,
  data: Record<string, unknown> | undefined,
): DebtCheckpointFields {
  if (!data) return emptyCheckpoint(kind, entityId, storeId)
  const saldo = typeof data.saldoAcumulado === 'number' ? data.saldoAcumulado : 0
  const foldedCount = typeof data.foldedCount === 'number' ? data.foldedCount : 0
  return {
    kind,
    entityId,
    storeId,
    saldoAcumulado: saldo,
    checkpointAt: timestampToRank(data.checkpointAt),
    foldedCount,
  }
}
