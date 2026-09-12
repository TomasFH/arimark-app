/**
 * Helpers puros para alinear pedidos móviles con el contrato de desktop/Firestore.
 * Desktop: priority boolean, timeSlot morning|afternoon|specific,
 * depositPayments JSON string en Firestore.
 */

import {
  checkPickupTime,
  checkPickupTimeOnDate,
  pickupSlotRegistrationError,
  pickupTimeRegistrationError,
  hoursForDate,
  parseBudgetItems,
  summarizeBudgetItems,
  type BudgetCartLine,
  type StoreHoursSource,
} from '@carniceria/shared'
import { parseDecimalInput, parseNumericInput } from './numericInput'

export type { BudgetCartLine }
export { parseBudgetItems }

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

/** Línea de turno para listados: "Turno mañana" / "Turno mañana · 11:00". Null si no hay slot. */
export function formatPickupSlotLine(
  slot: string | null | undefined,
  pickupTime?: string | null,
  hours?: StoreHoursSource | null,
  pickupDate?: string | null,
): string | null {
  const parsed = parseTimeSlot(slot)
  if (!parsed) return null
  if (parsed === 'specific' && pickupTime) {
    const dayHours = pickupDate ? hoursForDate(hours, pickupDate) : hours
    const check = dayHours ? checkPickupTime(pickupTime, dayHours) : null
    if (check?.window === 'morning') return `Turno mañana · ${pickupTime}`
    if (check?.window === 'afternoon') return `Turno tarde · ${pickupTime}`
    return pickupTime
  }
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

/** Línea editable del carrito (qty como texto de input). */
export interface BudgetCartDraft extends BudgetCartLine {
  qtyRaw: string
  requestedUnitsRaw: string
}

export function kgLineMissingWeight(line: BudgetCartDraft): boolean {
  if (line.unit !== 'kg') return false
  const kg = parseDecimalInput(line.qtyRaw)
  const units = parseNumericInput(line.requestedUnitsRaw)
  return units !== null && units > 0 && (kg === null || kg <= 0)
}

/** Líneas con cantidad válida (kg, unidades de catálogo, o piezas). */
export function resolvedBudgetLines(cart: BudgetCartDraft[]): BudgetCartLine[] {
  return cart.flatMap((line): BudgetCartLine[] => {
    if (line.unit === 'unit') {
      const qty = parseNumericInput(line.qtyRaw)
      if (qty === null || qty <= 0) return []
      return [{
        productId: line.productId,
        name: line.name,
        unit: line.unit,
        pluNumber: line.pluNumber,
        estimatedQty: qty,
        unitPrice: line.unitPrice,
      }]
    }

    const kg = parseDecimalInput(line.qtyRaw)
    const units = parseNumericInput(line.requestedUnitsRaw)
    const hasKg = kg !== null && kg > 0
    const hasUnits = units !== null && units > 0
    if (!hasKg && !hasUnits) return []
    return [{
      productId: line.productId,
      name: line.name,
      unit: line.unit,
      pluNumber: line.pluNumber,
      estimatedQty: hasKg ? kg : 0,
      unitPrice: line.unitPrice,
      requestedUnits: hasUnits ? units : null,
    }]
  })
}

export function estimatedBudgetTotal(lines: BudgetCartLine[]): number {
  return lines.reduce((sum, line) => {
    if (line.estimatedQty <= 0) return sum
    return sum + Math.round(line.unitPrice * line.estimatedQty)
  }, 0)
}

export function budgetDraftFromLines(lines: BudgetCartLine[]): BudgetCartDraft[] {
  return lines.map(line => ({
    ...line,
    qtyRaw: line.unit === 'kg'
      ? (line.estimatedQty > 0 ? String(line.estimatedQty).replace('.', ',') : '')
      : (line.estimatedQty > 0 ? String(Math.round(line.estimatedQty)) : ''),
    requestedUnitsRaw: line.requestedUnits && line.requestedUnits > 0
      ? String(line.requestedUnits)
      : '',
  }))
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
  budgetCart: BudgetCartDraft[]
}

export interface ValidateMobileOrderOptions {
  /** Pedidos viejos sin carrito: se puede seguir editando el texto de `items`. */
  allowLegacyText?: boolean
}

export function validateMobileOrderDraft(
  draft: MobileOrderDraft,
  hours?: StoreHoursSource | null,
  options?: ValidateMobileOrderOptions,
): string | null {
  if (!draft.customerName.trim()) return 'El nombre del cliente es obligatorio.'
  const lines = resolvedBudgetLines(draft.budgetCart)
  if (draft.budgetCart.length > 0) {
    if (lines.length === 0) return 'Agregá al menos un producto con cantidad.'
  } else if (options?.allowLegacyText) {
    if (!draft.items.trim()) return 'Los ítems del pedido son obligatorios.'
  } else {
    return 'Agregá al menos un producto con cantidad.'
  }
  if (!draft.storeId) return 'Seleccioná un local.'
  if (!draft.createdBy.trim()) return 'No hay usuario autenticado para crear el pedido.'
  if (depositTotal(draft.payments) > 0 && draft.payments.length === 0) {
    return 'Seleccioná el medio de pago de la seña.'
  }
  if (draft.timeSlot === 'specific' && !draft.pickupTime) {
    return 'Ingresá el horario específico de retiro.'
  }
  if (draft.timeSlot === 'specific' && draft.pickupTime && hours !== undefined) {
    const closed = pickupTimeRegistrationError(
      checkPickupTimeOnDate(draft.pickupTime, hours ?? null, draft.pickupDate),
    )
    if (closed) return closed
  }
  if (hours !== undefined && (draft.timeSlot === 'morning' || draft.timeSlot === 'afternoon')) {
    const slotError = pickupSlotRegistrationError(draft.timeSlot, hours ?? null, draft.pickupDate)
    if (slotError) return slotError
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
  budgetItems: BudgetCartLine[] | null
  deleted: false
  createdAt: string
  createdBy: string
  updatedAt: string
} {
  const payments = draft.payments.filter(p => p.amount > 0)
  const lines = resolvedBudgetLines(draft.budgetCart)
  const budgetItems = lines.length > 0 ? lines : null
  const items = budgetItems
    ? summarizeBudgetItems(budgetItems)
    : draft.items.trim()
  return {
    storeId: draft.storeId,
    customerName: draft.customerName.trim(),
    phone: draft.phone.trim() || null,
    items,
    pickupDate: draft.pickupDate,
    timeSlot: draft.timeSlot || null,
    pickupTime: draft.timeSlot === 'specific' ? draft.pickupTime || null : null,
    priority: draft.priority,
    status: 'pending',
    depositAmount: depositTotal(payments),
    depositPayments: serializeDepositPayments(payments),
    notes: draft.notes.trim() || null,
    budgetItems,
    deleted: false,
    createdAt: now,
    createdBy: draft.createdBy.trim(),
    updatedAt: now,
  }
}

/** Campos de edición: no pisa status ni autor. */
export function toMobileOrderPatch(
  draft: MobileOrderDraft,
  now: string,
): {
  customerName: string
  phone: string | null
  items: string
  pickupDate: string
  timeSlot: OrderTimeSlot | null
  pickupTime: string | null
  priority: boolean
  depositAmount: number
  depositPayments: string | null
  notes: string | null
  budgetItems: BudgetCartLine[] | null
  updatedAt: string
} {
  const record = toMobileOrderRecord(draft, now)
  return {
    customerName: record.customerName,
    phone: record.phone,
    items: record.items,
    pickupDate: record.pickupDate,
    timeSlot: record.timeSlot,
    pickupTime: record.pickupTime,
    priority: record.priority,
    depositAmount: record.depositAmount,
    depositPayments: record.depositPayments,
    notes: record.notes,
    budgetItems: record.budgetItems,
    updatedAt: now,
  }
}
