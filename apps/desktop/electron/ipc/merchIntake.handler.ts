import { ipcMain } from 'electron'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { and, asc, desc, eq, gte, isNull, lt } from 'drizzle-orm'
import { IPC } from './channels'
import { getDb } from '../db/client'
import {
  expenses,
  merchandiseIntakeLines,
  merchandiseIntakeRubros,
  merchandiseIntakes,
  providerDebtEvents,
  providers,
  stores,
  users,
} from '../db/schema'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import {
  merchDbLineToSnapshot,
  replaceIntakeLines,
  ensureFactoryMerchRubros,
} from '../licensing/merchIntakeDb'
import {
  pullMerchandiseIntakesForStoreWeek,
  pushUnsyncedMerchandiseIntakes,
} from '../licensing/merchIntakeSync'
import {
  pushUnsyncedMerchandiseIntakeRubros,
} from '../licensing/merchRubroSync'
import {
  applyPurchasePrices,
  localPurchasePrices,
  pullProviderPurchasePrices,
  pushUnsyncedProviderPurchasePrices,
} from '../licensing/merchPurchasePriceSync'
import { pushUnsyncedExpenses } from '../licensing/expenseSync'
import { pushUnsyncedProviders, pushUnsyncedDebtEvents } from '../licensing/providerSync'
import { providerIdFromName, providerNameKey } from './providerUtils'
import {
  MERCH_INTAKE_MAX_LINES,
  MERCH_INTAKE_MAX_WEIGHTS,
  MERCH_INTAKE_NAME_MAX,
  MERCH_INTAKE_NOTES_MAX,
  MERCH_INTAKE_QUANTITY_MAX,
  merchIntakeExpenseConcept,
  merchProductKey,
  merchVisitTotal,
  mondayWeekRange,
  parseMerchVisitFormLines,
  resolveMerchVisitLines,
  type MerchVisitFormLine,
  type MerchVisitLineDraft,
  MERCH_VISIT_KINDS,
  PROVIDER_INTAKE_KINDS,
} from '@carniceria/shared'
import type { IpcError, IpcResult, MerchandiseIntakeRow, MerchRubroRow } from '../../src/types/hw-api'

const listSchema = z.object({
  weekOffset: z.number().int().min(-104).max(0).optional(),
})

const visitLineDraftSchema = z.object({
  productId: z.string().min(1).max(64).nullable(),
  name: z.string().min(1).max(MERCH_INTAKE_NAME_MAX),
  catalogUnit: z.enum(['kg', 'unit']).nullable(),
  purchasePackLabel: z.string().max(40).nullable(),
  purchasePackContents: z.number().int().positive().max(MERCH_INTAKE_QUANTITY_MAX).nullable(),
  kg: z.number().positive().max(MERCH_INTAKE_QUANTITY_MAX).nullable(),
  packCount: z.number().int().positive().max(MERCH_INTAKE_QUANTITY_MAX).nullable(),
  count: z.number().int().positive().max(MERCH_INTAKE_QUANTITY_MAX).nullable(),
  weightsKg: z.array(z.number().positive().max(MERCH_INTAKE_QUANTITY_MAX)).max(MERCH_INTAKE_MAX_WEIGHTS),
  unitCost: z.number().int().nonnegative(),
  costUnit: z.enum(['kg', 'unit', 'pack']).nullable().optional(),
})

const formLineSchema = z.object({
  key: z.string().min(1).max(80),
  productId: z.string().min(1).max(64).nullable(),
  name: z.string().max(MERCH_INTAKE_NAME_MAX),
  catalogUnit: z.enum(['kg', 'unit']).nullable(),
  purchasePackLabel: z.string().max(40).nullable(),
  purchasePackContents: z.number().int().positive().max(MERCH_INTAKE_QUANTITY_MAX).nullable(),
  kgRaw: z.string().max(32),
  packCountRaw: z.string().max(32),
  countRaw: z.string().max(32),
  weightRaws: z.array(z.string().max(32)).max(MERCH_INTAKE_MAX_WEIGHTS),
  unitCostRaw: z.string().max(32),
  weighPieces: z.boolean(),
  costUnit: z.enum(['kg', 'unit', 'pack']).nullable().optional(),
})

