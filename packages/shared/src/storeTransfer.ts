/**
 * Transferencia entre locales. No es una compra ni un ingreso:
 * no entra en la cobertura. No lee Firestore.
 */
import { civilYmd } from './pickupHours'

export const STORE_TRANSFER_UNITS = ['kg', 'u', 'cajon'] as const
export type StoreTransferUnit = (typeof STORE_TRANSFER_UNITS)[number]

export const STORE_TRANSFER_NAME_MAX = 80
export const STORE_TRANSFER_NOTES_MAX = 300
export const STORE_TRANSFER_QUANTITY_MAX = 99_999
export const STORE_TRANSFER_VALUE_MAX = 999_999_999

/** Si el período trae más que esto, la lista se muestra incompleta. */
export const STORE_TRANSFER_PENDING_LIMIT = 100

export type StoreTransferStatus = 'pending' | 'confirmed' | 'cancelled'

export type StoreTransferActorRole = 'admin' | 'cashier'

const UNITS = new Set<string>(STORE_TRANSFER_UNITS)

export interface StoreTransferDraft {
  productName: string
  quantity: number
  unit: StoreTransferUnit
  fromStoreId: string
  toStoreId: string
  occurredAt: string
  notes: string | null
  estimatedValue: number | null
}

export type StoreTransferDraftError =
  | 'PRODUCT'
  | 'QUANTITY'
  | 'UNIT'
  | 'STORES'
  | 'DATE'
  | 'NOTES'
  | 'VALUE'

/** Medianoche civil de Argentina. Una hora del día no es la fecha del movimiento. */
export function transferOccurredAt(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const iso = new Date(`${ymd}T00:00:00.000-03:00`).toISOString()
  if (civilYmd(new Date(iso)) !== ymd) return null
  return iso
}

function cleanText(value: string): string {
  return value.trim()
}

function quantityOk(quantity: number, unit: StoreTransferUnit, allowZero: boolean): boolean {
  if (!Number.isFinite(quantity) || quantity > STORE_TRANSFER_QUANTITY_MAX) return false
  if (allowZero ? quantity < 0 : quantity <= 0) return false
  if (unit === 'kg') return true
  return Number.isInteger(quantity)
}

export function validateStoreTransferDraft(input: {
  productName: string
  quantity: number
  unit: string
  fromStoreId: string
  toStoreId: string
  occurredAt: string
  notes: string | null
  estimatedValue: number | null
}): { ok: true; draft: StoreTransferDraft } | { ok: false; reason: StoreTransferDraftError } {
  const productName = cleanText(input.productName)
  if (productName.length < 1 || productName.length > STORE_TRANSFER_NAME_MAX) {
    return { ok: false, reason: 'PRODUCT' }
  }
  if (!UNITS.has(input.unit)) return { ok: false, reason: 'UNIT' }
  const unit = input.unit as StoreTransferUnit
  if (!quantityOk(input.quantity, unit, false)) return { ok: false, reason: 'QUANTITY' }
  const fromStoreId = cleanText(input.fromStoreId)
  const toStoreId = cleanText(input.toStoreId)
  if (fromStoreId.length < 1 || toStoreId.length < 1 || fromStoreId.length > 128 || toStoreId.length > 128) {
    return { ok: false, reason: 'STORES' }
  }
  if (fromStoreId === toStoreId) return { ok: false, reason: 'STORES' }
  const occurred = Date.parse(input.occurredAt)
  if (!Number.isFinite(occurred)) return { ok: false, reason: 'DATE' }
  const ymd = civilYmd(new Date(occurred))
  if (input.occurredAt !== transferOccurredAt(ymd)) return { ok: false, reason: 'DATE' }
  let notes: string | null = null
  if (input.notes != null) {
    notes = cleanText(input.notes)
    if (notes.length > STORE_TRANSFER_NOTES_MAX) return { ok: false, reason: 'NOTES' }
    if (notes.length === 0) notes = null
  }
  const estimatedValue = input.estimatedValue
  if (estimatedValue != null) {
    if (!Number.isInteger(estimatedValue) || estimatedValue < 0 || estimatedValue > STORE_TRANSFER_VALUE_MAX) {
      return { ok: false, reason: 'VALUE' }
    }
  }
  return {
    ok: true,
    draft: {
      productName,
      quantity: input.quantity,
      unit,
      fromStoreId,
      toStoreId,
      occurredAt: input.occurredAt,
      notes,
      estimatedValue,
    },
  }
}

export type StoreTransferLabel = 'Pendiente' | 'Confirmado' | 'Con diferencia' | 'Cancelado'

export function storeTransferLabel(row: {
  status: StoreTransferStatus
  hasDifference: boolean
}): StoreTransferLabel {
  if (row.status === 'cancelled') return 'Cancelado'
  if (row.status === 'pending') return 'Pendiente'
  if (row.hasDifference) return 'Con diferencia'
  return 'Confirmado'
}

/** Pendiente cuenta. Confirmado y cancelado no. */
export function storeTransferIsPending(row: { status: StoreTransferStatus }): boolean {
  return row.status === 'pending'
}

export function confirmStoreTransfer(
  row: { status: StoreTransferStatus; quantity: number; unit: StoreTransferUnit },
  receivedQuantity: number,
): { ok: true; status: 'confirmed'; receivedQuantity: number; hasDifference: boolean } | { ok: false; reason: 'NOT_PENDING' | 'QUANTITY' } {
  if (row.status !== 'pending') return { ok: false, reason: 'NOT_PENDING' }
  if (!quantityOk(receivedQuantity, row.unit, true)) return { ok: false, reason: 'QUANTITY' }
  return {
    ok: true,
    status: 'confirmed',
    receivedQuantity,
    hasDifference: receivedQuantity !== row.quantity,
  }
}

/**
 * Cancela solo un pendiente. Lo puede hacer quien lo creó o un admin.
 * Otra cajera de la licencia no.
 */
export function cancelStoreTransfer(
  row: { status: StoreTransferStatus; createdBy: string },
  actor: { userId: string; role: StoreTransferActorRole },
): { ok: true; status: 'cancelled'; receivedQuantity: null; hasDifference: false } | { ok: false; reason: 'NOT_PENDING' | 'FORBIDDEN' } {
  if (row.status !== 'pending') return { ok: false, reason: 'NOT_PENDING' }
  const allowed = actor.role === 'admin' || actor.userId === row.createdBy
  if (!allowed) return { ok: false, reason: 'FORBIDDEN' }
  return { ok: true, status: 'cancelled', receivedQuantity: null, hasDifference: false }
}

/**
 * Arma la lista de pendientes. Más de 100 no se corta en silencio:
 * se devuelven 100 y incomplete queda en true.
 * 100 justos, sin uno de más, es la lista completa.
 */
export function pendingStoreTransfers<T extends { status: StoreTransferStatus }>(
  rows: T[],
  limit = STORE_TRANSFER_PENDING_LIMIT,
): { rows: T[]; incomplete: boolean } {
  const pending = rows.filter(storeTransferIsPending)
  if (pending.length > limit) {
    return { rows: pending.slice(0, limit), incomplete: true }
  }
  return { rows: pending, incomplete: false }
}
