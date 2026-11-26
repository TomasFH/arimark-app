/**
 * Saldo de un cliente en un local: el checkpoint más lo que todavía no
 * se plegó. Es la misma cuenta que el Resumen (liveSaldoFromCheckpoint).
 * Un movimiento local posterior al corte que la cola todavía no tiene
 * se suma una sola vez. Lo ya plegado, aunque siga en SQLite, no se
 * vuelve a sumar.
 *
 * Sin Firebase el libro local es el ledger completo.
 */
import {
  applyCustomerEventToSaldo,
  compareTsRank,
  liveSaldoFromCheckpoint,
  msToTsRank,
  type CompactableDebtEvent,
  type CustomerLivePair,
  type DebtCheckpointFields,
  type TsRank,
} from '@carniceria/shared'

export interface CustomerLedgerEvent {
  id: string
  customerId: string
  storeId: string
  eventType: string
  amount: number
  createdAt: string
  syncedAt: string | null
  saleId: string | null
  dueDate: string | null
  notes: string | null
  paymentMethod: 'cash' | 'debit' | 'wallet' | 'credit' | null
  createdBy: string
}

export interface CustomerRemoteSlice {
  checkpoint: DebtCheckpointFields
  events: CompactableDebtEvent[]
  /** Filas de la cola que esta PC no tiene en SQLite. */
  display: CustomerLedgerEvent[]
}

export interface CustomerStoreLedger {
  customerId: string
  storeId: string
  /** Saldo ya plegado. Cero si no hay corte. */
  openingBalance: number
  balance: number
  events: CustomerLedgerEvent[]
}

const DUST = 0.01

export function isOpenCustomerBalance(balance: number): boolean {
  return Math.abs(balance) > DUST
}

export function signedCustomerAmount(eventType: string, amount: number): number {
  return applyCustomerEventToSaldo(0, eventType, amount)
}

function pairKey(customerId: string, storeId: string): string {
  return `${customerId}\0${storeId}`
}

function afterCheckpoint(createdAt: string, checkpointAt: TsRank | null): boolean {
  if (!checkpointAt) return true
  const ms = Date.parse(createdAt)
  if (!Number.isFinite(ms)) return false
  return compareTsRank(msToTsRank(ms), checkpointAt) > 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function syntheticFromTail(
  customerId: string,
  storeId: string,
  event: CompactableDebtEvent,
): CustomerLedgerEvent {
  const eventType = event.customerEventType ?? 'created'
  return {
    id: event.id,
    customerId,
    storeId,
    eventType,
    amount: signedCustomerAmount(eventType, event.amount),
    createdAt: new Date(event.serverAt.seconds * 1000).toISOString(),
    syncedAt: new Date(event.serverAt.seconds * 1000).toISOString(),
    saleId: null,
    dueDate: null,
    notes: null,
    paymentMethod: null,
    createdBy: '',
  }
}

function sharedLedger(
  customerId: string,
  storeId: string,
  checkpoint: DebtCheckpointFields,
  tail: CompactableDebtEvent[],
  localEvents: CustomerLedgerEvent[],
  remoteDisplay: CustomerLedgerEvent[],
): CustomerStoreLedger {
  const liveIds = new Set(tail.filter(event => event.deleted !== true).map(event => event.id))
  let balance = liveSaldoFromCheckpoint('customer', checkpoint, tail)
  const shown: CustomerLedgerEvent[] = []
  const seen = new Set<string>()
  const localById = new Map(localEvents.map(event => [event.id, event]))

  for (const event of localEvents) {
    if (liveIds.has(event.id)) {
      shown.push(event)
      seen.add(event.id)
      continue
    }
    if (!afterCheckpoint(event.createdAt, checkpoint.checkpointAt)) continue
    balance = applyCustomerEventToSaldo(balance, event.eventType, event.amount)
    shown.push(event)
    seen.add(event.id)
  }

  const extras = new Map(remoteDisplay.map(event => [event.id, event]))
  for (const event of tail) {
    if (event.deleted === true || seen.has(event.id)) continue
    const known = localById.get(event.id) ?? extras.get(event.id) ?? syntheticFromTail(customerId, storeId, event)
    shown.push(known)
    seen.add(event.id)
  }

  shown.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return {
    customerId,
    storeId,
    openingBalance: checkpoint.checkpointAt ? checkpoint.saldoAcumulado : 0,
    balance: roundMoney(balance),
    events: shown,
  }
}

function localLedger(customerId: string, storeId: string, events: CustomerLedgerEvent[]): CustomerStoreLedger {
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const balance = sorted.reduce(
    (sum, event) => applyCustomerEventToSaldo(sum, event.eventType, event.amount),
    0,
  )
  return {
    customerId,
    storeId,
    openingBalance: 0,
    balance: roundMoney(balance),
    events: sorted,
  }
}

/**
 * Un renglón por cliente y local. El filtro de local lo hace quien llama.
 */
export function buildCustomerStoreLedgers(input: {
  firebaseOn: boolean
  pairs: CustomerLivePair[]
  localEvents: CustomerLedgerEvent[]
  remoteByKey?: ReadonlyMap<string, CustomerRemoteSlice>
}): CustomerStoreLedger[] {
  const localByKey = new Map<string, CustomerLedgerEvent[]>()
  for (const event of input.localEvents) {
    const key = pairKey(event.customerId, event.storeId)
    const list = localByKey.get(key)
    if (list) list.push(event)
    else localByKey.set(key, [event])
  }

  const pairByKey = new Map<string, CustomerLivePair>()
  if (input.firebaseOn) {
    for (const pair of input.pairs) {
      if (pair.checkpoint.kind !== 'customer') continue
      pairByKey.set(pairKey(pair.customerId, pair.storeId), pair)
    }
  }

  const keys = new Set<string>([...localByKey.keys(), ...pairByKey.keys()])
  if (input.firebaseOn && input.remoteByKey) {
    for (const key of input.remoteByKey.keys()) keys.add(key)
  }

  const ledgers: CustomerStoreLedger[] = []
  for (const key of keys) {
    const sep = key.indexOf('\0')
    const customerId = key.slice(0, sep)
    const storeId = key.slice(sep + 1)
    const local = localByKey.get(key) ?? []
    const pair = pairByKey.get(key)
    if (input.firebaseOn && pair) {
      ledgers.push(sharedLedger(customerId, storeId, pair.checkpoint, pair.events, local, []))
      continue
    }
    const remote = input.firebaseOn ? input.remoteByKey?.get(key) : undefined
    if (remote) {
      ledgers.push(sharedLedger(
        customerId,
        storeId,
        remote.checkpoint,
        remote.events,
        local,
        remote.display,
      ))
      continue
    }
    ledgers.push(localLedger(customerId, storeId, local))
  }
  return ledgers
}
