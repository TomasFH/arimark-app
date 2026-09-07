/**
 * providers.handler — gestión de proveedores (entidades globales sincronizadas).
 *
 * Canales:
 *   LIST_PROVIDERS          cajera + admin: lista activos desde cache local
 *   CREATE_PROVIDER         admin (+ implícito desde gasto): crea en cache + push
 *   UPDATE_PROVIDER         admin: edita name/phone/notes + push
 *   ARCHIVE_PROVIDER        admin: soft-delete + push
 *   GET_PROVIDERS_WITH_DEBT admin: agrega deuda por (provider, local) desde Firestore
 *                           fallback a SQLite local si Firebase no disponible
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import log from 'electron-log'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { providers, providerDebtEvents, stores, users, expenses } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { ActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { providerIdFromName, providerNameKey } from './providerUtils'
import {
  pushUnsyncedProviders,
  pushUnsyncedDebtEvents,
  restoreProviderLedgerInFirestore,
} from '../licensing/providerSync'
import { pushUnsyncedExpenses } from '../licensing/expenseSync'
import { getFirebaseApp, isFirebaseAvailable } from '../licensing/firebase'
import { getLiveProviderStoreBalances } from '../licensing/debtBalanceLive'
import { PROVIDER_DEBT_CHECKPOINTS_COL } from '@carniceria/shared'
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore'
import type { IpcResult, ProviderRow, ProviderWithDebtRow, ProviderDebtEventRow } from '../../src/types/hw-api'
import { stampAdminAdjustAuthor } from '../../src/lib/providerLedgerNotes'

// ---------------------------------------------------------------------------
// Schemas de validación
// ---------------------------------------------------------------------------

const createProviderSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.trim()),
  phone: z.string().max(50).optional().transform(s => s?.trim() || undefined),
  notes: z.string().max(300).optional(),
})

const updateProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).transform(s => s.trim()).optional(),
  phone: z.string().max(50).optional().nullable().transform(s => typeof s === 'string' ? s.trim() || null : s),
  notes: z.string().max(300).optional().nullable(),
})

const archiveProviderSchema = z.object({
  id: z.string().min(1),
})

const getProviderDebtHistorySchema = z.object({
  providerId: z.string().min(1),
})

const settleProviderDebtSchema = z.object({
  providerId: z.string().min(1),
  amount: z.number().int().positive(),
  /** Local desde el que se registra el pago. Si no se provee, usa session.storeId. */
  storeId: z.string().min(1).optional(),
})

const recordProviderLedgerSchema = z.object({
  providerId: z.string().min(1),
  storeId: z.string().min(1),
  type: z.enum(['debt', 'payment']),
  amount: z.number().int().positive(),
  notes: z.string().max(300).optional(),
})

const compensateProviderStoresSchema = z.object({
  providerId: z.string().min(1),
})

