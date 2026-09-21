/**
 * Libro de mercadería del turno: Dexie + Firestore acotado por storeId+createdAt
 * (nunca la colección entera). Rubros: colección chica de toda la licencia.
 */
import {
  collection,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import {
  FACTORY_MERCH_RUBROS,
  coerceMerchIntakePaymentKind,
  coerceMerchIntakeTemplate,
  merchIntakeExpenseConcept,
  mondayWeekRange,
  parseMerchLinesFromUnknown,
  resolveMerchLineFacts,
  snapshotFromFacts,
  type MerchIntakeLineSnapshot,
  type MerchIntakePaymentKind,
  type MerchIntakeTemplate,
  type MerchLineDraftInput,
} from '@carniceria/shared'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { isOnline } from './connectivity'
import { db } from './db'
import { debtEventId } from './expenseVisit'
import { upsertCachedProvider } from './posCaches'
import type {
  LocalExpense,
  LocalMerchRubro,
  LocalMerchandiseIntake,
  LocalProviderDebtEvent,
  LocalShift,
  SyncStatus,
} from '../types/pos'

const firestore = getFirestore(firebaseApp)
const NOTES_MAX = 300

export { NOTES_MAX as MERCH_INTAKE_NOTES_MAX }

function normalizeLocal(row: LocalMerchandiseIntake): LocalMerchandiseIntake {
  if (row.lines && row.lines.length > 0) return row
  return {
    ...row,
    lines: parseMerchLinesFromUnknown(undefined, {
      intakeId: row.id,
      category: row.category,
      unit: row.unit,
      quantity: row.quantity,
    }),
  }
}

function parseRemote(data: Record<string, unknown>, fallbackId: string): LocalMerchandiseIntake | null {
  const shiftId = typeof data['shiftId'] === 'string' ? data['shiftId'] : ''
  const storeId = typeof data['storeId'] === 'string' ? data['storeId'] : ''
  const id = typeof data['id'] === 'string' ? data['id'] : fallbackId
  if (!shiftId || !storeId) return null
  const lines = parseMerchLinesFromUnknown(data['lines'], {
    intakeId: id,
    category: data['category'],
    unit: data['unit'],
    quantity: data['quantity'],
  })
  if (lines.length === 0) return null
  const paidAmount = Number(data['paidAmount'])
  const debtAmount = Number(data['debtAmount'])
  return {
    id,
    shiftId,
    storeId,
    lines,
    notes: typeof data['notes'] === 'string' ? data['notes'] : null,
    paymentKind: coerceMerchIntakePaymentKind(data['paymentKind']) ?? 'none',
    paidAmount: Number.isFinite(paidAmount) ? Math.max(0, Math.round(paidAmount)) : 0,
    debtAmount: Number.isFinite(debtAmount) ? Math.max(0, Math.round(debtAmount)) : 0,
    providerId: typeof data['providerId'] === 'string' ? data['providerId'] : null,
    providerName: typeof data['providerName'] === 'string' ? data['providerName'] : null,
    expenseId: typeof data['expenseId'] === 'string' ? data['expenseId'] : null,
    createdAt: typeof data['createdAt'] === 'string' ? data['createdAt'] : new Date().toISOString(),
    createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : '',
    createdByName: typeof data['createdByName'] === 'string' ? data['createdByName'] : '',
    updatedAt: typeof data['updatedAt'] === 'string' ? data['updatedAt'] : null,
    updatedBy: typeof data['updatedBy'] === 'string' ? data['updatedBy'] : null,
    updatedByName: typeof data['updatedByName'] === 'string' ? data['updatedByName'] : null,
    syncStatus: 'synced',
    syncedAt: typeof data['syncedAt'] === 'string' ? data['syncedAt'] : new Date().toISOString(),
  }
}

export function canEditMerch(role: 'admin' | 'cashier', userId: string, createdBy: string): boolean {
  return role === 'admin' || createdBy === userId
}

async function seedFactoryRubros(): Promise<void> {
  for (const r of FACTORY_MERCH_RUBROS) {
    const existing = await db.merchRubros.get(r.id)
    if (existing) continue
    await db.merchRubros.put({
      id: r.id,
      name: r.name,
      template: r.template,
      packContents: r.packContents,
      packTareKg: r.packTareKg,
      packLabel: r.packLabel,
      sortOrder: r.sortOrder,
      archivedAt: null,
    })
  }
}

function parseRemoteRubro(data: Record<string, unknown>, fallbackId: string): LocalMerchRubro | null {
  const id = typeof data['id'] === 'string' ? data['id'].trim() : fallbackId
  const name = typeof data['name'] === 'string' ? data['name'].trim() : ''
  const template = coerceMerchIntakeTemplate(data['template'])
  if (!id || !name || !template) return null
  const packContents = Number(data['packContents'])
  const packTareKg = Number(data['packTareKg'])
  const sortOrder = Number(data['sortOrder'])
  return {
    id,
    name,
    template,
    packContents: Number.isInteger(packContents) && packContents > 0 ? packContents : null,
    packTareKg: Number.isFinite(packTareKg) && packTareKg >= 0 ? packTareKg : null,
    packLabel: typeof data['packLabel'] === 'string' ? data['packLabel'] : null,
    sortOrder: Number.isFinite(sortOrder) ? Math.round(sortOrder) : 200,
    archivedAt: data['deleted'] === true
      ? (typeof data['archivedAt'] === 'string' ? data['archivedAt'] : new Date().toISOString())
      : (typeof data['archivedAt'] === 'string' ? data['archivedAt'] : null),
  }
}

export async function listMerchRubros(): Promise<LocalMerchRubro[]> {
  await seedFactoryRubros()
  if (await isOnline()) {
    try {
      const snap = await getDocs(collection(firestore, 'licenses', LICENSE_KEY, 'merchandiseIntakeRubros'))
      for (const d of snap.docs) {
        const parsed = parseRemoteRubro(d.data() as Record<string, unknown>, d.id)
        if (!parsed) continue
        await db.merchRubros.put(parsed)
      }
    } catch {
      /* offline / reglas */
    }
  }
  const all = await db.merchRubros.toArray()
  return all
    .filter(r => !r.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
}

export async function listWeekMerch(storeId: string, weekOffset = 0): Promise<LocalMerchandiseIntake[]> {
  const bounds = mondayWeekRange(weekOffset)
  const local = await db.merchandiseIntakes.where('storeId').equals(storeId).toArray()
  const inWeek = local.map(normalizeLocal).filter(r => r.createdAt >= bounds.startIso && r.createdAt < bounds.endIso)
  const byId = new Map(inWeek.map(r => [r.id, r]))

  if (inWeek.length === 0 && await isOnline()) {
    try {
      const q = query(
        collection(firestore, 'licenses', LICENSE_KEY, 'merchandiseIntakes'),
        where('storeId', '==', storeId),
        where('createdAt', '>=', bounds.startIso),
        where('createdAt', '<', bounds.endIso),
      )
      const snap = await getDocs(q)
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>
    if (data['deleted'] === true) continue
    if (data['status'] === 'draft') continue
    const parsed = parseRemote(data, d.id)
        if (!parsed) continue
        const existing = await db.merchandiseIntakes.get(parsed.id)
        if (existing && (existing.syncStatus === 'pending' || existing.syncStatus === 'error')) continue
        byId.set(parsed.id, parsed)
        await db.merchandiseIntakes.put(parsed)
      }
    } catch {
      /* offline / reglas / índice pendiente */
    }
  }

  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function upsertLocalMerch(row: LocalMerchandiseIntake): Promise<void> {
  const notes = row.notes?.trim() ? row.notes.trim().slice(0, NOTES_MAX) : null
  await db.merchandiseIntakes.put({
    ...row,
    notes,
    syncStatus: 'pending' as SyncStatus,
    syncedAt: null,
  })
}

export function resolveLinesFromDrafts(
  drafts: MerchLineDraftInput[],
  rubros: LocalMerchRubro[],
  opts: { allowArchived: boolean },
): { lines: MerchIntakeLineSnapshot[] } | { error: string } {
  const byId = new Map(rubros.map(r => [r.id, r]))
  const lines: MerchIntakeLineSnapshot[] = []
  for (const [index, draft] of drafts.entries()) {
    const rubro = byId.get(draft.rubroId)
    if (!rubro) return { error: 'Rubro no encontrado.' }
    if (rubro.archivedAt && !opts.allowArchived) {
      return { error: `El rubro «${rubro.name}» está archivado.` }
    }
    const computed = resolveMerchLineFacts(rubro.template as MerchIntakeTemplate, draft, {
      packContents: rubro.packContents,
      packTareKg: rubro.packTareKg,
    })
    if (!computed.ok) return { error: `${rubro.name}: ${computed.error}` }
    lines.push(snapshotFromFacts({
      id: uuidv4(),
      rubroId: rubro.id,
      rubroName: rubro.name,
      template: rubro.template,
      sortOrder: index,
      packLabel: rubro.packLabel,
    }, computed.facts))
  }
  if (lines.length === 0) return { error: 'Agregá al menos un rubro.' }
  return { lines }
}

export interface SaveMerchIntakeInput {
  shift: LocalShift
  viewerName: string
  lines: MerchIntakeLineSnapshot[]
  notes: string | null
  paymentKind: MerchIntakePaymentKind
  paidAmount: number
  visitAmount: number
  providerId: string | null
  providerName: string | null
}

export async function saveNewMerchIntake(input: SaveMerchIntakeInput): Promise<void> {
  const now = new Date().toISOString()
  const id = uuidv4()
  const expenseId = input.paymentKind === 'none' ? null : uuidv4()
  const paidAmount = input.paymentKind === 'paid_now' ? input.paidAmount : 0
  const debtAmount = input.paymentKind === 'on_account' ? input.visitAmount : 0
  const providerId = input.providerId
  const providerName = input.providerName?.trim() || null

  if (expenseId) {
    const expense: LocalExpense = {
      id: expenseId,
      shiftId: input.shift.id,
      storeId: input.shift.storeId,
      kind: 'expense',
      concept: merchIntakeExpenseConcept(input.lines.map(l => l.rubroName)),
      amount: paidAmount,
      notes: input.notes,
      createdAt: now,
      createdBy: input.shift.userId,
      syncStatus: 'pending',
      syncedAt: null,
      providerId,
      providerName,
      newDebtAmount: debtAmount > 0 ? debtAmount : 0,
      paysOldDebt: 0,
    }
    await db.expenses.put(expense)
    if (providerId && providerName) {
      await upsertCachedProvider({
        id: providerId,
        name: providerName,
        createdBy: input.shift.userId,
      })
      if (debtAmount > 0) {
        const event: LocalProviderDebtEvent = {
          id: debtEventId(expenseId, 'debt'),
          expenseId,
          shiftId: input.shift.id,
          storeId: input.shift.storeId,
          providerId,
          providerName,
          type: 'debt',
          amount: debtAmount,
          createdAt: now,
          createdBy: input.shift.userId,
          syncStatus: 'pending',
          syncedAt: null,
        }
        await db.providerDebtEvents.put(event)
      }
    }
  }

  await upsertLocalMerch({
    id,
    shiftId: input.shift.id,
    storeId: input.shift.storeId,
    lines: input.lines,
    notes: input.notes,
    paymentKind: input.paymentKind,
    paidAmount,
    debtAmount,
    providerId,
    providerName,
    expenseId,
    createdAt: now,
    createdBy: input.shift.userId,
    createdByName: input.viewerName,
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
    syncStatus: 'pending',
    syncedAt: null,
  })
}

export async function updateLocalMerchIntake(opts: {
  existing: LocalMerchandiseIntake
  lines: MerchIntakeLineSnapshot[]
  notes: string | null
  userId: string
  viewerName: string
}): Promise<void> {
  await upsertLocalMerch({
    ...opts.existing,
    lines: opts.lines,
    notes: opts.notes,
    updatedAt: new Date().toISOString(),
    updatedBy: opts.userId,
    updatedByName: opts.viewerName,
  })
}
