/**
 * Alta, confirmación y cancelación de una transferencia.
 * Una sola transacción por acto. No toca gastos, deuda ni ingresos.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  cancelStoreTransfer,
  confirmStoreTransfer,
  validateStoreTransferDraft,
  type StoreTransferActorRole,
  type StoreTransferDraftError,
} from '@carniceria/shared'
import * as schema from './schema'
import { storeTransfers, stores } from './schema'

export type StoreTransferDb = BetterSQLite3Database<typeof schema>

type StoreTransferTx = Parameters<Parameters<StoreTransferDb['transaction']>[0]>[0]

export type StoreTransferWriteError =
  | StoreTransferDraftError
  | 'ID'
  | 'STORES'
  | 'DUPLICATE'
  | 'NOT_FOUND'
  | 'NOT_PENDING'
  | 'QUANTITY'
  | 'FORBIDDEN'

type WriteResult<T> = { ok: true } & T | { ok: false; reason: StoreTransferWriteError }

function openStores(
  tx: StoreTransferTx,
  fromStoreId: string,
  toStoreId: string,
): boolean {
  const rows = tx.select({ id: stores.id, archivedAt: stores.archivedAt })
    .from(stores)
    .where(inArray(stores.id, [fromStoreId, toStoreId]))
    .all()
  const from = rows.find(row => row.id === fromStoreId)
  const to = rows.find(row => row.id === toStoreId)
  return Boolean(from && to && !from.archivedAt && !to.archivedAt)
}

export function createStoreTransfer(
  db: StoreTransferDb,
  input: {
    id: string
    productName: string
    quantity: number
    unit: string
    fromStoreId: string
    toStoreId: string
    occurredAt: string
    notes: string | null
    estimatedValue: number | null
    createdBy: string
    createdAt: string
  },
): WriteResult<{ id: string }> {
  const id = input.id.trim()
  if (id.length < 1 || id.length > 128) return { ok: false, reason: 'ID' }
  const parsed = validateStoreTransferDraft(input)
  if (!parsed.ok) return parsed
  const draft = parsed.draft

  return db.transaction(tx => {
    const existing = tx.select({ id: storeTransfers.id }).from(storeTransfers).where(eq(storeTransfers.id, id)).get()
    if (existing) return { ok: false, reason: 'DUPLICATE' as const }
    if (!openStores(tx, draft.fromStoreId, draft.toStoreId)) return { ok: false, reason: 'STORES' as const }
    tx.insert(storeTransfers).values({
      id,
      productName: draft.productName,
      quantity: draft.quantity,
      unit: draft.unit,
      fromStoreId: draft.fromStoreId,
      toStoreId: draft.toStoreId,
      occurredAt: draft.occurredAt,
      notes: draft.notes,
      estimatedValue: draft.estimatedValue,
      status: 'pending',
      receivedQuantity: null,
      hasDifference: false,
      confirmedAt: null,
      confirmedBy: null,
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      updatedAt: null,
      updatedBy: null,
      syncedAt: null,
    }).run()
    return { ok: true, id }
  })
}

export function confirmStoreTransferRow(
  db: StoreTransferDb,
  input: {
    id: string
    receivedQuantity: number
    actorId: string
    confirmedAt: string
  },
): WriteResult<{ hasDifference: boolean }> {
  return db.transaction(tx => {
    const row = tx.select().from(storeTransfers).where(eq(storeTransfers.id, input.id)).get()
    if (!row) return { ok: false, reason: 'NOT_FOUND' as const }
    const next = confirmStoreTransfer(row, input.receivedQuantity)
    if (!next.ok) return next
    tx.update(storeTransfers).set({
      status: next.status,
      receivedQuantity: next.receivedQuantity,
      hasDifference: next.hasDifference,
      confirmedAt: input.confirmedAt,
      confirmedBy: input.actorId,
      updatedAt: input.confirmedAt,
      updatedBy: input.actorId,
      syncedAt: null,
    }).where(and(
      eq(storeTransfers.id, input.id),
      eq(storeTransfers.status, 'pending'),
    )).run()
    const saved = tx.select().from(storeTransfers).where(eq(storeTransfers.id, input.id)).get()
    if (!saved || saved.status !== 'confirmed') return { ok: false, reason: 'NOT_PENDING' as const }
    return { ok: true, hasDifference: saved.hasDifference }
  })
}

export function cancelStoreTransferRow(
  db: StoreTransferDb,
  input: {
    id: string
    actorId: string
    role: StoreTransferActorRole
    cancelledAt: string
  },
): WriteResult<Record<string, never>> {
  return db.transaction(tx => {
    const row = tx.select().from(storeTransfers).where(eq(storeTransfers.id, input.id)).get()
    if (!row) return { ok: false, reason: 'NOT_FOUND' as const }
    const next = cancelStoreTransfer(row, { userId: input.actorId, role: input.role })
    if (!next.ok) return next
    tx.update(storeTransfers).set({
      status: next.status,
      receivedQuantity: null,
      hasDifference: false,
      updatedAt: input.cancelledAt,
      updatedBy: input.actorId,
      syncedAt: null,
    }).where(and(
      eq(storeTransfers.id, input.id),
      eq(storeTransfers.status, 'pending'),
    )).run()
    const saved = tx.select().from(storeTransfers).where(eq(storeTransfers.id, input.id)).get()
    if (!saved || saved.status !== 'cancelled') return { ok: false, reason: 'NOT_PENDING' as const }
    return { ok: true }
  })
}
