import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, desc, sql, and, sum } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { expenses, providerDebtEvents, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { IpcResult, ExpenseRow, ProviderDebtRow } from '../../src/types/hw-api'

/** Categorías predefinidas que se sugieren si el local aún no tiene historial */
const DEFAULT_CATEGORIES = ['Insumos', 'Limpieza', 'Servicios', 'Otros']

const registerExpenseSchema = z.object({
  category: z.string().min(1).max(80).transform(s => s.trim()),
  amount: z.number().positive(),
  notes: z.string().max(300).optional(),
  provider: z.string().max(100).transform(s => s.trim()).optional(),
  /** Monto que quedó sin pagar al proveedor en esta visita (genera deuda nueva) */
  newDebtAmount: z.number().min(0).optional(),
  /** Monto de deuda anterior al proveedor que se paga en este gasto */
  paysOldDebt: z.number().min(0).optional(),
})

const getProviderDebtSchema = z.object({
  provider: z.string().min(1).max(100).transform(s => s.trim()),
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

    const { category, amount, notes, provider, newDebtAmount, paysOldDebt } = parsed.data
    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      const db = getDb()

      db.transaction(tx => {
        tx.insert(expenses)
          .values({
            id,
            storeId: session.storeId,
            shiftId: session.shiftId!,
            category,
            provider: provider ?? null,
            amount,
            notes: notes ?? null,
            createdAt: now,
            createdBy: session.userId,
          })
          .run()

        // Registrar eventos de deuda si corresponde
        if (provider && provider.length > 0) {
          if (newDebtAmount && newDebtAmount > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: session.storeId,
              provider,
              type: 'debt',
              amount: newDebtAmount,
              expenseId: id,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
            }).run()
          }
          if (paysOldDebt && paysOldDebt > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: session.storeId,
              provider,
              type: 'payment',
              amount: paysOldDebt,
              expenseId: id,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
            }).run()
          }
        }
      })

      log.info('[ipc:register-expense] Gasto registrado', { id, category, amount, provider, newDebtAmount, paysOldDebt })
      return { ok: true, data: { id } }
    } catch (err) {
      log.error('[ipc:register-expense] Error inesperado', err)
      return { ok: false, error: 'Error al registrar el gasto.' }
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
          category: expenses.category,
          provider: expenses.provider,
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

      return {
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          category: r.category,
          provider: r.provider,
          amount: r.amount,
          notes: r.notes,
          createdAt: r.createdAt,
          createdBy: userMap.get(r.createdBy) ?? r.createdBy,
        })),
      }
    } catch (err) {
      log.error('[ipc:get-shift-expenses] Error inesperado', err)
      return { ok: false, error: 'Error al obtener los gastos.' }
    }
  })

  ipcMain.handle(IPC.GET_EXPENSE_CATEGORIES, (_event): IpcResult<string[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const used = db
        .selectDistinct({ category: expenses.category })
        .from(expenses)
        .where(eq(expenses.storeId, session.storeId))
        .all()
        .map(r => r.category)
        .filter(Boolean)

      if (used.length === 0) return { ok: true, data: DEFAULT_CATEGORIES }

      const usedSet = new Set(used.map(c => c.toLowerCase()))
      const extras = DEFAULT_CATEGORIES.filter(c => !usedSet.has(c.toLowerCase()))
      return { ok: true, data: [...used, ...extras] }
    } catch (err) {
      log.error('[ipc:get-expense-categories] Error inesperado', err)
      return { ok: false, error: 'Error al obtener las categorías.' }
    }
  })

  // GET_PROVIDER_DEBT — consulta saldo actual de deuda hacia un proveedor
  ipcMain.handle(IPC.GET_PROVIDER_DEBT, (_event, payload: unknown): IpcResult<ProviderDebtRow | null> => {
    const parsed = getProviderDebtSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const provider = parsed.data.provider

      // Suma de deudas
      const debtRows = db
        .select({ total: sum(providerDebtEvents.amount), lastAt: sql<string>`MAX(${providerDebtEvents.createdAt})` })
        .from(providerDebtEvents)
        .where(and(
          eq(providerDebtEvents.storeId, session.storeId),
          eq(providerDebtEvents.provider, provider),
          eq(providerDebtEvents.type, 'debt'),
        ))
        .all()

      const paymentRows = db
        .select({ total: sum(providerDebtEvents.amount) })
        .from(providerDebtEvents)
        .where(and(
          eq(providerDebtEvents.storeId, session.storeId),
          eq(providerDebtEvents.provider, provider),
          eq(providerDebtEvents.type, 'payment'),
        ))
        .all()

      const totalDebt = Number(debtRows[0]?.total ?? 0)
      const totalPaid = Number(paymentRows[0]?.total ?? 0)
      const balance = totalDebt - totalPaid

      if (balance <= 0 && !debtRows[0]?.lastAt) return { ok: true, data: null }

      return {
        ok: true,
        data: {
          provider,
          balance: Math.max(0, balance),
          lastEventAt: debtRows[0]?.lastAt ?? '',
        },
      }
    } catch (err) {
      log.error('[ipc:get-provider-debt] Error inesperado', err)
      return { ok: false, error: 'Error al consultar la deuda del proveedor.' }
    }
  })

  // GET_PROVIDER_NAMES — nombres de proveedores con historial (para autocomplete)
  ipcMain.handle(IPC.GET_PROVIDER_NAMES, (_event): IpcResult<string[]> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const rows = db
        .selectDistinct({ provider: expenses.provider })
        .from(expenses)
        .where(and(eq(expenses.storeId, session.storeId), sql`${expenses.provider} IS NOT NULL`))
        .all()
        .map(r => r.provider)
        .filter((p): p is string => Boolean(p))
      return { ok: true, data: rows }
    } catch (err) {
      log.error('[ipc:get-provider-names] Error inesperado', err)
      return { ok: false, error: 'Error al obtener los proveedores.' }
    }
  })
}
