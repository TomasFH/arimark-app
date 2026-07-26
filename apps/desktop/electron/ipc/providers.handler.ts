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
import { providers, providerDebtEvents, stores, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { providerIdFromName, providerNameKey } from './providerUtils'
import {
  pushUnsyncedProviders,
  pushUnsyncedDebtEvents,
} from '../licensing/providerSync'
import { getFirebaseApp, isFirebaseAvailable } from '../licensing/firebase'
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore'
import type { IpcResult, ProviderRow, ProviderWithDebtRow, ProviderDebtEventRow } from '../../src/types/hw-api'

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
      const existing = db.select().from(providers).where(eq(providers.id, id)).get()
      if (existing) {
        return {
          ok: true,
          data: {
            id: existing.id,
            name: existing.name,
            phone: existing.phone ?? undefined,
            notes: existing.notes ?? undefined,
            archivedAt: existing.archivedAt ?? undefined,
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
      pushUnsyncedProviders(config.license_key).catch(err =>
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
      if (existing.archivedAt) return { ok: false, error: 'El proveedor está archivado.', code: 'ARCHIVED' }

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
      pushUnsyncedProviders(config.license_key).catch(err =>
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
      pushUnsyncedProviders(config.license_key).catch(err =>
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
      pushUnsyncedDebtEvents(config.license_key).catch(err =>
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
  // GET_PROVIDERS_WITH_DEBT — admin: agrega deuda cross-local desde Firestore
  //   Fallback a SQLite local si Firebase no disponible (dev / sin conexión).
  // -----------------------------------------------------------------------
  ipcMain.handle(IPC.GET_PROVIDERS_WITH_DEBT, async (_event): Promise<IpcResult<ProviderWithDebtRow[]>> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') return { ok: false, error: 'Solo disponible para admins.', code: 'FORBIDDEN' }

    try {
      if (isFirebaseAvailable()) {
        return await getProvidersWithDebtFromFirestore()
      }
      return getProvidersWithDebtLocal()
    } catch (err) {
      log.error('[ipc:get-providers-with-debt] Error', err)
      // Fallback gracioso a local si Firestore falla
      try {
        return getProvidersWithDebtLocal()
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

async function getProvidersWithDebtFromFirestore(): Promise<IpcResult<ProviderWithDebtRow[]>> {
  const config = getBusinessConfig()
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const db = getDb()

  // Cargar nombres de locales desde SQLite local para resolver storeId → storeName
  const storeRows = db.select({ id: stores.id, name: stores.name }).from(stores).all()
  const storeNameMap = new Map(storeRows.map(s => [s.id, s.name]))

  // Cargar nombres de proveedores desde cache local
  const providerRows = db.select({ id: providers.id, name: providers.name, archivedAt: providers.archivedAt }).from(providers).all()
  const providerNameMap = new Map(providerRows.map(p => [p.id, p.name]))

  // Leer todos los eventos de deuda desde Firestore
  const eventsCol = collection(firestore, 'licenses', config.license_key, 'providerDebtEvents')
  const snap = await getDocs(eventsCol)

  interface BalanceEntry { balance: number; providerId: string; storeId: string }
  const balances = new Map<string, BalanceEntry>()
  const firestoreIds = new Set<string>()

  for (const docSnap of snap.docs) {
    const evt = docSnap.data() as {
      providerId?: string | null
      provider: string
      storeId: string
      type: 'debt' | 'payment'
      amount: number
      deleted?: boolean
    }

    // Ignorar eventos marcados como eliminados (borrado lógico al editar/eliminar gastos)
    if (evt.deleted === true) continue

    const pid = evt.providerId ?? null
    if (!pid) continue

    firestoreIds.add(docSnap.id)
    const key = `${pid}::${evt.storeId}`
    const existing = balances.get(key)
    const delta = evt.type === 'debt' ? evt.amount : -evt.amount

    if (existing) {
      existing.balance += delta
    } else {
      balances.set(key, { balance: delta, providerId: pid, storeId: evt.storeId })
    }
  }

  // Mezclar con eventos locales aún no sincronizados con Firestore.
  // Garantiza que pagos recién registrados en esta PC (ej. settleProviderDebt)
  // impacten el balance inmediatamente sin esperar el push async.
  const localEvents = db.select({
    id: providerDebtEvents.id,
    providerId: providerDebtEvents.providerId,
    storeId: providerDebtEvents.storeId,
    type: providerDebtEvents.type,
    amount: providerDebtEvents.amount,
  }).from(providerDebtEvents).all()

  for (const evt of localEvents) {
    if (firestoreIds.has(evt.id)) continue   // ya contado desde Firestore
    if (!evt.providerId) continue
    const key = `${evt.providerId}::${evt.storeId}`
    const existing = balances.get(key)
    const delta = evt.type === 'debt' ? evt.amount : -evt.amount
    if (existing) {
      existing.balance += delta
    } else {
      balances.set(key, { balance: delta, providerId: evt.providerId, storeId: evt.storeId })
    }
  }

  // Agregar por proveedor, construir perStore[]
  const byProvider = new Map<string, ProviderWithDebtRow>()

  for (const entry of balances.values()) {
    const { providerId, storeId, balance } = entry
    const storeName = storeNameMap.get(storeId) ?? storeId
    const providerName = providerNameMap.get(providerId) ?? providerId

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
      })
    }
  }

  // Incluir proveedores sin deuda pendiente que existan en cache local
  for (const p of providerRows) {
    if (!p.archivedAt && !byProvider.has(p.id)) {
      byProvider.set(p.id, { id: p.id, name: p.name, total: 0, perStore: [] })
    }
  }

  const result = Array.from(byProvider.values())
    .sort((a, b) => b.total - a.total)

  return { ok: true, data: result }
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

  const eventsCol = collection(firestore, 'licenses', config.license_key, 'providerDebtEvents')
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
    }

    if (evt.deleted === true) continue

    seenIds.add(docSnap.id)
    result.push({
      id: docSnap.id,
      type: evt.type,
      amount: evt.amount,
      storeId: evt.storeId,
      storeName: storeNameMap.get(evt.storeId) ?? evt.storeId,
      createdAt: evt.createdAt,
      createdByName: userNameMap.get(evt.createdBy) ?? evt.createdBy,
      expenseId: evt.expenseId ?? null,
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

  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

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
  }))

  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return { ok: true, data: result }
}

function getProvidersWithDebtLocal(): IpcResult<ProviderWithDebtRow[]> {
  const db = getDb()

  const storeRows = db.select({ id: stores.id, name: stores.name }).from(stores).all()
  const storeNameMap = new Map(storeRows.map(s => [s.id, s.name]))

  const providerRows = db.select({ id: providers.id, name: providers.name, archivedAt: providers.archivedAt }).from(providers).all()
  const providerNameMap = new Map(providerRows.map(p => [p.id, p.name]))

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

  const byProvider = new Map<string, ProviderWithDebtRow>()

  for (const entry of balances.values()) {
    const { providerId, storeId, balance } = entry
    const storeName = storeNameMap.get(storeId) ?? storeId
    const providerName = providerNameMap.get(providerId) ?? providerId

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
      })
    }
  }

  for (const p of providerRows) {
    if (!p.archivedAt && !byProvider.has(p.id)) {
      byProvider.set(p.id, { id: p.id, name: p.name, total: 0, perStore: [] })
    }
  }

  return {
    ok: true,
    data: Array.from(byProvider.values()).sort((a, b) => b.total - a.total),
  }
}
