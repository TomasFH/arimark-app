import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { ceboEntries, salePayments, sales, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedCebo, pullCeboForStoreWeek } from '../licensing/ceboSync'
import { pushUnsyncedSales } from '../licensing/saleSync'
import { notifySaleOccurred } from './inactivityDaemon'
import { insertConfirmedSeboSale, syncSeboSaleQuantity, type SeboPaymentMethod } from './ceboSale'
import { mondayWeekRange } from '@carniceria/shared'
import type { IpcResult } from '../../src/types/hw-api'

export const CEBO_NOTES_MAX = 300

const paymentMethodSchema = z.enum(['cash', 'debit', 'wallet', 'credit'])

export interface CeboEntryRow {
  id: string
  quantityKg: number
  notes: string | null
  createdById: string
  createdByName: string
  createdAt: string
  updatedByName: string | null
  updatedAt: string | null
  canEdit: boolean
  amount: number | null
  paymentMethod: SeboPaymentMethod | null
}

const listSchema = z.object({
  weekOffset: z.number().int().min(-104).max(0).optional(),
})

const registerSchema = z.object({
  quantityKg: z.number().positive().max(9_999),
  notes: z.string().max(CEBO_NOTES_MAX).optional(),
  amount: z.number().int().positive().max(999_999_999).optional(),
  paymentMethod: paymentMethodSchema.optional(),
}).refine(
  data => (data.amount == null) === (data.paymentMethod == null),
  { message: 'El importe y el medio de pago van juntos.' },
)

const updateSchema = z.object({
  id: z.string().uuid(),
  quantityKg: z.number().positive().max(9_999),
  notes: z.string().max(CEBO_NOTES_MAX).optional(),
  amount: z.number().int().positive().max(999_999_999).optional(),
  paymentMethod: paymentMethodSchema.optional(),
}).refine(
  data => (data.amount == null) === (data.paymentMethod == null),
  { message: 'El importe y el medio de pago van juntos.' },
)

function canEditCebo(
  role: 'cashier' | 'admin',
  userId: string,
  createdBy: string,
): boolean {
  return role === 'admin' || createdBy === userId
}

function namesById(db: ReturnType<typeof getDb>, ids: string[]): Map<string, string> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const rows = db.select({ id: users.id, name: users.name }).from(users).all()
    .filter(u => unique.includes(u.id))
  return new Map(rows.map(u => [u.id, u.name]))
}

function asPaymentMethod(value: string | null): SeboPaymentMethod | null {
  if (value === 'cash' || value === 'debit' || value === 'wallet' || value === 'credit') return value
  return null
}

function pushSaleQuietly(tenantId: string, channel: string): void {
  pushUnsyncedSales(tenantId).catch(err =>
    log.warn(`[${channel}] pushUnsyncedSales falló`, err),
  )
}

