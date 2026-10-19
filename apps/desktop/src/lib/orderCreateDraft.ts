/**
 * Borrador del alta de pedido.
 *
 * Vive en el módulo: sobrevive al cierre del modal y al desmonte de Pedidos,
 * y se pierde al cerrar la app. No usa localStorage ni sessionStorage.
 * `resetOrderCreateDraft()` al cerrar sesión, para que otra cajera no lo vea.
 * Editar un pedido ya guardado no escribe acá.
 */
import { useSyncExternalStore } from 'react'
import { todayLocalYmd } from './datetime'
import { formatPhoneInput } from './phoneInput'
import { parseDecimalInput, parseNumericInput } from './numericInput'
import type {
  BudgetCartLine,
  DepositMethod,
  DepositPayment,
  OrderRow,
  OrderTimeSlot,
} from '../types/hw-api'

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

/** Línea editable en el carrito de presupuesto (UI). */
export interface BudgetCartDraft extends BudgetCartLine {
  /** Cantidad ingresada como string (para los inputs controlados). */
  qtyRaw: string
  /** Unidades pedidas (solo productos kg). Vacío = pidió kilos. */
  requestedUnitsRaw: string
  /** El kg sigue a las unidades por la referencia. Un peso escrito a mano lo apaga. */
  pieceLinked?: boolean
}

export interface OrderFormState {
  customerName: string
  phone: string
  items: string
  pickupDate: string
  timeSlot: OrderTimeSlot | ''
  pickupTime: string
  priority: boolean
  notes: string
  depositPayments: DepositPayment[]
  /** Solo admin: local destino del pedido. */
  storeId: string
  budgetCart: BudgetCartDraft[]
}

export function blankOrderForm(): OrderFormState {
  return {
    customerName: '',
    phone: '',
    items: '',
    pickupDate: '',
    timeSlot: '',
    pickupTime: '',
    priority: false,
    notes: '',
    depositPayments: [],
    storeId: '',
    budgetCart: [],
  }
}

/** Producto por kg con unidades cargadas y el peso vacío: no hay precio estimado. */
export function kgLineMissingWeight(line: BudgetCartDraft): boolean {
  if (line.unit !== 'kg') return false
  const kg = parseDecimalInput(line.qtyRaw)
  const units = parseNumericInput(line.requestedUnitsRaw)
  return units !== null && units > 0 && (kg === null || kg <= 0)
}

/** Líneas del carrito con cantidad válida (kg, unidades de catálogo, o piezas). */
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

export function paymentsForOrder(order: OrderRow): DepositPayment[] {
  if (Array.isArray(order.depositPayments) && order.depositPayments.length > 0) {
    return order.depositPayments
  }
  if (order.depositMethod && order.depositAmount > 0) {
    return [{ method: order.depositMethod, amount: order.depositAmount }]
  }
  return []
}

export function depositTotal(payments: DepositPayment[]): number {
  return payments.reduce((sum, payment) => sum + payment.amount, 0)
}

export function orderFormFromOrder(order: OrderRow): OrderFormState {
  const budgetCart: BudgetCartDraft[] = (order.budgetItems ?? []).map(line => ({
    ...line,
    qtyRaw: line.unit === 'kg'
      ? (line.estimatedQty > 0 ? String(line.estimatedQty).replace('.', ',') : '')
      : String(Math.round(line.estimatedQty)),
    requestedUnitsRaw: line.requestedUnits && line.requestedUnits > 0
      ? String(line.requestedUnits)
      : '',
  }))
  return {
    customerName: order.customerName,
    phone: formatPhoneInput(order.phone ?? ''),
    items: order.items,
    pickupDate: order.pickupDate,
    timeSlot: order.timeSlot ?? '',
    pickupTime: order.pickupTime ?? '',
    priority: order.priority,
    notes: order.notes ?? '',
    depositPayments: paymentsForOrder(order),
    storeId: order.storeId,
    budgetCart,
  }
}

/**
 * Hay datos cargados por la cajera, más allá de la fecha de hoy y el local
 * que se preseleccionan al abrir un alta vacía.
 * `defaultStoreId` es ese local sembrado: si coincide, no cuenta como contenido.
 */
export function orderCreateDraftHasContent(form: OrderFormState, defaultStoreId = ''): boolean {
  if (form.customerName.trim() !== '') return true
  if (form.phone.trim() !== '') return true
  if (form.items.trim() !== '') return true
  if (form.notes.trim() !== '') return true
  if (form.priority) return true
  if (form.timeSlot !== '') return true
  if (form.pickupTime !== '') return true
  if (form.budgetCart.length > 0) return true
  if (form.depositPayments.length > 0) return true
  if (form.pickupDate !== '' && form.pickupDate !== todayLocalYmd()) return true
  if (form.storeId !== defaultStoreId) return true
  return false
}

type Listener = () => void

let draft: OrderFormState = blankOrderForm()
let seeded = false
let seededStoreId = ''
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getOrderCreateDraft(): OrderFormState {
  return draft
}

export function subscribeOrderCreateDraft(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function updateOrderCreateDraft(updater: (prev: OrderFormState) => OrderFormState): void {
  const next = updater(draft)
  if (next === draft) return
  draft = next
  emit()
}

/** Primera apertura, o alta intacta cuyo local por defecto cambió. No pisa datos cargados. */
export function seedOrderCreateDraft(defaultStoreId: string): void {
  if (!seeded) {
    draft = {
      ...blankOrderForm(),
      pickupDate: todayLocalYmd(),
      storeId: defaultStoreId,
    }
    seeded = true
    seededStoreId = defaultStoreId
    emit()
    return
  }
  if (!orderCreateDraftHasContent(draft, seededStoreId) && seededStoreId !== defaultStoreId) {
    draft = { ...draft, storeId: defaultStoreId }
    seededStoreId = defaultStoreId
    emit()
  }
}

/** Vacía el alta y la deja lista para seguir cargando, con el modal abierto. */
export function clearOrderCreateDraft(defaultStoreId: string): void {
  draft = {
    ...blankOrderForm(),
    pickupDate: todayLocalYmd(),
    storeId: defaultStoreId,
  }
  seeded = true
  seededStoreId = defaultStoreId
  emit()
}

/** Tras guardar o al cerrar sesión. La próxima apertura vuelve a sembrar. */
export function resetOrderCreateDraft(): void {
  draft = blankOrderForm()
  seeded = false
  seededStoreId = ''
  emit()
}

export function useOrderCreateDraft(): OrderFormState {
  return useSyncExternalStore(subscribeOrderCreateDraft, getOrderCreateDraft, getOrderCreateDraft)
}
