import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, desc, sql, and, sum, isNotNull } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { expenses, providerDebtEvents, providers, stores, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { providerIdFromName, providerNameKey } from './providerUtils'
import { pushUnsyncedProviders, pushUnsyncedDebtEvents, markDebtEventsDeletedInFirestore } from '../licensing/providerSync'
import { pushUnsyncedExpenses, markExpensesDeletedInFirestore } from '../licensing/expenseSync'
import type { IpcResult, ExpenseRow, ProviderDebtRow } from '../../src/types/hw-api'

/** Conceptos predefinidos que se sugieren si el local aún no tiene historial */
const DEFAULT_CONCEPTS = ['Insumos', 'Limpieza', 'Servicios', 'Otros']

/** Campos base (sin refine) reutilizados por register y update. */
const expenseBaseSchema = z.object({
  /** Concepto libre del gasto (obligatorio cuando no hay proveedor). */
  concept: z.string().max(80).transform(s => s.trim()).optional(),
  /** ID del proveedor elegido del autocomplete (ya existe en cache). */
  providerId: z.string().min(1).optional(),
  /** Nombre de proveedor nuevo tipeado (no existe en cache). Se crea al guardar. */
  provider: z.string().max(100).transform(s => s.trim()).optional(),
  amount: z.number().positive(),
  notes: z.string().max(300).optional(),
  /** Monto que quedó sin pagar al proveedor en esta visita (genera deuda nueva) */
  newDebtAmount: z.number().min(0).optional(),
  /** Monto de deuda anterior al proveedor que se paga en este gasto */
  paysOldDebt: z.number().min(0).optional(),
  /**
   * Local al que se imputa la deuda con el proveedor.
   * Si se omite, se usa el local de la sesión activa.
   * El gasto (expenses.storeId) siempre queda en el local de la sesión.
   */
  debtStoreId: z.string().min(1).optional(),
})

const providerOrConceptRefine = (data: { providerId?: string; provider?: string; concept?: string }) =>
  data.providerId || (data.provider && data.provider.length > 0) || (data.concept && data.concept.length > 0)

const registerExpenseSchema = expenseBaseSchema.refine(
  providerOrConceptRefine,
  { message: 'Se requiere proveedor (id o nombre) o concepto.' }
)

const updateExpenseSchema = expenseBaseSchema.extend({ id: z.string().uuid() }).refine(
  providerOrConceptRefine,
  { message: 'Se requiere proveedor (id o nombre) o concepto.' }
)

const getProviderDebtSchema = z.object({
  /** ID del proveedor (determinístico, hex del nameKey). */
  providerId: z.string().min(1),
  /** Local cuya deuda se consulta. Si se omite, usa el local de la sesión activa. */
  storeId: z.string().min(1).optional(),
})

export function registerExpenseHandlers(): void {
  ipcMain.handle(IPC.REGISTER_EXPENSE, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = registerExpenseSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:register-expense] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    const { concept, amount, notes, newDebtAmount, paysOldDebt, debtStoreId } = parsed.data
    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      const db = getDb()

      // Validar debtStoreId si se proveyó
      if (debtStoreId) {
        const storeRow = db.select({ id: stores.id }).from(stores).where(eq(stores.id, debtStoreId)).get()
        if (!storeRow) {
          return { ok: false, error: 'El local de deuda especificado no existe.', code: 'INVALID_DEBT_STORE' }
        }
      }

      // El local de la deuda puede ser diferente al local de la sesión (pago cross-local)
      const effectiveDebtStoreId = debtStoreId ?? session.storeId

      // Resolver identidad del proveedor
      let resolvedProviderId: string | null = null
      let resolvedProviderName: string | null = null

      if (parsed.data.providerId) {
        // Vino del autocomplete — usar el id exacto, no recomputar
        resolvedProviderId = parsed.data.providerId
        const prov = db.select({ name: providers.name }).from(providers)
          .where(eq(providers.id, resolvedProviderId)).get()
        resolvedProviderName = prov?.name ?? resolvedProviderId
      } else if (parsed.data.provider && parsed.data.provider.length > 0) {
        // Nombre nuevo tipeado — upsert en cache con id determinístico
        const provName = parsed.data.provider
        resolvedProviderId = providerIdFromName(provName)
        resolvedProviderName = provName

        const existing = db.select().from(providers).where(eq(providers.id, resolvedProviderId)).get()
        if (!existing) {
          db.insert(providers).values({
            id: resolvedProviderId,
            name: provName,
            nameKey: providerNameKey(provName),
            createdAt: now,
            createdBy: session.userId,
            syncedAt: null,
          }).run()
        }
      }

      db.transaction(tx => {
        // El gasto siempre se registra en el local de la sesión (el dinero salió de esa caja)
        tx.insert(expenses).values({
          id,
          storeId: session.storeId,
          shiftId: session.shiftId!,
          concept: concept ?? null,
          providerId: resolvedProviderId,
          amount,
          notes: notes ?? null,
          createdAt: now,
          createdBy: session.userId,
          syncedAt: null,
        }).run()

        if (resolvedProviderId && resolvedProviderName) {
          // Los eventos de deuda se imputan al local efectivo (puede ser otro local)
          if (newDebtAmount && newDebtAmount > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: effectiveDebtStoreId,
              providerId: resolvedProviderId,
              provider: resolvedProviderName,
              type: 'debt',
              amount: newDebtAmount,
              expenseId: id,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            }).run()
          }
          if (paysOldDebt && paysOldDebt > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: effectiveDebtStoreId,
              providerId: resolvedProviderId,
              provider: resolvedProviderName,
              type: 'payment',
              amount: paysOldDebt,
              expenseId: id,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            }).run()
          }
        }
      })

      // Push no bloqueante
      const config = getBusinessConfig()
      pushUnsyncedExpenses(config.tenant_id).catch(err =>
        log.warn('[ipc:register-expense] pushUnsyncedExpenses falló', err)
      )
      if (resolvedProviderId) {
        pushUnsyncedProviders(config.tenant_id).catch(err =>
          log.warn('[ipc:register-expense] pushUnsyncedProviders falló', err)
        )
        pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
          log.warn('[ipc:register-expense] pushUnsyncedDebtEvents falló', err)
        )
      }

      log.info('[ipc:register-expense] Gasto registrado', { id, concept, amount, providerId: resolvedProviderId })
      return { ok: true, data: { id } }
    } catch (err) {
      log.error('[ipc:register-expense] Error inesperado', err)
      return { ok: false, error: 'Error al registrar el gasto.' }
    }
  })

  // UPDATE_EXPENSE — modifica un gasto existente del turno activo y regenera sus eventos de deuda
  ipcMain.handle(IPC.UPDATE_EXPENSE, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = updateExpenseSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-expense] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    const { id, concept, amount, notes, newDebtAmount, paysOldDebt, debtStoreId } = parsed.data

    try {
      const db = getDb()

      // Verificar que el gasto pertenece al turno activo
      const existing = db.select({ shiftId: expenses.shiftId })
        .from(expenses).where(eq(expenses.id, id)).get()
      if (!existing) return { ok: false, error: 'Gasto no encontrado.' }
      if (existing.shiftId !== session.shiftId) {
        return { ok: false, error: 'Solo se pueden editar gastos del turno activo.' }
      }

      // Validar debtStoreId si se proveyó
      if (debtStoreId) {
        const storeRow = db.select({ id: stores.id }).from(stores).where(eq(stores.id, debtStoreId)).get()
        if (!storeRow) {
          return { ok: false, error: 'El local de deuda especificado no existe.', code: 'INVALID_DEBT_STORE' }
        }
      }

      const effectiveDebtStoreId = debtStoreId ?? session.storeId
      const now = new Date().toISOString()

      // Capturar IDs de eventos ya sincronizados ANTES de que la transacción los elimine
      const syncedOldEventIds = db
        .select({ id: providerDebtEvents.id, syncedAt: providerDebtEvents.syncedAt })
        .from(providerDebtEvents)
        .where(eq(providerDebtEvents.expenseId, id))
        .all()
        .filter(e => e.syncedAt != null)
        .map(e => e.id)

      // Resolver identidad del proveedor (misma lógica que REGISTER)
      let resolvedProviderId: string | null = null
      let resolvedProviderName: string | null = null

      if (parsed.data.providerId) {
        resolvedProviderId = parsed.data.providerId
        const prov = db.select({ name: providers.name }).from(providers)
          .where(eq(providers.id, resolvedProviderId!)).get()
        resolvedProviderName = prov?.name ?? resolvedProviderId
      } else if (parsed.data.provider && parsed.data.provider.length > 0) {
        const provName = parsed.data.provider
        resolvedProviderId = providerIdFromName(provName)
        resolvedProviderName = provName
        const existingProv = db.select().from(providers).where(eq(providers.id, resolvedProviderId)).get()
        if (!existingProv) {
          db.insert(providers).values({
            id: resolvedProviderId,
            name: provName,
            nameKey: providerNameKey(provName),
            createdAt: now,
            createdBy: session.userId,
            syncedAt: null,
          }).run()
        }
      }

      db.transaction(tx => {
        // Actualizar gasto (siempre en el local de la sesión)
        tx.update(expenses).set({
          concept: concept ?? null,
          providerId: resolvedProviderId,
          amount,
          notes: notes ?? null,
          syncedAt: null,
        }).where(eq(expenses.id, id)).run()

        // Eliminar eventos de deuda anteriores de este gasto y recrearlos
        tx.delete(providerDebtEvents).where(eq(providerDebtEvents.expenseId, id)).run()

        if (resolvedProviderId && resolvedProviderName) {
          // Los eventos de deuda se imputan al local efectivo (puede ser otro local)
          if (newDebtAmount && newDebtAmount > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: effectiveDebtStoreId,
              providerId: resolvedProviderId,
              provider: resolvedProviderName,
              type: 'debt',
              amount: newDebtAmount,
              expenseId: id,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            }).run()
          }
          if (paysOldDebt && paysOldDebt > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: effectiveDebtStoreId,
              providerId: resolvedProviderId,
              provider: resolvedProviderName,
              type: 'payment',
              amount: paysOldDebt,
              expenseId: id,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            }).run()
          }
        }
      })

      // Push no bloqueante (syncedAt ya quedó null en el update)
      const config = getBusinessConfig()
      pushUnsyncedExpenses(config.tenant_id).catch(err =>
        log.warn('[ipc:update-expense] pushUnsyncedExpenses falló', err)
      )
      if (resolvedProviderId) {
        pushUnsyncedProviders(config.tenant_id).catch(err =>
          log.warn('[ipc:update-expense] pushUnsyncedProviders falló', err)
        )
        pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
          log.warn('[ipc:update-expense] pushUnsyncedDebtEvents falló', err)
        )
      }

      // Marcar como eliminados los eventos viejos que ya estaban en Firestore
      if (syncedOldEventIds.length > 0) {
        markDebtEventsDeletedInFirestore(config.tenant_id, syncedOldEventIds).catch(err =>
          log.error('[ipc:update-expense] markDebtEventsDeletedInFirestore falló', err)
        )
      }

      log.info('[ipc:update-expense] Gasto actualizado', { id, concept, amount })
      return { ok: true, data: { id } }
    } catch (err) {
      log.error('[ipc:update-expense] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el gasto.' }
    }
  })

  // DELETE_EXPENSE — elimina un gasto y sus eventos de deuda en una transacción atómica
  ipcMain.handle(IPC.DELETE_EXPENSE, async (_event, payload: unknown): Promise<IpcResult<undefined>> => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    const { id } = parsed.data

    try {
      const db = getDb()

      const existing = db.select({ shiftId: expenses.shiftId })
        .from(expenses).where(eq(expenses.id, id)).get()
      if (!existing) return { ok: false, error: 'Gasto no encontrado.' }
      if (existing.shiftId !== session.shiftId) {
        return { ok: false, error: 'Solo se pueden eliminar gastos del turno activo.' }
      }

      // Antes de borrar, capturar IDs ya sincronizados (gasto + eventos de deuda)
      const expenseSyncedAt = db
        .select({ syncedAt: expenses.syncedAt })
        .from(expenses)
        .where(eq(expenses.id, id))
        .get()?.syncedAt
      const syncedEventIds = db
        .select({ id: providerDebtEvents.id, syncedAt: providerDebtEvents.syncedAt })
        .from(providerDebtEvents)
        .where(eq(providerDebtEvents.expenseId, id))
        .all()
        .filter(e => e.syncedAt != null)
        .map(e => e.id)

      db.transaction(tx => {
        tx.delete(providerDebtEvents).where(eq(providerDebtEvents.expenseId, id)).run()
        tx.delete(expenses).where(eq(expenses.id, id)).run()
      })

      const config = getBusinessConfig()
      // Soft-delete del gasto en Firestore si ya había sido sincronizado
      if (expenseSyncedAt != null) {
        markExpensesDeletedInFirestore(config.tenant_id, [id]).catch(err =>
          log.error('[ipc:delete-expense] markExpensesDeletedInFirestore falló', err)
        )
      }
      // Marcar como eliminados en Firestore los eventos que ya habían sido sincronizados
      if (syncedEventIds.length > 0) {
        markDebtEventsDeletedInFirestore(config.tenant_id, syncedEventIds).catch(err =>
          log.error('[ipc:delete-expense] markDebtEventsDeletedInFirestore falló', err)
        )
      }

      log.info('[ipc:delete-expense] Gasto eliminado', { id })
      return { ok: true, data: undefined }
    } catch (err) {
      log.error('[ipc:delete-expense] Error inesperado', err)
      return { ok: false, error: 'Error al eliminar el gasto.' }
    }
  })

  ipcMain.handle(IPC.GET_SHIFT_EXPENSES, (_event): IpcResult<ExpenseRow[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    try {
      const db = getDb()
      const rows = db
        .select({
          id: expenses.id,
          concept: expenses.concept,
          providerId: expenses.providerId,
          amount: expenses.amount,
          notes: expenses.notes,
          createdAt: expenses.createdAt,
          createdBy: expenses.createdBy,
        })
        .from(expenses)
        .where(eq(expenses.shiftId, session.shiftId))
        .orderBy(desc(expenses.createdAt))
        .all()

      const userIds = [...new Set(rows.map(r => r.createdBy))]
      const userRows = userIds.length > 0
        ? db.select({ id: users.id, name: users.name }).from(users)
            .where(sql`${users.id} IN ${userIds}`)
            .all()
        : []
      const userMap = new Map(userRows.map(u => [u.id, u.name]))

      // Resolver nombres de proveedor para las filas que tienen providerId
      const providerIds = [...new Set(rows.map(r => r.providerId).filter(Boolean) as string[])]
      const providerRows = providerIds.length > 0
        ? db.select({ id: providers.id, name: providers.name }).from(providers)
            .where(sql`${providers.id} IN ${providerIds}`)
            .all()
        : []
      const providerMap = new Map(providerRows.map(p => [p.id, p.name]))

      // Traer eventos de deuda asociados a gastos de este turno
      const expenseIds = rows.map(r => r.id)
      const debtEvents = expenseIds.length > 0
        ? db.select({
            expenseId: providerDebtEvents.expenseId,
            type: providerDebtEvents.type,
            amount: providerDebtEvents.amount,
          })
          .from(providerDebtEvents)
          .where(sql`${providerDebtEvents.expenseId} IN ${expenseIds}`)
          .all()
        : []

      // Agrupar eventos por expenseId
      const debtByExpense = new Map<string, { newDebt: number; paysOld: number }>()
      for (const ev of debtEvents) {
        if (!ev.expenseId) continue
        const cur = debtByExpense.get(ev.expenseId) ?? { newDebt: 0, paysOld: 0 }
        if (ev.type === 'debt') cur.newDebt += Number(ev.amount)
        if (ev.type === 'payment') cur.paysOld += Number(ev.amount)
        debtByExpense.set(ev.expenseId, cur)
      }

      return {
        ok: true,
        data: rows.map(r => {
          const debt = debtByExpense.get(r.id)
          return {
            id: r.id,
            concept: r.concept ?? undefined,
            provider: r.providerId ? (providerMap.get(r.providerId) ?? r.providerId) : undefined,
            providerId: r.providerId ?? undefined,
            amount: r.amount,
            newDebtAmount: debt?.newDebt && debt.newDebt > 0 ? debt.newDebt : undefined,
            paysOldDebt: debt?.paysOld && debt.paysOld > 0 ? debt.paysOld : undefined,
            notes: r.notes ?? undefined,
            createdAt: r.createdAt,
            createdBy: userMap.get(r.createdBy) ?? r.createdBy,
          }
        }),
      }
    } catch (err) {
      log.error('[ipc:get-shift-expenses] Error inesperado', err)
      return { ok: false, error: 'Error al obtener los gastos.' }
    }
  })

  // GET_EXPENSE_CATEGORIES — retorna conceptos usados anteriormente en este local (para sugerencias)
  ipcMain.handle(IPC.GET_EXPENSE_CATEGORIES, (_event): IpcResult<string[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const used = db
        .selectDistinct({ concept: expenses.concept })
        .from(expenses)
        .where(and(eq(expenses.storeId, session.storeId), isNotNull(expenses.concept)))
        .all()
        .map(r => r.concept)
        .filter((c): c is string => Boolean(c))

      if (used.length === 0) return { ok: true, data: DEFAULT_CONCEPTS }

      const usedSet = new Set(used.map(c => c.toLowerCase()))
      const extras = DEFAULT_CONCEPTS.filter(c => !usedSet.has(c.toLowerCase()))
      return { ok: true, data: [...used, ...extras] }
    } catch (err) {
      log.error('[ipc:get-expense-categories] Error inesperado', err)
      return { ok: false, error: 'Error al obtener los conceptos.' }
    }
  })

  // GET_PROVIDER_DEBT — saldo actual de deuda hacia un proveedor
  //   Si el payload incluye storeId, consulta ese local; de lo contrario usa el local de la sesión.
  ipcMain.handle(IPC.GET_PROVIDER_DEBT, (_event, payload: unknown): IpcResult<ProviderDebtRow | null> => {
    const parsed = getProviderDebtSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const { providerId, storeId: payloadStoreId } = parsed.data
      const effectiveStoreId = payloadStoreId ?? session.storeId

      // Buscar nombre del proveedor
      const provRow = db.select({ name: providers.name })
        .from(providers).where(eq(providers.id, providerId)).get()
      const providerName = provRow?.name ?? providerId

      const debtRows = db
        .select({ total: sum(providerDebtEvents.amount), lastAt: sql<string>`MAX(${providerDebtEvents.createdAt})` })
        .from(providerDebtEvents)
        .where(and(
          eq(providerDebtEvents.storeId, effectiveStoreId),
          eq(providerDebtEvents.providerId, providerId),
          eq(providerDebtEvents.type, 'debt'),
        ))
        .all()

      const paymentRows = db
        .select({ total: sum(providerDebtEvents.amount) })
        .from(providerDebtEvents)
        .where(and(
          eq(providerDebtEvents.storeId, effectiveStoreId),
          eq(providerDebtEvents.providerId, providerId),
          eq(providerDebtEvents.type, 'payment'),
        ))
        .all()

      const totalDebt = Number(debtRows[0]?.total ?? 0)
      const totalPaid = Number(paymentRows[0]?.total ?? 0)
      const balance = totalDebt - totalPaid

      // Sin eventos de deuda → nunca hubo deuda con este proveedor en este local
      if (!debtRows[0]?.lastAt) return { ok: true, data: null }

      // Si hay deuda saldada, obtener info del último pago para mostrar quién lo hizo
      let lastPaymentBy: string | undefined
      let lastPaymentStoreName: string | undefined
      let lastPaymentAt: string | undefined
      if (balance <= 0) {
        const lastPayment = db
          .select({
            createdBy: providerDebtEvents.createdBy,
            storeId: providerDebtEvents.storeId,
            createdAt: providerDebtEvents.createdAt,
          })
          .from(providerDebtEvents)
          .where(and(
            eq(providerDebtEvents.storeId, effectiveStoreId),
            eq(providerDebtEvents.providerId, providerId),
            eq(providerDebtEvents.type, 'payment'),
          ))
          .orderBy(desc(providerDebtEvents.createdAt))
          .limit(1)
          .get()

        if (lastPayment) {
          lastPaymentAt = lastPayment.createdAt
          if (lastPayment.createdBy) {
            const payerUser = db.select({ name: users.name }).from(users)
              .where(eq(users.id, lastPayment.createdBy)).get()
            lastPaymentBy = payerUser?.name ?? lastPayment.createdBy
          }
          if (lastPayment.storeId !== effectiveStoreId) {
            const payerStore = db.select({ name: stores.name }).from(stores)
              .where(eq(stores.id, lastPayment.storeId)).get()
            lastPaymentStoreName = payerStore?.name
          }
        }
      }

      return {
        ok: true,
        data: {
          provider: providerName,
          providerId,
          balance: Math.max(0, balance),
          lastEventAt: debtRows[0]?.lastAt ?? '',
          lastPaymentBy,
          lastPaymentStoreName,
          lastPaymentAt,
        },
      }
    } catch (err) {
      log.error('[ipc:get-provider-debt] Error inesperado', err)
      return { ok: false, error: 'Error al consultar la deuda del proveedor.' }
    }
  })

  // GET_PROVIDER_NAMES — nombres de proveedores desde cache (para autocomplete legacy)
  // Preferir LIST_PROVIDERS para nuevos usos.
  ipcMain.handle(IPC.GET_PROVIDER_NAMES, (_event): IpcResult<string[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const rows = db
        .select({ name: providers.name })
        .from(providers)
        .where(sql`${providers.archivedAt} IS NULL`)
        .all()
        .map(r => r.name)
      return { ok: true, data: rows }
    } catch (err) {
      log.error('[ipc:get-provider-names] Error inesperado', err)
      return { ok: false, error: 'Error al obtener los proveedores.' }
    }
  })
}