export function registerCeboHandlers(): void {
  ipcMain.handle(IPC.LIST_SHIFT_CEBO, async (_event, payload: unknown): Promise<IpcResult<CeboEntryRow[]>> => {
    const parsed = listSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:list-shift-cebo] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    const storeId = session.storeId
    const bounds = mondayWeekRange(parsed.data.weekOffset ?? 0)

    function mapRows(
      db: ReturnType<typeof getDb>,
      sessionRole: 'cashier' | 'admin',
      sessionUserId: string,
    ): CeboEntryRow[] {
      const rows = db
        .select({
          id: ceboEntries.id,
          quantityKg: ceboEntries.quantityKg,
          notes: ceboEntries.notes,
          createdBy: ceboEntries.createdBy,
          createdAt: ceboEntries.createdAt,
          updatedBy: ceboEntries.updatedBy,
          updatedAt: ceboEntries.updatedAt,
          saleStatus: sales.status,
          paymentAmount: salePayments.amount,
          paymentMethod: salePayments.paymentMethod,
        })
        .from(ceboEntries)
        .leftJoin(sales, eq(ceboEntries.saleId, sales.id))
        .leftJoin(salePayments, eq(salePayments.saleId, sales.id))
        .where(and(
          eq(ceboEntries.storeId, storeId),
          gte(ceboEntries.createdAt, bounds.startIso),
          lt(ceboEntries.createdAt, bounds.endIso),
        ))
        .orderBy(desc(ceboEntries.createdAt))
        .all()

      const nameMap = namesById(db, [
        ...rows.map(r => r.createdBy),
        ...rows.map(r => r.updatedBy ?? ''),
      ])

      return rows.map(r => {
        const method = r.saleStatus === 'confirmed' ? asPaymentMethod(r.paymentMethod) : null
        return {
          id: r.id,
          quantityKg: r.quantityKg,
          notes: r.notes,
          createdById: r.createdBy,
          createdByName: nameMap.get(r.createdBy) ?? r.createdBy,
          createdAt: r.createdAt,
          updatedByName: r.updatedBy ? (nameMap.get(r.updatedBy) ?? r.updatedBy) : null,
          updatedAt: r.updatedAt,
          canEdit: canEditCebo(sessionRole, sessionUserId, r.createdBy),
          amount: method != null ? r.paymentAmount : null,
          paymentMethod: method,
        }
      })
    }

    try {
      const db = getDb()
      let data = mapRows(db, session.role, session.userId)
      if (data.length === 0) {
        const config = getBusinessConfig()
        try {
          await pullCeboForStoreWeek(config.tenant_id, session.storeId, bounds.startIso, bounds.endIso)
        } catch (err) {
          log.warn('[ipc:list-shift-cebo] pullCeboForStoreWeek falló', err)
        }
        data = mapRows(db, session.role, session.userId)
      }
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:list-shift-cebo] Error inesperado', err)
      return { ok: false, error: 'Error al listar el sebo.' }
    }
  })

  ipcMain.handle(IPC.REGISTER_CEBO, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = registerSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:register-cebo] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    const id = uuidv4()
    const now = new Date().toISOString()
    const notes = parsed.data.notes?.trim() || null
    const amount = parsed.data.amount
    const paymentMethod = parsed.data.paymentMethod
    const shiftId = session.shiftId

    try {
      const db = getDb()
      let saleId: string | null = null
      db.transaction(tx => {
        if (amount != null && paymentMethod != null) {
          saleId = insertConfirmedSeboSale(tx, {
            storeId: session.storeId,
            shiftId,
            userId: session.userId,
            quantityKg: parsed.data.quantityKg,
            amount,
            paymentMethod,
            now,
          })
        }
        tx.insert(ceboEntries).values({
          id,
          storeId: session.storeId,
          shiftId,
          quantityKg: parsed.data.quantityKg,
          notes,
          createdBy: session.userId,
          createdAt: now,
          syncedAt: null,
          saleId,
        }).run()
      })

      const config = getBusinessConfig()
      pushUnsyncedCebo(config.tenant_id).catch(err =>
        log.warn('[ipc:register-cebo] pushUnsyncedCebo falló', err),
      )
      if (saleId) {
        notifySaleOccurred()
        pushSaleQuietly(config.tenant_id, 'ipc:register-cebo')
      }

      log.info('[ipc:register-cebo] Sebo registrado', {
        id,
        quantityKg: parsed.data.quantityKg,
        amount: amount ?? null,
        paymentMethod: paymentMethod ?? null,
        saleId,
      })
      return { ok: true, data: { id } }
    } catch (err) {
      log.error('[ipc:register-cebo] Error inesperado', err)
      return { ok: false, error: 'Error al registrar el sebo.' }
    }
  })

  ipcMain.handle(IPC.UPDATE_CEBO, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = updateSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-cebo] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    try {
      const db = getDb()
      const existing = db.select().from(ceboEntries).where(eq(ceboEntries.id, parsed.data.id)).get()
      if (!existing) return { ok: false, error: 'Registro no encontrado.', code: 'NOT_FOUND' }
      if (existing.storeId !== session.storeId) {
        return { ok: false, error: 'Registro no encontrado.', code: 'NOT_FOUND' }
      }
      if (!canEditCebo(session.role, session.userId, existing.createdBy)) {
        return { ok: false, error: 'Solo podés editar el sebo que cargaste.', code: 'FORBIDDEN' }
      }

      const amount = parsed.data.amount
      const paymentMethod = parsed.data.paymentMethod
      let confirmedSale = false
      if (existing.saleId) {
        const linked = db.select({ status: sales.status }).from(sales).where(eq(sales.id, existing.saleId)).get()
        confirmedSale = linked?.status === 'confirmed'
      }
      if (confirmedSale && amount != null) {
        return { ok: false, error: 'Este sebo ya está cobrado.', code: 'ALREADY_PAID' }
      }

      const now = new Date().toISOString()
      const shiftId = session.shiftId
      let createdSale = false
      db.transaction(tx => {
        let saleId = existing.saleId
        if (amount != null && paymentMethod != null && !confirmedSale) {
          saleId = insertConfirmedSeboSale(tx, {
            storeId: session.storeId,
            shiftId,
            userId: session.userId,
            quantityKg: parsed.data.quantityKg,
            amount,
            paymentMethod,
            now,
          })
          createdSale = true
        } else if (existing.saleId && confirmedSale) {
          syncSeboSaleQuantity(tx, existing.saleId, parsed.data.quantityKg)
        }
        tx.update(ceboEntries).set({
          quantityKg: parsed.data.quantityKg,
          notes: parsed.data.notes?.trim() || null,
          updatedBy: session.userId,
          updatedAt: now,
          syncedAt: null,
          saleId,
        }).where(eq(ceboEntries.id, parsed.data.id)).run()
      })

      const config = getBusinessConfig()
      pushUnsyncedCebo(config.tenant_id).catch(err =>
        log.warn('[ipc:update-cebo] pushUnsyncedCebo falló', err),
      )
      if (createdSale) {
        notifySaleOccurred()
        pushSaleQuietly(config.tenant_id, 'ipc:update-cebo')
      }

      log.info('[ipc:update-cebo] Sebo actualizado', { id: parsed.data.id, createdSale })
      return { ok: true, data: { id: parsed.data.id } }
    } catch (err) {
      log.error('[ipc:update-cebo] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el sebo.' }
    }
  })
}
