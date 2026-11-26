/**
 * Historial visible de un proveedor: el saldo ya plegado y solo lo posterior.
 * Los eventos locales sin subir se suman aunque no estén en la cola remota.
 */

export interface ProviderAccountOpening {
  storeId: string
  balance: number
  hasCheckpoint: boolean
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

export function mergeProviderAccountTails(input: {
  slices: Array<{
    storeId: string
    openingBalance: number
    hasCheckpoint: boolean
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
      openings.push({ storeId: event.storeId, balance: 0, hasCheckpoint: false })
    }
  }

  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  return { openings, events }
}