const payProviderFromShiftSchema = z.object({
  providerId: z.string().min(1),
  notes: z.string().max(300).optional(),
  allocations: z.array(z.object({
    storeId: z.string().min(1),
    amount: z.number().int().positive(),
  })).min(1),
})

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export function registerProvidersHandlers(): void {

  // -----------------------------------------------------------------------
  // LIST_PROVIDERS — cache local, incluye archivados solo si se pide
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.LIST_PROVIDERS, (_event, payload: unknown): IpcResult<ProviderRow[]> => {
    const parsed = z.object({ includeArchived: z.boolean().optional() }).safeParse(payload ?? {})
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const rows = db.select({
        id: providers.id,
        name: providers.name,
        phone: providers.phone,
        notes: providers.notes,
        archivedAt: providers.archivedAt,
      }).from(providers).all()

      const filtered = parsed.data.includeArchived
        ? rows
        : rows.filter(r => !r.archivedAt)

      const result: ProviderRow[] = filtered.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone ?? undefined,
        notes: r.notes ?? undefined,
        archivedAt: r.archivedAt ?? undefined,
      }))

      return { ok: true, data: result }
    } catch (err) {
      log.error('[ipc:list-providers] Error', err)
      return { ok: false, error: 'Error al listar proveedores.' }
    }
  })

  // -----------------------------------------------------------------------
  // CREATE_PROVIDER — admin (o implícito desde expense.handler)
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.CREATE_PROVIDER, async (_event, payload: unknown): Promise<IpcResult<ProviderRow>> => {
    const parsed = createProviderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-provider] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { name, phone, notes } = parsed.data
    const id = providerIdFromName(name)
    const nameKey = providerNameKey(name)
    const now = new Date().toISOString()

    try {
      const db = getDb()

      // Si ya existe (mismo nameKey/id), retornar el existente sin duplicar.
      // Si estaba archivado, se reactiva: el id es determinístico y es el mismo proveedor.
      const existing = db.select().from(providers).where(eq(providers.id, id)).get()
      if (existing) {
        if (existing.archivedAt) {
          db.update(providers).set({
            archivedAt: null,
            updatedAt: now,
            updatedBy: session.userId,
            syncedAt: null,
          }).where(eq(providers.id, id)).run()
          const config = getBusinessConfig()
          pushUnsyncedProviders(config.tenant_id).catch(err =>
            log.warn('[ipc:create-provider] push al reactivar falló (no bloqueante)', err)
          )
        }
        const current = db.select().from(providers).where(eq(providers.id, id)).get()!
        return {
          ok: true,
          data: {
            id: current.id,
            name: current.name,
            phone: current.phone ?? undefined,
            notes: current.notes ?? undefined,
            archivedAt: current.archivedAt ?? undefined,
          },
        }
      }

      db.insert(providers).values({
        id,
        name,
        nameKey,
        phone: phone ?? null,
        notes: notes ?? null,
        createdAt: now,
        createdBy: session.userId,
        syncedAt: null,
      }).run()

      const config = getBusinessConfig()
      pushUnsyncedProviders(config.tenant_id).catch(err =>
        log.warn('[ipc:create-provider] push falló (no bloqueante)', err)
      )

      log.info('[ipc:create-provider] Proveedor creado', { id, name })
      return { ok: true, data: { id, name, phone: phone ?? undefined, notes: notes ?? undefined } }
    } catch (err) {
      log.error('[ipc:create-provider] Error', err)
      return { ok: false, error: 'Error al crear proveedor.' }
    }
  })

  // -----------------------------------------------------------------------
  // UPDATE_PROVIDER — admin
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATE_PROVIDER, async (_event, payload: unknown): Promise<IpcResult<ProviderRow>> => {
    const parsed = updateProviderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-provider] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { id, name, phone, notes } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const existing = db.select().from(providers).where(eq(providers.id, id)).get()
      if (!existing) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }
      if (existing.archivedAt) return { ok: false, error: 'El proveedor está eliminado.', code: 'ARCHIVED' }

      const updates: Partial<typeof existing> = {
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null, // marcar para re-push
      }
      if (name !== undefined) updates.name = name
      if (phone !== undefined) updates.phone = phone
      if (notes !== undefined) updates.notes = notes

      db.update(providers).set(updates).where(eq(providers.id, id)).run()

      const config = getBusinessConfig()
      pushUnsyncedProviders(config.tenant_id).catch(err =>
        log.warn('[ipc:update-provider] push falló (no bloqueante)', err)
      )

      const updated = db.select().from(providers).where(eq(providers.id, id)).get()!
      log.info('[ipc:update-provider] Proveedor actualizado', { id })
      return {
        ok: true,
        data: {
          id: updated.id,
          name: updated.name,
          phone: updated.phone ?? undefined,
          notes: updated.notes ?? undefined,
        },
      }
    } catch (err) {
      log.error('[ipc:update-provider] Error', err)
      return { ok: false, error: 'Error al actualizar proveedor.' }
    }
  })

  // -----------------------------------------------------------------------
  // ARCHIVE_PROVIDER — admin (soft-delete)
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.ARCHIVE_PROVIDER, async (_event, payload: unknown): Promise<IpcResult<void>> => {
    const parsed = archiveProviderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:archive-provider] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const { id } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const existing = db.select().from(providers).where(eq(providers.id, id)).get()
      if (!existing) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }

      db.update(providers).set({
        archivedAt: now,
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(providers.id, id)).run()

      const config = getBusinessConfig()
      pushUnsyncedProviders(config.tenant_id).catch(err =>
        log.warn('[ipc:archive-provider] push falló (no bloqueante)', err)
      )

      log.info('[ipc:archive-provider] Proveedor archivado', { id })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:archive-provider] Error', err)
      return { ok: false, error: 'Error al archivar proveedor.' }
    }
  })

  // -----------------------------------------------------------------------
  // UNARCHIVE_PROVIDER — admin: reactiva un proveedor archivado
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.UNARCHIVE_PROVIDER, async (_event, payload: unknown): Promise<IpcResult<void>> => {
    const parsed = archiveProviderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:unarchive-provider] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo disponible para admins.', code: 'FORBIDDEN' }

    const { id } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const existing = db.select().from(providers).where(eq(providers.id, id)).get()
      if (!existing) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }
      if (!existing.archivedAt) return { ok: false, error: 'El proveedor no está eliminado.', code: 'CONFLICT' }

      db.update(providers).set({
        archivedAt: null,
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(providers.id, id)).run()

      const config = getBusinessConfig()
      pushUnsyncedProviders(config.tenant_id).catch(err =>
        log.warn('[ipc:unarchive-provider] push falló (no bloqueante)', err)
      )
      restoreProviderLedgerInFirestore(config.tenant_id, id).catch(err =>
        log.warn('[ipc:unarchive-provider] restore ledger Firestore falló (no bloqueante)', err)
      )

      log.info('[ipc:unarchive-provider] Proveedor restaurado', { id })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:unarchive-provider] Error', err)
      return { ok: false, error: 'Error al restaurar proveedor.' }
    }
  })

  // -----------------------------------------------------------------------
  // DELETE_PROVIDER — admin: oculta el proveedor. Conserva el ledger
  //   (deuda, pagos, historial) para poder restaurarlo. Los gastos de caja
  //   no se tocan.
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.DELETE_PROVIDER, async (_event, payload: unknown): Promise<IpcResult<void>> => {
    const parsed = archiveProviderSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:delete-provider] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo disponible para admins.', code: 'FORBIDDEN' }

    const { id } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const existing = db.select().from(providers).where(eq(providers.id, id)).get()
      if (!existing) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }

      db.update(providers).set({
        archivedAt: now,
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(providers.id, id)).run()

      const config = getBusinessConfig()
      pushUnsyncedProviders(config.tenant_id).catch(err =>
        log.warn('[ipc:delete-provider] push falló (no bloqueante)', err)
      )

      log.info('[ipc:delete-provider] Proveedor ocultado (ledger conservado)', { id })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:delete-provider] Error', err)
      return { ok: false, error: 'Error al eliminar proveedor.' }
    }
  })

  // -----------------------------------------------------------------------
  // GET_PROVIDER_DEBT_HISTORY — admin: eventos individuales de un proveedor
  //   Orden descendente por createdAt (más reciente primero).
  //   Fuente primaria: Firestore. Fallback: SQLite local.
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.GET_PROVIDER_DEBT_HISTORY, async (_event, payload: unknown): Promise<IpcResult<ProviderDebtEventRow[]>> => {
    const parsed = getProviderDebtHistorySchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:get-provider-debt-history] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo disponible para admins.', code: 'FORBIDDEN' }

    const { providerId } = parsed.data

    try {
      if (isFirebaseAvailable()) {
        return await getProviderDebtHistoryFromFirestore(providerId)
      }
      return getProviderDebtHistoryLocal(providerId)
    } catch (err) {
      log.error('[ipc:get-provider-debt-history] Error', err)
      try {
        return getProviderDebtHistoryLocal(providerId)
      } catch (fallbackErr) {
        log.error('[ipc:get-provider-debt-history] Fallback local también falló', fallbackErr)
        return { ok: false, error: 'Error al obtener historial de deuda.' }
      }
    }
  })

  // -----------------------------------------------------------------------
  // SETTLE_PROVIDER_DEBT — admin: registra un pago completo de la deuda con
  //   un proveedor. No requiere turno abierto (shiftId = null si no hay).
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.SETTLE_PROVIDER_DEBT, async (_event, payload: unknown): Promise<IpcResult<{ eventId: string }>> => {
    const parsed = settleProviderDebtSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:settle-provider-debt] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo disponible para admins.', code: 'FORBIDDEN' }

    const { providerId, amount, storeId: payloadStoreId } = parsed.data
    // El storeId del pago: si viene en el payload, usarlo (el admin eligió un local específico
    // al filtrar el historial). Si no, usar el storeId de sesión como fallback.
    const effectiveStoreId = payloadStoreId ?? session.storeId
    const now = new Date().toISOString()
    const eventId = uuidv4()

    try {
      const db = getDb()

      const providerRow = db.select({ name: providers.name })
        .from(providers)
        .where(eq(providers.id, providerId))
        .get()
      if (!providerRow) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }

      // Garantizar que el admin tiene fila en la tabla users (FK created_by).
      // Un admin puede llegar aquí sin haber pasado por SELECT_STORE si solo usa el panel admin.
      const existingUser = db.select({ id: users.id }).from(users).where(eq(users.id, session.userId)).get()
      if (!existingUser) {
        db.insert(users).values({
          id: session.userId,
          storeId: session.storeId,
          name: session.displayName ?? session.userId,
          firebaseUid: session.userId,
          role: 'cashier',
          active: true,
          createdAt: now,
        }).run()
      }

      db.transaction(tx => {
        tx.insert(providerDebtEvents).values({
          id: eventId,
          storeId: effectiveStoreId,
          providerId,
          provider: providerRow.name,
          type: 'payment',
          amount,
          expenseId: null,
          shiftId: session.shiftId ?? null,
          createdAt: now,
          createdBy: session.userId,
          syncedAt: null,
        }).run()
      })

      const config = getBusinessConfig()
      pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
        log.warn('[ipc:settle-provider-debt] push de eventos falló (no bloqueante)', err)
      )

      log.info('[ipc:settle-provider-debt] Deuda saldada', { providerId, amount, eventId })
      return { ok: true, data: { eventId } }
    } catch (err) {
      log.error('[ipc:settle-provider-debt] Error', err)
      return { ok: false, error: 'Error al registrar el pago.' }
    }
  })

  // -----------------------------------------------------------------------
  // RECORD_PROVIDER_LEDGER — admin: deuda o pago manual en un local (sin caja).
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.RECORD_PROVIDER_LEDGER, async (_event, payload: unknown): Promise<IpcResult<{ eventId: string }>> => {
    const parsed = recordProviderLedgerSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:record-provider-ledger] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo disponible para admins.', code: 'FORBIDDEN' }

    const { providerId, storeId, type, amount, notes } = parsed.data
    const now = new Date().toISOString()
    const eventId = uuidv4()

    try {
      const db = getDb()
      const providerRow = db.select({ name: providers.name }).from(providers).where(eq(providers.id, providerId)).get()
      if (!providerRow) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }
      const storeRow = db.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).get()
      if (!storeRow) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      ensureLocalUser(db, session, now)

      const authorName =
        session.displayName
        ?? db.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).get()?.name
        ?? 'admin'

      db.insert(providerDebtEvents).values({
        id: eventId,
        storeId,
        providerId,
        provider: providerRow.name,
        type,
        amount,
        expenseId: null,
        shiftId: session.shiftId ?? null,
        createdAt: now,
        createdBy: session.userId,
        notes: stampAdminAdjustAuthor(notes ?? null, authorName),
        syncedAt: null,
      }).run()

      const config = getBusinessConfig()
      pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
        log.warn('[ipc:record-provider-ledger] push falló (no bloqueante)', err)
      )

      log.info('[ipc:record-provider-ledger] Evento registrado', { providerId, storeId, type, amount, eventId })
      return { ok: true, data: { eventId } }
    } catch (err) {
      log.error('[ipc:record-provider-ledger] Error', err)
      return { ok: false, error: 'Error al registrar el movimiento.' }
    }
  })

  // -----------------------------------------------------------------------
  // COMPENSATE_PROVIDER_STORES — admin: aplica saldos a favor contra deudas
  //   de otros locales (sin mover caja).
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.COMPENSATE_PROVIDER_STORES, async (_event, payload: unknown): Promise<IpcResult<{ events: number }>> => {
    const parsed = compensateProviderStoresSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:compensate-provider-stores] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin' && !session.shiftId) {
      return { ok: false, error: 'Solo disponible para admins o con turno abierto.', code: 'FORBIDDEN' }
    }

    const { providerId } = parsed.data
    const now = new Date().toISOString()

    try {
      const db = getDb()
      const providerRow = db.select({ name: providers.name }).from(providers).where(eq(providers.id, providerId)).get()
      if (!providerRow) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }

      const events = db.select({
        storeId: providerDebtEvents.storeId,
        type: providerDebtEvents.type,
        amount: providerDebtEvents.amount,
      }).from(providerDebtEvents).where(eq(providerDebtEvents.providerId, providerId)).all()

      const byStore = new Map<string, number>()
      for (const evt of events) {
        const delta = evt.type === 'debt' ? evt.amount : -evt.amount
        byStore.set(evt.storeId, (byStore.get(evt.storeId) ?? 0) + delta)
      }

      const credits = [...byStore.entries()]
        .filter(([, bal]) => bal < 0)
        .map(([storeId, bal]) => ({ storeId, remaining: -bal }))
      const debts = [...byStore.entries()]
        .filter(([, bal]) => bal > 0)
        .map(([storeId, bal]) => ({ storeId, remaining: bal }))

      if (credits.length === 0 || debts.length === 0) {
        return { ok: false, error: 'No hay saldos a compensar entre locales.', code: 'CONFLICT' }
      }

      ensureLocalUser(db, session, now)

      const toInsert: Array<{ id: string; storeId: string; type: 'debt' | 'payment'; amount: number }> = []
      let i = 0
      let j = 0
      while (i < credits.length && j < debts.length) {
        const take = Math.min(credits[i].remaining, debts[j].remaining)
        toInsert.push({ id: uuidv4(), storeId: credits[i].storeId, type: 'debt', amount: take })
        toInsert.push({ id: uuidv4(), storeId: debts[j].storeId, type: 'payment', amount: take })
        credits[i].remaining -= take
        debts[j].remaining -= take
        if (credits[i].remaining === 0) i++
        if (debts[j].remaining === 0) j++
      }

      db.transaction(tx => {
        for (const row of toInsert) {
          tx.insert(providerDebtEvents).values({
            id: row.id,
            storeId: row.storeId,
            providerId,
            provider: providerRow.name,
            type: row.type,
            amount: row.amount,
            expenseId: null,
            shiftId: session.shiftId ?? null,
            createdAt: now,
            createdBy: session.userId,
            notes: 'Compensación entre locales',
            syncedAt: null,
          }).run()
        }
      })

      const config = getBusinessConfig()
      pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
        log.warn('[ipc:compensate-provider-stores] push falló (no bloqueante)', err)
      )

      log.info('[ipc:compensate-provider-stores] Compensado', { providerId, events: toInsert.length })
      return { ok: true, data: { events: toInsert.length } }
    } catch (err) {
      log.error('[ipc:compensate-provider-stores] Error', err)
      return { ok: false, error: 'Error al compensar saldos.' }
    }
  })

  // -----------------------------------------------------------------------
  // PAY_PROVIDER_FROM_SHIFT — cajera/admin con turno: el efectivo sale de
  //   esta caja y se imputa como pago en uno o varios locales.
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.PAY_PROVIDER_FROM_SHIFT, async (_event, payload: unknown): Promise<IpcResult<{ expenseId: string }>> => {
    const parsed = payProviderFromShiftSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:pay-provider-from-shift] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno abierto.', code: 'NO_SHIFT' }

    const { providerId, allocations, notes } = parsed.data
    const total = allocations.reduce((s, a) => s + a.amount, 0)
    const now = new Date().toISOString()
    const expenseId = uuidv4()

    try {
      const db = getDb()
      const providerRow = db.select({ name: providers.name }).from(providers).where(eq(providers.id, providerId)).get()
      if (!providerRow) return { ok: false, error: 'Proveedor no encontrado.', code: 'NOT_FOUND' }

      for (const a of allocations) {
        const storeRow = db.select({ id: stores.id }).from(stores).where(eq(stores.id, a.storeId)).get()
        if (!storeRow) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }
      }

      ensureLocalUser(db, session, now)

      db.transaction(tx => {
        tx.insert(expenses).values({
          id: expenseId,
          storeId: session.storeId,
          shiftId: session.shiftId!,
          concept: null,
          providerId,
          amount: total,
          notes: notes ?? null,
          createdAt: now,
          createdBy: session.userId,
          syncedAt: null,
        }).run()

        for (const a of allocations) {
          tx.insert(providerDebtEvents).values({
            id: uuidv4(),
            storeId: a.storeId,
            providerId,
            provider: providerRow.name,
            type: 'payment',
            amount: a.amount,
            expenseId,
            shiftId: session.shiftId!,
            createdAt: now,
            createdBy: session.userId,
            syncedAt: null,
          }).run()
        }
      })

      const config = getBusinessConfig()
      pushUnsyncedExpenses(config.tenant_id).catch(err =>
        log.warn('[ipc:pay-provider-from-shift] push gastos falló (no bloqueante)', err)
      )
      pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
        log.warn('[ipc:pay-provider-from-shift] push eventos falló (no bloqueante)', err)
      )

      log.info('[ipc:pay-provider-from-shift] Pago de turno', { providerId, total, expenseId })
      return { ok: true, data: { expenseId } }
    } catch (err) {
      log.error('[ipc:pay-provider-from-shift] Error', err)
      return { ok: false, error: 'Error al registrar el pago.' }
    }
  })

  // -----------------------------------------------------------------------
  // GET_PROVIDERS_WITH_DEBT — admin: agrega deuda cross-local desde Firestore
  //   Fallback a SQLite local si Firebase no disponible (dev / sin conexión).
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.GET_PROVIDERS_WITH_DEBT, async (_event, payload: unknown): Promise<IpcResult<ProviderWithDebtRow[]>> => {
    const parsed = z.object({ includeArchived: z.boolean().optional() }).safeParse(payload ?? {})
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo disponible para admins.', code: 'FORBIDDEN' }

    const includeArchived = parsed.data.includeArchived === true

    try {
      if (isFirebaseAvailable()) {
        return await getProvidersWithDebtFromFirestore(includeArchived)
      }
      return getProvidersWithDebtLocal(includeArchived)
    } catch (err) {
      log.error('[ipc:get-providers-with-debt] Error', err)
      // Fallback gracioso a local si Firestore falla
      try {
        return getProvidersWithDebtLocal(includeArchived)
      } catch (fallbackErr) {
        log.error('[ipc:get-providers-with-debt] Fallback local también falló', fallbackErr)
        return { ok: false, error: 'Error al obtener deuda de proveedores.' }
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

function ensureLocalUser(
  db: ReturnType<typeof getDb>,
  session: ActiveSession,
  now: string,
): void {
  const existingUser = db.select({ id: users.id }).from(users).where(eq(users.id, session.userId)).get()
  if (existingUser) return
  db.insert(users).values({
    id: session.userId,
    storeId: session.storeId,
    name: session.displayName ?? session.userId,
    firebaseUid: session.userId,
    role: 'cashier',
    active: true,
    createdAt: now,
  }).run()
}

async function getProvidersWithDebtFromFirestore(includeArchived: boolean): Promise<IpcResult<ProviderWithDebtRow[]>> {
  const config = getBusinessConfig()
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const db = getDb()

  // Cargar nombres de locales desde SQLite local para resolver storeId → storeName
  const storeRows = db.select({ id: stores.id, name: stores.name }).from(stores).all()
  const storeNameMap = new Map(storeRows.map(s => [s.id, s.name]))

  // Cargar nombres de proveedores desde cache local
  const providerRows = db.select({ id: providers.id, name: providers.name, archivedAt: providers.archivedAt, phone: providers.phone, notes: providers.notes }).from(providers).all()

  interface BalanceEntry { balance: number; providerId: string; storeId: string }
  const balances = new Map<string, BalanceEntry>()

  const live = getLiveProviderStoreBalances()
  if (live.length > 0) {
    for (const row of live) {
      balances.set(`${row.providerId}::${row.storeId}`, {
        balance: row.balance,
        providerId: row.providerId,
        storeId: row.storeId,
      })
    }
  } else {
    // Listener todavía no listo: checkpoints (1 doc por par), nunca el ledger entero.
    const cpSnap = await getDocs(
      collection(firestore, 'licenses', config.tenant_id, PROVIDER_DEBT_CHECKPOINTS_COL),
    )
    for (const d of cpSnap.docs) {
      const data = d.data() as { entityId?: string; storeId?: string; saldoAcumulado?: number }
      if (!data.entityId || !data.storeId) continue
      balances.set(`${data.entityId}::${data.storeId}`, {
        balance: typeof data.saldoAcumulado === 'number' ? data.saldoAcumulado : 0,
        providerId: data.entityId,
        storeId: data.storeId,
      })
    }
  }

  const localEvents = db.select({
    id: providerDebtEvents.id,
    providerId: providerDebtEvents.providerId,
    storeId: providerDebtEvents.storeId,
    type: providerDebtEvents.type,
    amount: providerDebtEvents.amount,
    syncedAt: providerDebtEvents.syncedAt,
  }).from(providerDebtEvents).all()

  for (const evt of localEvents) {
    if (evt.syncedAt != null || !evt.providerId) continue
    const key = `${evt.providerId}::${evt.storeId}`
    const existing = balances.get(key)
    const delta = evt.type === 'debt' ? evt.amount : -evt.amount
    if (existing) existing.balance += delta
    else balances.set(key, { balance: delta, providerId: evt.providerId, storeId: evt.storeId })
  }

  return {
    ok: true,
    data: assembleProviderDebtRows(balances, storeNameMap, providerRows, includeArchived),
  }
}

// ---------------------------------------------------------------------------
// Helpers para GET_PROVIDER_DEBT_HISTORY
// ---------------------------------------------------------------------------

async function getProviderDebtHistoryFromFirestore(providerId: string): Promise<IpcResult<ProviderDebtEventRow[]>> {
  const config = getBusinessConfig()
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const db = getDb()

  const storeRows = db.select({ id: stores.id, name: stores.name }).from(stores).all()
  const storeNameMap = new Map(storeRows.map(s => [s.id, s.name]))

  const userRows = db.select({ id: users.id, name: users.name }).from(users).all()
  const userNameMap = new Map(userRows.map(u => [u.id, u.name]))

  const eventsCol = collection(firestore, 'licenses', config.tenant_id, 'providerDebtEvents')
  const q = query(eventsCol, where('providerId', '==', providerId))
  const snap = await getDocs(q)

  const result: ProviderDebtEventRow[] = []
  const seenIds = new Set<string>()

  for (const docSnap of snap.docs) {
    const evt = docSnap.data() as {
      id?: string
      type: 'debt' | 'payment'
      amount: number
      storeId: string
      createdAt: string
      createdBy: string
      expenseId?: string | null
      deleted?: boolean
      description?: string | null
      notes?: string | null
    }

    if (evt.deleted === true) continue

    seenIds.add(docSnap.id)
    result.push({
      id: docSnap.id,
      type: evt.type,
      amount: evt.amount,
      storeId: evt.storeId,
      storeName: storeNameMap.get(evt.storeId) ?? evt.storeId,
      createdAt: evt.createdAt ?? (evt as { date?: string }).date ?? '',
      createdByName: userNameMap.get(evt.createdBy) ?? evt.createdBy,
      expenseId: evt.expenseId ?? null,
      notes: evt.notes ?? evt.description ?? null,
    })
  }

  // Incluir eventos locales aún no sincronizados con Firestore.
  // Esto garantiza que pagos recién registrados en esta PC aparecen inmediatamente
  // en el historial sin esperar a que el push async a Firestore complete.
  const localResult = getProviderDebtHistoryLocal(providerId)
  if (localResult.ok) {
    for (const evt of localResult.data) {
      if (!seenIds.has(evt.id)) {
        result.push(evt)
      }
    }
  }

  result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  return { ok: true, data: result }
}

function getProviderDebtHistoryLocal(providerId: string): IpcResult<ProviderDebtEventRow[]> {
  const db = getDb()

  const storeRows = db.select({ id: stores.id, name: stores.name }).from(stores).all()
  const storeNameMap = new Map(storeRows.map(s => [s.id, s.name]))

  const userRows = db.select({ id: users.id, name: users.name }).from(users).all()
  const userNameMap = new Map(userRows.map(u => [u.id, u.name]))

  const events = db.select({
    id: providerDebtEvents.id,
    type: providerDebtEvents.type,
    amount: providerDebtEvents.amount,
    storeId: providerDebtEvents.storeId,
    createdAt: providerDebtEvents.createdAt,
    createdBy: providerDebtEvents.createdBy,
    expenseId: providerDebtEvents.expenseId,
    notes: providerDebtEvents.notes,
  })
    .from(providerDebtEvents)
    .where(eq(providerDebtEvents.providerId, providerId))
    .all()

  const result: ProviderDebtEventRow[] = events.map(evt => ({
    id: evt.id,
    type: evt.type,
    amount: evt.amount,
    storeId: evt.storeId,
    storeName: storeNameMap.get(evt.storeId) ?? evt.storeId,
    createdAt: evt.createdAt,
    createdByName: userNameMap.get(evt.createdBy) ?? evt.createdBy,
    expenseId: evt.expenseId ?? null,
    notes: evt.notes ?? null,
  }))

  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return { ok: true, data: result }
}

function getProvidersWithDebtLocal(includeArchived: boolean): IpcResult<ProviderWithDebtRow[]> {
  const db = getDb()

  const storeRows = db.select({ id: stores.id, name: stores.name }).from(stores).all()
  const storeNameMap = new Map(storeRows.map(s => [s.id, s.name]))

  const providerRows = db.select({ id: providers.id, name: providers.name, archivedAt: providers.archivedAt, phone: providers.phone, notes: providers.notes }).from(providers).all()

  const events = db.select({
    providerId: providerDebtEvents.providerId,
    storeId: providerDebtEvents.storeId,
    type: providerDebtEvents.type,
    amount: providerDebtEvents.amount,
  }).from(providerDebtEvents).all()

  const balances = new Map<string, { balance: number; providerId: string; storeId: string }>()

  for (const evt of events) {
    if (!evt.providerId) continue
    const key = `${evt.providerId}::${evt.storeId}`
    const delta = evt.type === 'debt' ? evt.amount : -evt.amount
    const existing = balances.get(key)
    if (existing) {
      existing.balance += delta
    } else {
      balances.set(key, { balance: delta, providerId: evt.providerId, storeId: evt.storeId })
    }
  }

  return {
    ok: true,
    data: assembleProviderDebtRows(balances, storeNameMap, providerRows, includeArchived),
  }
}

function assembleProviderDebtRows(
  balances: Map<string, { balance: number; providerId: string; storeId: string }>,
  storeNameMap: Map<string, string>,
  providerRows: Array<{ id: string; name: string; archivedAt: string | null; phone?: string | null; notes?: string | null }>,
  includeArchived: boolean,
): ProviderWithDebtRow[] {
  const providerNameMap = new Map(providerRows.map(p => [p.id, p.name]))
  const archivedAtMap = new Map(providerRows.map(p => [p.id, p.archivedAt ?? undefined]))
  const phoneMap = new Map(providerRows.map(p => [p.id, p.phone ?? undefined]))
  const notesMap = new Map(providerRows.map(p => [p.id, p.notes ?? undefined]))
  const byProvider = new Map<string, ProviderWithDebtRow>()

  for (const entry of balances.values()) {
    const { providerId, storeId, balance } = entry
    const storeName = storeNameMap.get(storeId) ?? storeId
    const providerName = providerNameMap.get(providerId) ?? providerId
    const archivedAt = archivedAtMap.get(providerId)

    const existing = byProvider.get(providerId)
    if (existing) {
      existing.perStore.push({ storeId, storeName, balance })
      existing.total += balance
    } else {
      byProvider.set(providerId, {
        id: providerId,
        name: providerName,
        total: balance,
        perStore: [{ storeId, storeName, balance }],
        archivedAt,
        phone: phoneMap.get(providerId),
        notes: notesMap.get(providerId),
      })
    }
  }

  for (const p of providerRows) {
    if (byProvider.has(p.id)) continue
    if (p.archivedAt && !includeArchived) continue
    byProvider.set(p.id, {
      id: p.id,
      name: p.name,
      total: 0,
      perStore: [],
      archivedAt: p.archivedAt ?? undefined,
      phone: p.phone ?? undefined,
      notes: p.notes ?? undefined,
    })
  }

  return Array.from(byProvider.values())
    .filter(r => includeArchived || !r.archivedAt)
    .map(r => ({
      ...r,
      perStore: [...r.perStore].sort((a, b) => a.storeName.localeCompare(b.storeName, 'es')),
    }))
    .sort((a, b) => b.total - a.total)
}
