/**
 * Saldo de un proveedor en un local, el mismo criterio que Admin Hub.
 *
 * Con Firebase: checkpoint + eventos posteriores (listener en memoria, o la
 * lectura de ese par) más lo que esta PC todavía no subió. El historial
 * local ya plegado no se vuelve a sumar: en una PC puede faltar justo el
 * pago que quedó en el corte.
 * Sin Firebase (dev): la suma local es el ledger completo.
 */

export interface ProviderBalanceEvent {
  type: 'debt' | 'payment'
  amount: number
  syncedAt?: string | null
}

export function sumProviderEvents(events: Array<Pick<ProviderBalanceEvent, 'type' | 'amount'>>): number {
  return events.reduce(
    (sum, ev) => sum + (ev.type === 'debt' ? Number(ev.amount) : -Number(ev.amount)),
    0,
  )
}

export function providerBalanceFromSources(input: {
  firebaseOn: boolean
  /** Saldo del listener. Null si ese par todavía no llegó. */
  liveBalance: number | null
  /** Checkpoint + cola leídos para este par. Null si no se consultó o falló. */
  remoteBalance: number | null
  events: ProviderBalanceEvent[]
}): number {
  if (!input.firebaseOn) return sumProviderEvents(input.events)
  const shared = input.liveBalance ?? input.remoteBalance
  if (shared == null) return sumProviderEvents(input.events)
  const pending = sumProviderEvents(input.events.filter(ev => ev.syncedAt == null))
  return shared + pending
}
