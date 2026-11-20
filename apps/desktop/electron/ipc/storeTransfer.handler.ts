/**
 * Alta, confirmación y cancelación de una transferencia.
 * El payload y la sesión se resuelven antes de abrir la base.
 */
import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import {
  STORE_TRANSFER_NAME_MAX,
  STORE_TRANSFER_NOTES_MAX,
  STORE_TRANSFER_QUANTITY_MAX,
  STORE_TRANSFER_UNITS,
  STORE_TRANSFER_VALUE_MAX,
  validateStoreTransferDraft,
} from '@carniceria/shared'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { getActiveSession, type ActiveSession } from '../activeSession'
import {
  cancelStoreTransferRow,
  confirmStoreTransferRow,
  createStoreTransfer,
  type StoreTransferWriteError,
} from '../db/storeTransfers'
import type { IpcError, IpcResult } from '../../src/types/hw-api'

const unitSchema = z.enum(STORE_TRANSFER_UNITS)

const createSchema = z.object({
  productName: z.string().trim().min(1).max(STORE_TRANSFER_NAME_MAX),
  quantity: z.number().positive().max(STORE_TRANSFER_QUANTITY_MAX),
  unit: unitSchema,
  fromStoreId: z.string().trim().min(1).max(128),
  toStoreId: z.string().trim().min(1).max(128),
  occurredAt: z.string().min(20).max(40),
  notes: z.string().max(STORE_TRANSFER_NOTES_MAX).nullable().optional(),
  estimatedValue: z.number().int().min(0).max(STORE_TRANSFER_VALUE_MAX).nullable().optional(),
})

const confirmSchema = z.object({
  id: z.string().uuid(),
  receivedQuantity: z.number().min(0).max(STORE_TRANSFER_QUANTITY_MAX),
})

const cancelSchema = z.object({
  id: z.string().uuid(),
})

const REASON_TEXT: Record<StoreTransferWriteError, string> = {
  PRODUCT: 'El producto no es válido.',
  QUANTITY: 'La cantidad no es válida.',
  UNIT: 'La unidad no es válida.',
  STORES: 'Los locales no son válidos.',
  DATE: 'La fecha no es válida.',
  NOTES: 'La nota es demasiado larga.',
  VALUE: 'El valor estimado no es válido.',
  ID: 'El identificador no es válido.',
  DUPLICATE: 'Esa transferencia ya existe.',
  NOT_FOUND: 'No se encontró la transferencia.',
  NOT_PENDING: 'Esa transferencia ya no está pendiente.',
  FORBIDDEN: 'No se puede cancelar esta transferencia.',
}

function fail(reason: StoreTransferWriteError): IpcError {
  return { ok: false, error: REASON_TEXT[reason], code: reason }
}

function readActor<T>(
  channel: string,
  schema: z.ZodType<T>,
  payload: unknown,
): { ok: true; data: T; session: ActiveSession } | IpcError {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    log.error(`[${channel}] Payload inválido`, parsed.error)
    return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
  }
  const session = getActiveSession()
  if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
  if (session.role !== 'admin' && session.role !== 'cashier') {
    return { ok: false, error: 'No se puede registrar esta transferencia.', code: 'FORBIDDEN' }
  }
  return { ok: true, data: parsed.data, session }
}

export function registerStoreTransferHandlers(): void {
  ipcMain.handle(IPC.CREATE_STORE_TRANSFER, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const actor = readActor(IPC.CREATE_STORE_TRANSFER, createSchema, payload)
    if (!actor.ok) return actor
    const draft = validateStoreTransferDraft({
      productName: actor.data.productName,
      quantity: actor.data.quantity,
      unit: actor.data.unit,
      fromStoreId: actor.data.fromStoreId,
      toStoreId: actor.data.toStoreId,
      occurredAt: actor.data.occurredAt,
      notes: actor.data.notes ?? null,
      estimatedValue: actor.data.estimatedValue ?? null,
    })
    if (!draft.ok) return fail(draft.reason)

    try {
      const created = createStoreTransfer(getDb(), {
        id: uuidv4(),
        ...draft.draft,
        createdBy: actor.session.userId,
        createdAt: new Date().toISOString(),
      })
      if (!created.ok) return fail(created.reason)
      return { ok: true, data: { id: created.id } }
    } catch (err) {
      log.error('[ipc:create-store-transfer] Error inesperado', err)
      return { ok: false, error: 'No se pudo guardar la transferencia.' }
    }
  })

  ipcMain.handle(
    IPC.CONFIRM_STORE_TRANSFER,
    (_event, payload: unknown): IpcResult<{ hasDifference: boolean }> => {
      const actor = readActor(IPC.CONFIRM_STORE_TRANSFER, confirmSchema, payload)
      if (!actor.ok) return actor
      const now = new Date().toISOString()
      try {
        const confirmed = confirmStoreTransferRow(getDb(), {
          id: actor.data.id,
          receivedQuantity: actor.data.receivedQuantity,
          actorId: actor.session.userId,
          confirmedAt: now,
        })
        if (!confirmed.ok) return fail(confirmed.reason)
        return { ok: true, data: { hasDifference: confirmed.hasDifference } }
      } catch (err) {
        log.error('[ipc:confirm-store-transfer] Error inesperado', err)
        return { ok: false, error: 'No se pudo confirmar la transferencia.' }
      }
    },
  )

  ipcMain.handle(IPC.CANCEL_STORE_TRANSFER, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const actor = readActor(IPC.CANCEL_STORE_TRANSFER, cancelSchema, payload)
    if (!actor.ok) return actor
    try {
      const cancelled = cancelStoreTransferRow(getDb(), {
        id: actor.data.id,
        actorId: actor.session.userId,
        role: actor.session.role,
        cancelledAt: new Date().toISOString(),
      })
      if (!cancelled.ok) return fail(cancelled.reason)
      return { ok: true, data: { id: actor.data.id } }
    } catch (err) {
      log.error('[ipc:cancel-store-transfer] Error inesperado', err)
      return { ok: false, error: 'No se pudo cancelar la transferencia.' }
    }
  })
}
