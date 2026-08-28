/**
 * Helpers puros para alinear pedidos móviles con el contrato de desktop/Firestore.
 * Desktop: priority boolean, timeSlot morning|afternoon|specific,
 * depositPayments JSON string en Firestore.
 */

export type DepositMethod = 'cash' | 'debit' | 'wallet' | 'credit'
export type OrderTimeSlot = 'morning' | 'afternoon' | 'specific'

export interface DepositPayment {
  method: DepositMethod
  amount: number
}

export const DEPOSIT_METHOD_LABELS: Record<DepositMethod, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  wallet: 'Billetera Virtual',
  credit: 'Crédito',
}

export const TIME_SLOT_LABELS: Record<OrderTimeSlot, string> = {
  morning: 'Turno mañana',
  afternoon: 'Turno tarde',
  specific: 'Horario específico',
}

const DEPOSIT_METHODS = new Set<DepositMethod>(['cash', 'debit', 'wallet', 'credit'])

export function parseOrderPriority(raw: unknown): boolean {
  if (raw === true || raw === 'high') return true
  return false
}

export function parseTimeSlot(raw: unknown): OrderTimeSlot | null {
  if (raw === 'morning' || raw === 'afternoon' || raw === 'specific') return raw
  if (raw === 'mañana') return 'morning'
  if (raw === 'tarde') return 'afternoon'
  return null
}

/** Línea de turno para listados: "Turno mañana" / "18:30". Null si no hay slot. */
export function formatPickupSlotLine(slot: string | null | undefined, pickupTime?: string | null): string | null {
  const parsed = parseTimeSlot(slot)
  if (!parsed) return null
  if (parsed === 'specific' && pickupTime) return pickupTime
  return TIME_SLOT_LABELS[parsed]
}

function isDepositPayment(value: unknown): value is DepositPayment {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as { method?: unknown; amount?: unknown }
  if (typeof rec.method !== 'string' || !DEPOSIT_METHODS.has(rec.method as DepositMethod)) {
    return false
  }
  if (typeof rec.amount !== 'number' || !Number.isFinite(rec.amount) || rec.amount <= 0) {
    return false
  }
  return true
}

export function parseDepositPayments(raw: unknown): DepositPayment[] | null {
  if (raw == null || raw === 0 || raw === '') return null
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed)) return null
  const payments = parsed.filter(isDepositPayment)
  return payments.length > 0 ? payments : null
}

export function serializeDepositPayments(payments: DepositPayment[]): string | null {
  const valid = payments.filter(p => p.amount > 0)
  if (valid.length === 0) return null
  return JSON.stringify(valid)
}

export function formatDepositPaymentsLine(
  payments: DepositPayment[] | null | undefined,
  opts?: {
    fallbackMethod?: DepositMethod | null
    fallbackAmount?: number
    formatAmount?: (n: number) => string
  },
): string | null {
  const formatAmount = opts?.formatAmount ?? ((n: number) => String(n))
  const list = payments && payments.length > 0
    ? payments
    : opts?.fallbackMethod && opts.fallbackAmount && opts.fallbackAmount > 0
      ? [{ method: opts.fallbackMethod, amount: opts.fallbackAmount }]
      : []
  if (list.length === 0) return null
  return list
    .map(p => `${DEPOSIT_METHOD_LABELS[p.method]} ${formatAmount(p.amount)}`)
    .join(' · ')
}

export function depositTotal(payments: DepositPayment[]): number {
  return payments.reduce((sum, p) => sum + p.amount, 0)
}

/**
 * Local del formulario de alta: si el listado filtra un local concreto, lo hereda;
 * si el filtro es “Todos los locales”, queda vacío para forzar “Elegir un local”.
 */
export function defaultCreateStoreId(listFilterStoreId: string): string {
  return listFilterStoreId
}

export interface MobileOrderDraft {
  storeId: string
  customerName: string
  phone: string
  items: string
  pickupDate: string
  timeSlot: OrderTimeSlot | ''
  pickupTime: string
  priority: boolean
  payments: DepositPayment[]
  notes: string
  createdBy: string
}

export function validateMobileOrderDraft(draft: MobileOrderDraft): string | null {
  if (!draft.customerName.trim()) return 'El nombre del cliente es obligatorio.'
  if (!draft.items.trim()) return 'Los ítems del pedido son obligatorios.'
  if (!draft.storeId) return 'Seleccioná un local.'
  if (!draft.createdBy.trim()) return 'No hay usuario autenticado para crear el pedido.'
  if (depositTotal(draft.payments) > 0 && draft.payments.length === 0) {
    return 'Seleccioná el medio de pago de la seña.'
  }
  if (draft.timeSlot === 'specific' && !draft.pickupTime) {
    return 'Ingresá el horario específico de retiro.'
  }
  return null
}

export function toMobileOrderRecord(
  draft: MobileOrderDraft,
  now: string,
): {
  storeId: string
  customerName: string
  phone: string | null
  items: string
  pickupDate: string
  timeSlot: OrderTimeSlot | null
  pickupTime: string | null
  priority: boolean
  status: 'pending'
  depositAmount: number
  depositPayments: string | null
  notes: string | null
  deleted: false
  createdAt: string
  createdBy: string
  updatedAt: string
} {
  const payments = draft.payments.filter(p => p.amount > 0)
  return {
    storeId: draft.storeId,
    customerName: draft.customerName.trim(),
    phone: draft.phone.trim() || null,
    items: draft.items.trim(),
    pickupDate: draft.pickupDate,
    timeSlot: draft.timeSlot || null,
    pickupTime: draft.timeSlot === 'specific' ? draft.pickupTime || null : null,
    priority: draft.priority,
    status: 'pending',
    depositAmount: depositTotal(payments),
    depositPayments: serializeDepositPayments(payments),
    notes: draft.notes.trim() || null,
    deleted: false,
    createdAt: now,
    createdBy: draft.createdBy.trim(),
    updatedAt: now,
  }
}
