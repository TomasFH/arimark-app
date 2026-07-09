import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, desc, sql } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { expenses, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import type { IpcResult, ExpenseRow } from '../../src/types/hw-api'

/** Categorías predefinidas que se sugieren si el local aún no tiene historial */
const DEFAULT_CATEGORIES = ['Insumos', 'Limpieza', 'Servicios', 'Otros']

const registerExpenseSchema = z.object({
  category: z.string().min(1).max(80).transform(s => s.trim()),
  amount: z.number().positive(),
  notes: z.string().max(300).optional(),
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

    const { category, amount, notes } = parsed.data
    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      getDb()
        .insert(expenses)
        .values({
          id,
          storeId: session.storeId,
          shiftId: session.shiftId,
          category,
          amount,
          notes: notes ?? null,
          createdAt: now,
          createdBy: session.userId,
        })
        .run()

      log.info('[ipc:register-expense] Gasto registrado', { id, category, amount })
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
          amount: expenses.amount,
          notes: expenses.notes,
          createdAt: expenses.createdAt,
          createdBy: expenses.createdBy,
        })
        .from(expenses)
        .where(eq(expenses.shiftId, session.shiftId))
        .orderBy(desc(expenses.createdAt))
        .all()

      // Resolver nombres de usuarios
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
      // Obtener categorías únicas usadas en el local ordenadas por frecuencia de uso
      const used = db
        .selectDistinct({ category: expenses.category })
        .from(expenses)
        .where(eq(expenses.storeId, session.storeId))
        .all()
        .map(r => r.category)
        .filter(Boolean)

      if (used.length === 0) return { ok: true, data: DEFAULT_CATEGORIES }

      // Mezclar: primero las del historial, agregar las predefinidas que no estén ya
      const usedSet = new Set(used.map(c => c.toLowerCase()))
      const extras = DEFAULT_CATEGORIES.filter(c => !usedSet.has(c.toLowerCase()))
      return { ok: true, data: [...used, ...extras] }
    } catch (err) {
      log.error('[ipc:get-expense-categories] Error inesperado', err)
      return { ok: false, error: 'Error al obtener las categorías.' }
    }
  })
}