const saveDraftSchema = z.object({
  providerId: z.string().min(1).optional(),
  provider: z.string().max(100).transform(s => s.trim()).optional(),
  notes: z.string().max(MERCH_INTAKE_NOTES_MAX).optional(),
  lines: z.array(formLineSchema).max(MERCH_INTAKE_MAX_LINES),
})

const confirmSchema = z.object({
  lines: z.array(visitLineDraftSchema).min(1).max(MERCH_INTAKE_MAX_LINES),
  notes: z.string().max(MERCH_INTAKE_NOTES_MAX).optional(),
  providerId: z.string().min(1).optional(),
  provider: z.string().max(100).transform(s => s.trim()).optional(),
  concept: z.string().max(80).optional(),
  amount: z.number().int().min(0).optional(),
  newDebtAmount: z.number().min(0).optional(),
  paysOldDebt: z.number().min(0).optional(),
  debtStoreId: z.string().min(1).optional(),
  acceptPriceUpdates: z.boolean(),
  visitKind: z.enum(MERCH_VISIT_KINDS).optional(),
})

const getPricesSchema = z.object({
  providerId: z.string().min(1),
})

const listRubrosSchema = z.object({
  includeArchived: z.boolean().optional(),
})

const createRubroSchema = z.object({
  name: z.string().min(1).max(MERCH_INTAKE_NAME_MAX).transform(s => s.trim()),
  template: z.enum(['pieces_weight', 'packs', 'weight', 'count']),
  packContents: z.number().int().positive().max(MERCH_INTAKE_QUANTITY_MAX).optional(),
  packTareKg: z.number().min(0).max(MERCH_INTAKE_QUANTITY_MAX).optional(),
  packLabel: z.string().max(40).transform(s => s.trim()).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

const updateRubroSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(MERCH_INTAKE_NAME_MAX).transform(s => s.trim()).optional(),
  template: z.enum(['pieces_weight', 'packs', 'weight', 'count']).optional(),
  packContents: z.number().int().positive().max(MERCH_INTAKE_QUANTITY_MAX).nullable().optional(),
  packTareKg: z.number().min(0).max(MERCH_INTAKE_QUANTITY_MAX).nullable().optional(),
  packLabel: z.string().max(40).transform(s => s.trim()).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

const rubroIdSchema = z.object({
  id: z.string().min(1).max(64),
})

function canEditMerch(
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

function reactivateArchivedProviderIfNeeded(
  db: ReturnType<typeof getDb>,
  providerId: string,
  userId: string,
  now: string,
): void {
  const row = db.select({ archivedAt: providers.archivedAt }).from(providers).where(eq(providers.id, providerId)).get()
  if (!row?.archivedAt) return
  db.update(providers).set({
    archivedAt: null,
    updatedAt: now,
    updatedBy: userId,
    syncedAt: null,
  }).where(eq(providers.id, providerId)).run()
}

function resolveProvider(
  db: ReturnType<typeof getDb>,
  input: { providerId?: string; provider?: string; intakeKind?: (typeof PROVIDER_INTAKE_KINDS)[number] },
  userId: string,
  now: string,
): { id: string; name: string } | { error: IpcError } | null {
  if (input.providerId) {
    const prov = db.select({ id: providers.id, name: providers.name }).from(providers)
      .where(eq(providers.id, input.providerId)).get()
    if (!prov) {
      return { error: { ok: false, error: 'Proveedor no encontrado.', code: 'PROVIDER_NOT_FOUND' } }
    }
    reactivateArchivedProviderIfNeeded(db, prov.id, userId, now)
    return { id: prov.id, name: prov.name }
  }
  if (input.provider && input.provider.length > 0) {
    const provName = input.provider
    const id = providerIdFromName(provName)
    const existing = db.select().from(providers).where(eq(providers.id, id)).get()
    if (!existing) {
      db.insert(providers).values({
        id,
        name: provName,
        nameKey: providerNameKey(provName),
        intakeKind: input.intakeKind ?? null,
        createdAt: now,
        createdBy: userId,
        syncedAt: null,
      }).run()
    } else {
      reactivateArchivedProviderIfNeeded(db, id, userId, now)
    }
    if (input.intakeKind) {
      db.update(providers).set({
        intakeKind: input.intakeKind,
        updatedAt: now,
        updatedBy: userId,
        syncedAt: null,
      }).where(eq(providers.id, id)).run()
    }
    return { id, name: existing?.name ?? provName }
  }
  return null
}

function schedulePushes(opts: {
  tenantId: string
  hasProvider: boolean
  hasExpense: boolean
  hasRubros?: boolean
  hasPrices?: boolean
}): void {
  pushUnsyncedMerchandiseIntakes(opts.tenantId).catch(err =>
    log.warn('[ipc:merch-intake] pushUnsyncedMerchandiseIntakes falló', err),
  )
  if (opts.hasRubros) {
    pushUnsyncedMerchandiseIntakeRubros(opts.tenantId).catch(err =>
      log.warn('[ipc:merch-intake] pushUnsyncedMerchandiseIntakeRubros falló', err),
    )
  }
  if (opts.hasExpense) {
    pushUnsyncedExpenses(opts.tenantId).catch(err =>
      log.warn('[ipc:merch-intake] pushUnsyncedExpenses falló', err),
    )
  }
  if (opts.hasProvider) {
    pushUnsyncedProviders(opts.tenantId).catch(err =>
      log.warn('[ipc:merch-intake] pushUnsyncedProviders falló', err),
    )
    pushUnsyncedDebtEvents(opts.tenantId).catch(err =>
      log.warn('[ipc:merch-intake] pushUnsyncedDebtEvents falló', err),
    )
  }
  if (opts.hasPrices) {
    pushUnsyncedProviderPurchasePrices(opts.tenantId).catch(err =>
      log.warn('[ipc:merch-intake] pushUnsyncedProviderPurchasePrices falló', err),
    )
  }
}

function mapRubro(row: typeof merchandiseIntakeRubros.$inferSelect): MerchRubroRow {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    packContents: row.packContents,
    packTareKg: row.packTareKg,
    packLabel: row.packLabel,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
  }
}

export function registerMerchIntakeHandlers(): void {
  ipcMain.handle(IPC.LIST_SHIFT_MERCH, async (_event, payload: unknown): Promise<IpcResult<MerchandiseIntakeRow[]>> => {
    const parsed = listSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:list-shift-merch] Payload inválido', parsed.error)
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
    ): MerchandiseIntakeRow[] {
      const rows = db
        .select()
        .from(merchandiseIntakes)
        .where(and(
          eq(merchandiseIntakes.storeId, storeId),
          eq(merchandiseIntakes.status, 'confirmed'),
          gte(merchandiseIntakes.createdAt, bounds.startIso),
          lt(merchandiseIntakes.createdAt, bounds.endIso),
        ))
        .orderBy(desc(merchandiseIntakes.createdAt))
        .all()

      const nameMap = namesById(db, [
        ...rows.map(r => r.createdBy),
        ...rows.map(r => r.updatedBy ?? ''),
      ])

      return rows.map(r => {
        const lines = db
          .select()
          .from(merchandiseIntakeLines)
          .where(eq(merchandiseIntakeLines.intakeId, r.id))
          .orderBy(asc(merchandiseIntakeLines.sortOrder))
          .all()
          .map(merchDbLineToSnapshot)
        return {
          id: r.id,
          lines,
          notes: r.notes,
          paymentKind: r.paymentKind,
          paidAmount: r.paidAmount,
          debtAmount: r.debtAmount,
          providerName: r.providerName,
          expenseId: r.expenseId,
          createdById: r.createdBy,
          createdByName: nameMap.get(r.createdBy) ?? r.createdBy,
          createdAt: r.createdAt,
          updatedByName: r.updatedBy ? (nameMap.get(r.updatedBy) ?? r.updatedBy) : null,
          updatedAt: r.updatedAt,
          canEdit: canEditMerch(sessionRole, sessionUserId, r.createdBy),
        }
      })
    }

    try {
      const db = getDb()
      ensureFactoryMerchRubros(db)
      let data = mapRows(db, session.role, session.userId)
      if (data.length === 0) {
        const config = getBusinessConfig()
        try {
          await pullMerchandiseIntakesForStoreWeek(config.tenant_id, session.storeId, bounds.startIso, bounds.endIso)
        } catch (err) {
          log.warn('[ipc:list-shift-merch] pullMerchandiseIntakesForStoreWeek falló', err)
        }
        data = mapRows(db, session.role, session.userId)
      }
      return { ok: true, data }
    } catch (err) {
      log.error('[ipc:list-shift-merch] Error inesperado', err)
      return { ok: false, error: 'Error al listar el ingreso de mercadería.' }
    }
  })

  ipcMain.handle(IPC.GET_MERCH_VISIT_DRAFT, (_event): IpcResult<{
    id: string
    providerId: string | null
    providerName: string | null
    notes: string | null
    lines: MerchVisitFormLine[]
  } | null> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }
    try {
      const db = getDb()
      const row = db.select().from(merchandiseIntakes).where(and(
        eq(merchandiseIntakes.shiftId, session.shiftId),
        eq(merchandiseIntakes.status, 'draft'),
      )).get()
      if (!row) return { ok: true, data: null }
      return {
        ok: true,
        data: {
          id: row.id,
          providerId: row.providerId,
          providerName: row.providerName,
          notes: row.notes,
          lines: parseMerchVisitFormLines(row.draftJson),
        },
      }
    } catch (err) {
      log.error('[ipc:get-merch-visit-draft] Error inesperado', err)
      return { ok: false, error: 'Error al leer el borrador de visita.' }
    }
  })

  ipcMain.handle(IPC.SAVE_MERCH_VISIT_DRAFT, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = saveDraftSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:save-merch-visit-draft] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }
    const now = new Date().toISOString()
    try {
      const db = getDb()
      const resolved = parsed.data.providerId || parsed.data.provider
        ? resolveProvider(db, parsed.data, session.userId, now)
        : null
      if (resolved && 'error' in resolved) return resolved.error
      const existing = db.select().from(merchandiseIntakes).where(and(
        eq(merchandiseIntakes.shiftId, session.shiftId),
        eq(merchandiseIntakes.status, 'draft'),
      )).get()
      const id = existing?.id ?? uuidv4()
      const draftJson = JSON.stringify(parsed.data.lines)
      db.transaction(tx => {
        if (existing) {
          tx.update(merchandiseIntakes).set({
            notes: parsed.data.notes?.trim() || null,
            providerId: resolved && 'id' in resolved ? resolved.id : null,
            providerName: resolved && 'id' in resolved ? resolved.name : null,
            draftJson,
            updatedBy: session.userId,
            updatedAt: now,
            syncedAt: null,
          }).where(eq(merchandiseIntakes.id, id)).run()
        } else {
          tx.insert(merchandiseIntakes).values({
            id,
            storeId: session.storeId,
            shiftId: session.shiftId!,
            notes: parsed.data.notes?.trim() || null,
            paymentKind: 'none',
            paidAmount: 0,
            debtAmount: 0,
            providerId: resolved && 'id' in resolved ? resolved.id : null,
            providerName: resolved && 'id' in resolved ? resolved.name : null,
            expenseId: null,
            status: 'draft',
            draftJson,
            createdBy: session.userId,
            createdAt: now,
            syncedAt: null,
          }).run()
        }
      })
      return { ok: true, data: { id } }
    } catch (err) {
      log.error('[ipc:save-merch-visit-draft] Error inesperado', err)
      return { ok: false, error: 'Error al guardar el borrador de visita.' }
    }
  })

  ipcMain.handle(IPC.DISCARD_MERCH_VISIT_DRAFT, (_event): IpcResult<{ id: string | null }> => {
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }
    try {
      const db = getDb()
      const existing = db.select().from(merchandiseIntakes).where(and(
        eq(merchandiseIntakes.shiftId, session.shiftId),
        eq(merchandiseIntakes.status, 'draft'),
      )).get()
      if (!existing) return { ok: true, data: { id: null } }
      db.delete(merchandiseIntakes).where(eq(merchandiseIntakes.id, existing.id)).run()
      return { ok: true, data: { id: existing.id } }
    } catch (err) {
      log.error('[ipc:discard-merch-visit-draft] Error inesperado', err)
      return { ok: false, error: 'Error al descartar el borrador.' }
    }
  })

  ipcMain.handle(IPC.GET_PROVIDER_PURCHASE_PRICES, async (_event, payload: unknown): Promise<IpcResult<Array<{
    productKey: string
    name: string
    costUnit: 'kg' | 'unit' | 'pack'
    unitCost: number
  }>>> => {
    const parsed = getPricesSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    try {
      const config = getBusinessConfig()
      try {
        await pullProviderPurchasePrices(config.tenant_id, parsed.data.providerId)
      } catch (err) {
        log.warn('[ipc:get-provider-purchase-prices] pull falló', err)
      }
      return {
        ok: true,
        data: localPurchasePrices(parsed.data.providerId).map(r => ({
          productKey: r.productKey,
          name: r.name,
          costUnit: r.costUnit,
          unitCost: r.unitCost,
        })),
      }
    } catch (err) {
      log.error('[ipc:get-provider-purchase-prices] Error inesperado', err)
      return { ok: false, error: 'Error al leer los costos de compra.' }
    }
  })

  ipcMain.handle(IPC.CONFIRM_MERCH_VISIT, (_event, payload: unknown): IpcResult<{ id: string; expenseId: string | null }> => {
    const parsed = confirmSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:confirm-merch-visit] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (!session.shiftId) return { ok: false, error: 'No hay turno activo.', code: 'NO_SHIFT' }

    const now = new Date().toISOString()
    const notes = parsed.data.notes?.trim() || null
    try {
      const db = getDb()
      if (parsed.data.debtStoreId) {
        const storeRow = db.select({ id: stores.id }).from(stores).where(eq(stores.id, parsed.data.debtStoreId)).get()
        if (!storeRow) {
          return { ok: false, error: 'El local de deuda especificado no existe.', code: 'INVALID_DEBT_STORE' }
        }
      }
      const resolved = resolveProvider(db, {
        ...parsed.data,
        intakeKind: parsed.data.visitKind,
      }, session.userId, now)
      if (!resolved || 'error' in resolved) {
        return resolved && 'error' in resolved
          ? resolved.error
          : { ok: false, error: 'La visita de mercadería necesita un proveedor.', code: 'INVALID_PAYLOAD' }
      }

      if (parsed.data.visitKind) {
        db.update(providers).set({
          intakeKind: parsed.data.visitKind,
          updatedAt: now,
          updatedBy: session.userId,
          syncedAt: null,
        }).where(eq(providers.id, resolved.id)).run()
      }

      const computed = resolveMerchVisitLines(parsed.data.lines as MerchVisitLineDraft[])
      if (!computed.ok) return { ok: false, error: computed.error, code: 'INVALID_LINE' }
      const visitKind = parsed.data.visitKind ?? 'catalog'
      if (visitKind === 'media_res') {
        if (computed.lines.some(l => l.template !== 'pieces_weight' || (l.netKg ?? 0) <= 0 || (l.count ?? 0) <= 0)) {
          return { ok: false, error: 'Cargá el kilo de cada media res.', code: 'INVALID_LINE' }
        }
      } else if (computed.lines.some(l => l.unitCost <= 0)) {
        return { ok: false, error: 'Cada producto necesita el precio de compra.', code: 'INVALID_LINE' }
      }
      const lines = computed.lines.map(line => ({ ...line, id: uuidv4() }))
      const visitTotal = merchVisitTotal(lines)
      const factsOnly = visitKind === 'media_res'
      const paidAmount = factsOnly ? 0 : (parsed.data.amount ?? 0)
      const debtAmount = factsOnly ? 0 : (parsed.data.newDebtAmount ?? 0)
      const paysOldDebt = factsOnly ? 0 : (parsed.data.paysOldDebt ?? 0)
      const paymentKind = factsOnly
        ? 'none'
        : (paidAmount > 0 ? 'paid_now' : (debtAmount > 0 ? 'on_account' : 'none'))
      const concept = parsed.data.concept?.trim()
        || merchIntakeExpenseConcept(lines.map(l => l.rubroName))
      const draft = db.select().from(merchandiseIntakes).where(and(
        eq(merchandiseIntakes.shiftId, session.shiftId),
        eq(merchandiseIntakes.status, 'draft'),
      )).get()
      const id = draft?.id ?? uuidv4()
      const expenseId = factsOnly ? null : uuidv4()
      const effectiveDebtStoreId = parsed.data.debtStoreId ?? session.storeId

      db.transaction(tx => {
        if (!factsOnly && expenseId) {
          tx.insert(expenses).values({
            id: expenseId,
            storeId: session.storeId,
            shiftId: session.shiftId!,
            kind: 'expense',
            concept,
            providerId: resolved.id,
            amount: paidAmount,
            notes,
            createdAt: now,
            createdBy: session.userId,
            syncedAt: null,
          }).run()
          if (debtAmount > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: effectiveDebtStoreId,
              providerId: resolved.id,
              provider: resolved.name,
              type: 'debt',
              amount: debtAmount,
              expenseId,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            }).run()
          }
          if (paysOldDebt > 0) {
            tx.insert(providerDebtEvents).values({
              id: uuidv4(),
              storeId: effectiveDebtStoreId,
              providerId: resolved.id,
              provider: resolved.name,
              type: 'payment',
              amount: paysOldDebt,
              expenseId,
              shiftId: session.shiftId!,
              createdAt: now,
              createdBy: session.userId,
              syncedAt: null,
            }).run()
          }
        }

        if (draft) {
          tx.update(merchandiseIntakes).set({
            notes,
            paymentKind,
            paidAmount,
            debtAmount,
            providerId: resolved.id,
            providerName: resolved.name,
            expenseId,
            status: 'confirmed',
            draftJson: null,
            updatedBy: session.userId,
            updatedAt: now,
            syncedAt: null,
          }).where(eq(merchandiseIntakes.id, id)).run()
        } else {
          tx.insert(merchandiseIntakes).values({
            id,
            storeId: session.storeId,
            shiftId: session.shiftId!,
            notes,
            paymentKind,
            paidAmount,
            debtAmount,
            providerId: resolved.id,
            providerName: resolved.name,
            expenseId,
            status: 'confirmed',
            draftJson: null,
            createdBy: session.userId,
            createdAt: now,
            syncedAt: null,
          }).run()
        }
        replaceIntakeLines(tx, id, lines)
        if (!factsOnly) {
          applyPurchasePrices(tx, {
            providerId: resolved.id,
            lines: lines.map(l => ({
              productKey: merchProductKey(l.productId, l.rubroName),
              name: l.rubroName,
              costUnit: l.costUnit,
              unitCost: l.unitCost,
            })),
            acceptPriceUpdates: parsed.data.acceptPriceUpdates,
            now,
          })
        }
      })

      const config = getBusinessConfig()
      schedulePushes({
        tenantId: config.tenant_id,
        hasProvider: true,
        hasExpense: !factsOnly,
        hasPrices: !factsOnly,
      })
      log.info('[ipc:confirm-merch-visit] Visita confirmada', { id, expenseId, visitTotal, lineCount: lines.length, visitKind })
      return { ok: true, data: { id, expenseId } }
    } catch (err) {
      log.error('[ipc:confirm-merch-visit] Error inesperado', err)
      return { ok: false, error: 'Error al confirmar la visita.' }
    }
  })

  ipcMain.handle(IPC.LIST_MERCH_RUBROS, (_event, payload: unknown): IpcResult<MerchRubroRow[]> => {
    const parsed = listRubrosSchema.safeParse(payload ?? {})
    if (!parsed.success) {
      log.error('[ipc:list-merch-rubros] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    try {
      const db = getDb()
      ensureFactoryMerchRubros(db)
      const rows = parsed.data.includeArchived
        ? db.select().from(merchandiseIntakeRubros).orderBy(asc(merchandiseIntakeRubros.sortOrder), asc(merchandiseIntakeRubros.name)).all()
        : db.select().from(merchandiseIntakeRubros).where(isNull(merchandiseIntakeRubros.archivedAt)).orderBy(asc(merchandiseIntakeRubros.sortOrder), asc(merchandiseIntakeRubros.name)).all()
      return { ok: true, data: rows.map(mapRubro) }
    } catch (err) {
      log.error('[ipc:list-merch-rubros] Error inesperado', err)
      return { ok: false, error: 'Error al listar los rubros.' }
    }
  })

  ipcMain.handle(IPC.CREATE_MERCH_RUBRO, (_event, payload: unknown): IpcResult<MerchRubroRow> => {
    const parsed = createRubroSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:create-merch-rubro] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo un administrador puede crear rubros.', code: 'FORBIDDEN' }
    }
    try {
      const db = getDb()
      ensureFactoryMerchRubros(db)
      const now = new Date().toISOString()
      const id = uuidv4()
      const maxSort = db.select({ sortOrder: merchandiseIntakeRubros.sortOrder }).from(merchandiseIntakeRubros).all()
        .reduce((m, r) => Math.max(m, r.sortOrder), 0)
      db.insert(merchandiseIntakeRubros).values({
        id,
        name: parsed.data.name,
        template: parsed.data.template,
        packContents: parsed.data.packContents ?? null,
        packTareKg: parsed.data.packTareKg ?? null,
        packLabel: parsed.data.packLabel || null,
        sortOrder: parsed.data.sortOrder ?? (maxSort + 10),
        createdAt: now,
        createdBy: session.userId,
        syncedAt: null,
      }).run()
      const row = db.select().from(merchandiseIntakeRubros).where(eq(merchandiseIntakeRubros.id, id)).get()
      if (!row) return { ok: false, error: 'Error al crear el rubro.' }
      const config = getBusinessConfig()
      schedulePushes({ tenantId: config.tenant_id, hasProvider: false, hasExpense: false, hasRubros: true })
      return { ok: true, data: mapRubro(row) }
    } catch (err) {
      log.error('[ipc:create-merch-rubro] Error inesperado', err)
      return { ok: false, error: 'Error al crear el rubro.' }
    }
  })

  ipcMain.handle(IPC.UPDATE_MERCH_RUBRO, (_event, payload: unknown): IpcResult<MerchRubroRow> => {
    const parsed = updateRubroSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:update-merch-rubro] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo un administrador puede editar rubros.', code: 'FORBIDDEN' }
    }
    try {
      const db = getDb()
      const existing = db.select().from(merchandiseIntakeRubros).where(eq(merchandiseIntakeRubros.id, parsed.data.id)).get()
      if (!existing) return { ok: false, error: 'Rubro no encontrado.', code: 'NOT_FOUND' }
      const now = new Date().toISOString()
      db.update(merchandiseIntakeRubros).set({
        name: parsed.data.name ?? existing.name,
        template: parsed.data.template ?? existing.template,
        packContents: parsed.data.packContents === undefined ? existing.packContents : parsed.data.packContents,
        packTareKg: parsed.data.packTareKg === undefined ? existing.packTareKg : parsed.data.packTareKg,
        packLabel: parsed.data.packLabel === undefined ? existing.packLabel : (parsed.data.packLabel || null),
        sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(merchandiseIntakeRubros.id, parsed.data.id)).run()
      const row = db.select().from(merchandiseIntakeRubros).where(eq(merchandiseIntakeRubros.id, parsed.data.id)).get()
      if (!row) return { ok: false, error: 'Rubro no encontrado.', code: 'NOT_FOUND' }
      const config = getBusinessConfig()
      schedulePushes({ tenantId: config.tenant_id, hasProvider: false, hasExpense: false, hasRubros: true })
      return { ok: true, data: mapRubro(row) }
    } catch (err) {
      log.error('[ipc:update-merch-rubro] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar el rubro.' }
    }
  })

  ipcMain.handle(IPC.ARCHIVE_MERCH_RUBRO, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = rubroIdSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:archive-merch-rubro] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo un administrador puede archivar rubros.', code: 'FORBIDDEN' }
    }
    try {
      const db = getDb()
      const existing = db.select().from(merchandiseIntakeRubros).where(eq(merchandiseIntakeRubros.id, parsed.data.id)).get()
      if (!existing) return { ok: false, error: 'Rubro no encontrado.', code: 'NOT_FOUND' }
      const now = new Date().toISOString()
      db.update(merchandiseIntakeRubros).set({
        archivedAt: now,
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(merchandiseIntakeRubros.id, parsed.data.id)).run()
      const config = getBusinessConfig()
      schedulePushes({ tenantId: config.tenant_id, hasProvider: false, hasExpense: false, hasRubros: true })
      return { ok: true, data: { id: parsed.data.id } }
    } catch (err) {
      log.error('[ipc:archive-merch-rubro] Error inesperado', err)
      return { ok: false, error: 'Error al archivar el rubro.' }
    }
  })

  ipcMain.handle(IPC.UNARCHIVE_MERCH_RUBRO, (_event, payload: unknown): IpcResult<{ id: string }> => {
    const parsed = rubroIdSchema.safeParse(payload)
    if (!parsed.success) {
      log.error('[ipc:unarchive-merch-rubro] Payload inválido', parsed.error)
      return { ok: false, error: 'Payload inválido.', code: 'INVALID_PAYLOAD' }
    }
    const session = getActiveSession()
    if (!session) return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    if (session.role !== 'admin') {
      return { ok: false, error: 'Solo un administrador puede restaurar rubros.', code: 'FORBIDDEN' }
    }
    try {
      const db = getDb()
      const existing = db.select().from(merchandiseIntakeRubros).where(eq(merchandiseIntakeRubros.id, parsed.data.id)).get()
      if (!existing) return { ok: false, error: 'Rubro no encontrado.', code: 'NOT_FOUND' }
      const now = new Date().toISOString()
      db.update(merchandiseIntakeRubros).set({
        archivedAt: null,
        updatedAt: now,
        updatedBy: session.userId,
        syncedAt: null,
      }).where(eq(merchandiseIntakeRubros.id, parsed.data.id)).run()
      const config = getBusinessConfig()
      schedulePushes({ tenantId: config.tenant_id, hasProvider: false, hasExpense: false, hasRubros: true })
      return { ok: true, data: { id: parsed.data.id } }
    } catch (err) {
      log.error('[ipc:unarchive-merch-rubro] Error inesperado', err)
      return { ok: false, error: 'Error al restaurar el rubro.' }
    }
  })
}
