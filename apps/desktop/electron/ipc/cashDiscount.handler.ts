import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq, desc } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import { cashDiscountAudits, stores, users } from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { pushUnsyncedStores } from '../licensing/storeSync'
import {
  normalizeCashDiscountRule,
  parseCashDiscountSchedule,
  serializeCashDiscountSchedule,
  type CashDiscountBlock,
} from '@carniceria/shared'
import type { IpcResult } from '../../src/types/hw-api'

export const CASH_DISCOUNT_AUDIT_LIMIT = 20

export interface CashDiscountAuditRow {
  id: string
  createdAt: string
  actorName: string
  previousMinAmount: number
  previousPercent: number
  nextMinAmount: number
  nextPercent: number
}

export interface CashDiscountRulePayload {
  minAmount: number
  percent: number
  schedule: CashDiscountBlock[]
  audits: CashDiscountAuditRow[]
}

const weekdaySchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3),
  z.literal(4), z.literal(5), z.literal(6),
])

const ruleFieldsSchema = z.object({
  minAmount: z.number().int().min(0).max(99_999_999),
  percent: z.number().int().min(0).max(100),
})

const setRuleSchema = z.object({
  minAmount: z.number().int().min(0).max(99_999_999),
  percent: z.number().int().min(0).max(100),
  schedule: z.array(z.object({
    days: z.array(weekdaySchema).max(7),
    morning: ruleFieldsSchema,
    afternoon: ruleFieldsSchema,
  })).max(7).optional(),
})

function actorNameFromSession(
  db: ReturnType<typeof getDb>,
  userId: string,
  displayName?: string,
): string {
  if (displayName && displayName.trim()) return displayName.trim()
  const row = db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()
  return row?.name ?? userId
}

function listAudits(db: ReturnType<typeof getDb>, storeId: string): CashDiscountAuditRow[] {
  return db
    .select({
      id: cashDiscountAudits.id,
      createdAt: cashDiscountAudits.createdAt,
      actorName: cashDiscountAudits.actorName,
      previousMinAmount: cashDiscountAudits.previousMinAmount,
      previousPercent: cashDiscountAudits.previousPercent,
      nextMinAmount: cashDiscountAudits.nextMinAmount,
      nextPercent: cashDiscountAudits.nextPercent,
    })
    .from(cashDiscountAudits)
    .where(eq(cashDiscountAudits.storeId, storeId))
    .orderBy(desc(cashDiscountAudits.createdAt))
    .limit(CASH_DISCOUNT_AUDIT_LIMIT)
    .all()
}

export function registerCashDiscountHandlers(): void {
  ipcMain.handle(IPC.GET_CASH_DISCOUNT_RULE, (_event): IpcResult<CashDiscountRulePayload> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const store = db
        .select({
          cashDiscountMinAmount: stores.cashDiscountMinAmount,
          cashDiscountPercent: stores.cashDiscountPercent,
          cashDiscountSchedule: stores.cashDiscountSchedule,
        })
        .from(stores)
        .where(eq(stores.id, session.storeId))
        .get()
      if (!store) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      const rule = normalizeCashDiscountRule(store.cashDiscountMinAmount, store.cashDiscountPercent)
      return {
        ok: true,
        data: {
          minAmount: rule.minAmount,
          percent: rule.percent,
          schedule: parseCashDiscountSchedule(store.cashDiscountSchedule),
          audits: listAudits(db, session.storeId),
        },
      }
    } catch (err) {
      log.error('[ipc:get-cash-discount-rule] Error inesperado', err)
      return { ok: false, error: 'Error al leer la regla de descuento.' }
    }
  })

  ipcMain.handle(IPC.SET_CASH_DISCOUNT_RULE, (_event, payload: unknown): IpcResult<CashDiscountRulePayload> => {
    const parsed = setRuleSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:set-cash-discount-rule] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }

    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }

    try {
      const db = getDb()
      const existing = db
        .select({
          cashDiscountMinAmount: stores.cashDiscountMinAmount,
          cashDiscountPercent: stores.cashDiscountPercent,
          cashDiscountSchedule: stores.cashDiscountSchedule,
        })
        .from(stores)
        .where(eq(stores.id, session.storeId))
        .get()
      if (!existing) return { ok: false, error: 'Local no encontrado.', code: 'NOT_FOUND' }

      const previous = normalizeCashDiscountRule(
        existing.cashDiscountMinAmount,
        existing.cashDiscountPercent,
      )
      const next = normalizeCashDiscountRule(parsed.data.minAmount, parsed.data.percent)
      const previousSchedule = serializeCashDiscountSchedule(
        parseCashDiscountSchedule(existing.cashDiscountSchedule),
      )
      const nextSchedule = serializeCashDiscountSchedule(parsed.data.schedule ?? [])
      const now = new Date().toISOString()
      const actorName = actorNameFromSession(db, session.userId, session.displayName)
      const changed = previous.minAmount !== next.minAmount
        || previous.percent !== next.percent
        || previousSchedule !== nextSchedule

      db.transaction(tx => {
        tx.update(stores).set({
          cashDiscountMinAmount: next.minAmount,
          cashDiscountPercent: next.percent,
          cashDiscountSchedule: nextSchedule,
          syncedAt: null,
        }).where(eq(stores.id, session.storeId)).run()

        if (changed) {
          tx.insert(cashDiscountAudits).values({
            id: uuidv4(),
            storeId: session.storeId,
            actorUserId: session.userId,
            actorName,
            createdAt: now,
            previousMinAmount: previous.minAmount,
            previousPercent: previous.percent,
            nextMinAmount: next.minAmount,
            nextPercent: next.percent,
          }).run()
        }
      })

      const config = getBusinessConfig()
      pushUnsyncedStores(config.tenant_id).catch(err =>
        log.warn('[ipc:set-cash-discount-rule] pushUnsyncedStores falló', err),
      )

      log.info('[ipc:set-cash-discount-rule] Regla actualizada', {
        storeId: session.storeId,
        minAmount: next.minAmount,
        percent: next.percent,
      })
      return {
        ok: true,
        data: {
          minAmount: next.minAmount,
          percent: next.percent,
          schedule: parseCashDiscountSchedule(nextSchedule),
          audits: listAudits(db, session.storeId),
        },
      }
    } catch (err) {
      log.error('[ipc:set-cash-discount-rule] Error inesperado', err)
      return { ok: false, error: 'Error al guardar la regla de descuento.' }
    }
  })
}
