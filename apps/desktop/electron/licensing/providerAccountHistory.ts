/**
 * Historial visible de un proveedor: el saldo ya plegado y solo lo posterior.
 * Los eventos locales sin subir se suman aunque no estén en la cola remota.
 * Las visitas confirmadas se leen aparte: un pago en el momento no deja deuda.
 */
import { createdAtInsideCheckpoint, type TsRank } from '@carniceria/shared'

export interface ProviderAccountOpening {
  storeId: string
  balance: number
  hasCheckpoint: boolean
  checkpointAt: TsRank | null
}

export interface ProviderAccountEvent {
  id: string
  type: 'debt' | 'payment'
  amount: number
  storeId: string
  createdAt: string
  createdBy: string
  expenseId: string | null
  notes: string | null
}

/** Visita confirmada. El cargo es la mercadería; el abono, lo pagado en el momento. */
export interface ProviderAccountVisit {
  id: string
  storeId: string
  createdAt: string
  createdBy: string
  paidAmount: number
  debtAmount: number
  expenseId: string | null
  concept: string
}

export interface ProviderNotebookLine extends ProviderAccountEvent {
  role: 'cargo' | 'abono' | 'debt' | 'debt-moved'
  /** 0 cargo, 1 abono de la visita, 2 el resto. Desempata el mismo instante. */
  sequence: number
  intakeId: string | null
  intakeCreatedAt: string | null
  concept: string | null
  /** La deuda de esta visita se anotó en otro local. */
  remainderStoreId: string | null
}

export function mergeProviderAccountTails(input: {
  slices: Array<{
    storeId: string
    openingBalance: number
    hasCheckpoint: boolean
    checkpointAt?: TsRank | null
    events: ProviderAccountEvent[]
  }>
  unsynced: ProviderAccountEvent[]
}): { openings: ProviderAccountOpening[]; events: ProviderAccountEvent[] } {
  const seen = new Set<string>()
  const events: ProviderAccountEvent[] = []
  const openings: ProviderAccountOpening[] = []

  for (const slice of input.slices) {
    if (slice.hasCheckpoint || slice.events.length > 0) {
      openings.push({
        storeId: slice.storeId,
        balance: slice.openingBalance,
        hasCheckpoint: slice.hasCheckpoint,
        checkpointAt: slice.checkpointAt ?? null,
      })
    }
    for (const event of slice.events) {
      if (seen.has(event.id)) continue
      seen.add(event.id)
      events.push(event)
    }
  }

  for (const event of input.unsynced) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    events.push(event)
    if (!openings.some(row => row.storeId === event.storeId)) {
      openings.push({ storeId: event.storeId, balance: 0, hasCheckpoint: false, checkpointAt: null })
    }
  }

  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  return { openings, events }
}

function notebookBalance(lines: ProviderNotebookLine[]): number {
  return lines.reduce((sum, line) => sum + (line.type === 'debt' ? line.amount : -line.amount), 0)
}

/**
 * Arma el cuaderno sin escribir deuda nueva.
 * Una visita reemplaza a su evento de deuda: cargo de la mercadería y,
 * si se pagó en el momento, el abono. Un pago de deuda vieja queda como está.
 * El saldo final es el de los eventos de origen.
 */
export function weaveProviderVisits(input: {
  events: ProviderAccountEvent[]
  visits: ProviderAccountVisit[]
  checkpoints?: Array<{ storeId: string; checkpointAt: TsRank | null }>
}): ProviderNotebookLine[] {
  const checkpointOf = new Map((input.checkpoints ?? []).map(row => [row.storeId, row.checkpointAt]))
  const skipped = new Set<string>()
  const visitOfDebt = new Map<string, ProviderAccountVisit>()
  const synthetic: ProviderNotebookLine[] = []

  for (const visit of input.visits) {
    const merchandise = visit.paidAmount + visit.debtAmount
    if (merchandise <= 0) continue
    if (createdAtInsideCheckpoint(visit.createdAt, checkpointOf.get(visit.storeId) ?? null)) continue

    const debt = visit.expenseId
      ? input.events.find(event =>
        event.type === 'debt' && event.expenseId === visit.expenseId && !skipped.has(event.id),
      )
      : undefined
    const debtElsewhere = debt != null && debt.storeId !== visit.storeId && visit.debtAmount > 0

    synthetic.push({
      id: `visit:${visit.id}`,
      type: 'debt',
      amount: merchandise,
      storeId: visit.storeId,
      createdAt: visit.createdAt,
      createdBy: visit.createdBy,
      expenseId: visit.expenseId,
      notes: null,
      role: 'cargo',
      sequence: 0,
      intakeId: visit.id,
      intakeCreatedAt: visit.createdAt,
      concept: visit.concept,
      remainderStoreId: null,
    })
    if (visit.paidAmount > 0) {
      synthetic.push({
        id: `visit-paid:${visit.id}`,
        type: 'payment',
        amount: visit.paidAmount,
        storeId: visit.storeId,
        createdAt: visit.createdAt,
        createdBy: visit.createdBy,
        expenseId: visit.expenseId,
        notes: null,
        role: 'abono',
        sequence: 1,
        intakeId: null,
        intakeCreatedAt: null,
        concept: null,
        remainderStoreId: null,
      })
    }
    if (debt && !debtElsewhere) skipped.add(debt.id)
    if (debt && debtElsewhere) {
      visitOfDebt.set(debt.id, visit)
      synthetic.push({
        id: `visit-debt-at:${visit.id}`,
        type: 'payment',
        amount: visit.debtAmount,
        storeId: visit.storeId,
        createdAt: visit.createdAt,
        createdBy: visit.createdBy,
        expenseId: visit.expenseId,
        notes: null,
        role: 'debt-moved',
        sequence: 2,
        intakeId: null,
        intakeCreatedAt: null,
        concept: null,
        remainderStoreId: debt.storeId,
      })
    }
  }

  const kept: ProviderNotebookLine[] = input.events.filter(event => !skipped.has(event.id)).map(event => {
    const visit = visitOfDebt.get(event.id)
    return {
      ...event,
      role: event.type === 'payment' ? 'abono' : 'debt',
      sequence: 3,
      intakeId: visit?.id ?? null,
      intakeCreatedAt: visit?.createdAt ?? null,
      concept: null,
      remainderStoreId: null,
    }
  })

  const lines = [...kept, ...synthetic]
  lines.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.sequence - a.sequence || b.id.localeCompare(a.id))
  return lines
}

/** El cuaderno no puede mover el saldo que ya daban los eventos. */
export function providerNotebookMatchesLedger(
  events: ProviderAccountEvent[],
  lines: ProviderNotebookLine[],
): boolean {
  const ledger = events.reduce((sum, event) => sum + (event.type === 'debt' ? event.amount : -event.amount), 0)
  return notebookBalance(lines) === ledger
}
