/**
 * Helpers puros del panel admin móvil (saldos, copy de gastos, IDs de proveedor).
 * Sin Firebase: testeable en vitest.
 */

export type CustomerLedgerEventType =
  | 'created'
  | 'debt'
  | 'reopened'
  | 'partial_payment'
  | 'paid'
  | 'cancelled'

export interface CustomerLedgerEvent {
  eventType: string
  amount: number
}

export interface ProviderLedgerEvent {
  type: 'debt' | 'payment'
  amount: number
}

export interface ExpenseDisplayInput {
  providerName?: string | null
  description?: string | null
  concept?: string | null
  category?: string | null
  notes?: string | null
}

const CHARGE_TYPES = new Set(['created', 'debt', 'reopened'])
const PAYMENT_TYPES = new Set(['partial_payment', 'paid', 'cancelled'])

/**
 * Saldo de fiado. Positivo = el cliente debe.
 * Desktop guarda created/reopened en positivo y pagos en negativo; móvil a veces
 * escribió `debt` y pagos en positivo. Se usa el tipo + abs() para unificar.
 */
export function calcCustomerBalance(events: CustomerLedgerEvent[]): number {
  return events.reduce((bal, e) => {
    const amt = Math.abs(e.amount)
    if (CHARGE_TYPES.has(e.eventType)) return bal + amt
    if (PAYMENT_TYPES.has(e.eventType)) return bal - amt
    return bal + e.amount
  }, 0)
}

/** Saldo hacia un proveedor. Positivo = le debemos. */
export function calcProviderBalance(events: ProviderLedgerEvent[]): number {
  return events.reduce((bal, e) => {
    const amt = Math.abs(e.amount)
    return e.type === 'debt' ? bal + amt : bal - amt
  }, 0)
}

export type ProviderLedgerDelta = { storeId: string; type: 'debt' | 'payment'; amount: number }

/**
 * Convierte saldos a favor de unos locales en pagos de la deuda de otros,
 * sin mover caja. El resultado es la lista de eventos a insertar.
 */
export function planProviderStoreCompensation(
  byStore: Record<string, number>,
): ProviderLedgerDelta[] {
  const credits = Object.entries(byStore)
    .filter(([, bal]) => bal < 0)
    .map(([storeId, bal]) => ({ storeId, remaining: -bal }))
  const debts = Object.entries(byStore)
    .filter(([, bal]) => bal > 0)
    .map(([storeId, bal]) => ({ storeId, remaining: bal }))

  const out: ProviderLedgerDelta[] = []
  let i = 0
  let j = 0
  while (i < credits.length && j < debts.length) {
    const take = Math.min(credits[i].remaining, debts[j].remaining)
    if (take > 0) {
      out.push({ storeId: credits[i].storeId, type: 'debt', amount: take })
      out.push({ storeId: debts[j].storeId, type: 'payment', amount: take })
      credits[i].remaining -= take
      debts[j].remaining -= take
    }
    if (credits[i].remaining === 0) i++
    if (debts[j].remaining === 0) j++
  }
  return out
}

/** Evento único para dejar el saldo de un local en `target`. */
export function ledgerDeltaToTarget(
  current: number,
  target: number,
): { type: 'debt' | 'payment'; amount: number } | null {
  const delta = Math.round(target) - Math.round(current)
  if (delta === 0) return null
  return delta > 0
    ? { type: 'debt', amount: delta }
    : { type: 'payment', amount: -delta }
}

export const ADMIN_ADJUST_NOTE_PREFIX = 'Ajuste de admin'

export function isAdminAdjustNote(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && notes.startsWith(ADMIN_ADJUST_NOTE_PREFIX)
}

function authorSuffix(adminName?: string): string {
  const name = adminName?.trim()
  return name ? ` (${name})` : ''
}

export function formatAdminAdjustNote(targetBalance: number, adminName?: string): string {
  const rounded = Math.round(targetBalance)
  const abs = Math.abs(rounded).toLocaleString('es-AR')
  const who = authorSuffix(adminName)
  if (rounded > 0) return `${ADMIN_ADJUST_NOTE_PREFIX}${who}: dejó la deuda en $ ${abs}`
  if (rounded < 0) return `${ADMIN_ADJUST_NOTE_PREFIX}${who}: dejó saldo a favor $ ${abs}`
  return `${ADMIN_ADJUST_NOTE_PREFIX}${who}: dejó el saldo en $ 0`
}

export function providerNameKey(name: string): string {
  return name.toLowerCase().trim()
}

/** Mismo algoritmo que desktop (`Buffer.from(nameKey).toString('hex')`). */
export function providerIdFromName(name: string): string {
  const key = providerNameKey(name)
  return Array.from(new TextEncoder().encode(key))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Firestore Timestamp | string | null → ISO o null. */
export function asIsoTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate
    if (typeof toDate === 'function') {
      try {
        return (toDate as () => Date).call(value).toISOString()
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Título de un gasto, alineado a desktop: proveedor o "Vale: …" arriba,
 * no en el pie.
 */
export function expenseTitle(exp: ExpenseDisplayInput): string {
  const provider = exp.providerName?.trim()
  if (provider) return provider

  const concept = (exp.concept ?? exp.description)?.trim()
  if (concept) return concept

  const category = exp.category?.trim()
  if (category) {
    if (/^vale/i.test(category)) return 'Vale'
    return category
  }
  return 'Gasto'
}

export function expenseNote(exp: ExpenseDisplayInput): string | null {
  const title = expenseTitle(exp)
  const concept = (exp.concept ?? exp.description)?.trim()
  if (concept && concept !== title) return concept
  const notes = exp.notes?.trim()
  return notes || null
}

export function normalizeDebtEventType(raw: string | undefined): CustomerLedgerEventType {
  if (raw === 'debt') return 'created'
  if (
    raw === 'created'
    || raw === 'reopened'
    || raw === 'partial_payment'
    || raw === 'paid'
    || raw === 'cancelled'
  ) {
    return raw
  }
  return 'created'
}

export type DebtPaymentMethod = 'cash' | 'debit' | 'wallet' | 'credit'

export interface PlannedDebtPayment {
  amount: number
  method: DebtPaymentMethod
  eventType: 'partial_payment' | 'paid'
}

/**
 * Arma un evento de ledger por medio. El último tramo que cubre el saldo
 * queda como `paid`; el resto, `partial_payment`. No admite excedente.
 */
export function planCustomerDebtPayments(
  balance: number,
  entries: Array<{ method: DebtPaymentMethod; amount: number }>,
): { ok: true; payments: PlannedDebtPayment[] } | { ok: false; error: string } {
  const bal = Math.round(balance)
  if (bal <= 0) return { ok: false, error: 'No hay deuda para cobrar.' }

  const positive = entries.filter(e => e.amount > 0)
  if (positive.length === 0) return { ok: false, error: 'Ingresá al menos un monto.' }

  const total = positive.reduce((sum, e) => sum + Math.round(e.amount), 0)
  if (total > bal) return { ok: false, error: 'El total de los pagos no puede superar la deuda.' }

  let remaining = bal
  const payments: PlannedDebtPayment[] = []
  for (const e of positive) {
    const amount = Math.round(e.amount)
    const eventType = amount >= remaining ? 'paid' : 'partial_payment'
    payments.push({ amount, method: e.method, eventType })
    remaining -= amount
  }
  return { ok: true, payments }
}
