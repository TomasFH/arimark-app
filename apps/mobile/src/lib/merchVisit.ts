/**
 * Borrador de visita (local) y último costo de compra (1 doc Firestore por proveedor).
 */
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore'
import { v4 as uuidv4 } from 'uuid'
import {
  merchProductKey,
  type MerchCostUnit,
  type MerchIntakeLineSnapshot,
  type MerchVisitFormLine,
} from '@carniceria/shared'
import { firebaseApp, LICENSE_KEY } from '../firebase'
import { isOnline } from './connectivity'
import { db } from './db'
import type { LocalProviderPurchasePrices, LocalShift } from '../types/pos'
import { upsertLocalMerch } from './merchIntake'

const firestore = getFirestore(firebaseApp)

export async function getMerchVisitDraft(shiftId: string) {
  return (await db.merchVisitDrafts.get(shiftId)) ?? null
}

export async function saveMerchVisitDraft(input: {
  shiftId: string
  providerId: string | null
  providerName: string | null
  notes: string | null
  lines: MerchVisitFormLine[]
}): Promise<void> {
  await db.merchVisitDrafts.put({
    shiftId: input.shiftId,
    providerId: input.providerId,
    providerName: input.providerName,
    notes: input.notes,
    lines: input.lines,
    updatedAt: new Date().toISOString(),
  })
}

export async function discardMerchVisitDraft(shiftId: string): Promise<void> {
  await db.merchVisitDrafts.delete(shiftId)
}

export type PurchasePriceMap = Record<string, number>

export async function getProviderPurchasePriceMap(providerId: string): Promise<PurchasePriceMap> {
  if (await isOnline()) {
    try {
      const snap = await getDoc(doc(firestore, 'licenses', LICENSE_KEY, 'providerPurchasePrices', providerId))
      if (snap.exists()) {
        const data = snap.data() as { items?: unknown }
        if (data.items && typeof data.items === 'object') {
          const items: LocalProviderPurchasePrices['items'] = {}
          for (const [key, raw] of Object.entries(data.items as Record<string, unknown>)) {
            if (!raw || typeof raw !== 'object') continue
            const row = raw as Record<string, unknown>
            const costUnit = row['costUnit']
            const unitCost = typeof row['unitCost'] === 'number' ? Math.round(row['unitCost']) : null
            const name = typeof row['name'] === 'string' ? row['name'] : ''
            if ((costUnit !== 'kg' && costUnit !== 'unit' && costUnit !== 'pack') || unitCost == null || unitCost < 0 || !name) continue
            items[key] = {
              name,
              costUnit,
              unitCost,
              updatedAt: typeof row['updatedAt'] === 'string' ? row['updatedAt'] : new Date().toISOString(),
            }
          }
          await db.providerPurchasePrices.put({
            providerId,
            items,
            syncStatus: 'synced',
            syncedAt: new Date().toISOString(),
          })
        }
      }
    } catch (err) {
      console.error('[merchVisit] No se pudieron leer costos de compra', err)
    }
  }
  const cached = await db.providerPurchasePrices.get(providerId)
  const map: PurchasePriceMap = {}
  if (!cached) return map
  for (const [key, row] of Object.entries(cached.items)) map[key] = row.unitCost
  return map
}

export async function applyMobilePurchasePrices(opts: {
  providerId: string
  lines: Array<{ productKey: string; name: string; costUnit: MerchCostUnit | null; unitCost: number }>
  acceptPriceUpdates: boolean
}): Promise<void> {
  const now = new Date().toISOString()
  const existing = await db.providerPurchasePrices.get(opts.providerId)
  const items = { ...(existing?.items ?? {}) }
  for (const line of opts.lines) {
    if (!line.costUnit || line.unitCost <= 0) continue
    const prev = items[line.productKey]
    if (prev && prev.unitCost !== line.unitCost && !opts.acceptPriceUpdates) continue
    items[line.productKey] = {
      name: line.name.slice(0, 80),
      costUnit: line.costUnit,
      unitCost: line.unitCost,
      updatedAt: now,
    }
  }
  await db.providerPurchasePrices.put({
    providerId: opts.providerId,
    items,
    syncStatus: 'pending',
    syncedAt: null,
  })
  if (!(await isOnline())) return
  try {
    await setDoc(doc(firestore, 'licenses', LICENSE_KEY, 'providerPurchasePrices', opts.providerId), {
      providerId: opts.providerId,
      items,
      updatedAt: now,
    }, { merge: true })
    await db.providerPurchasePrices.update(opts.providerId, {
      syncStatus: 'synced',
      syncedAt: now,
    })
  } catch (err) {
    console.error('[merchVisit] No se pudieron subir costos de compra', err)
  }
}

export async function saveMerchVisitForExpense(input: {
  shift: LocalShift
  viewerName: string
  expenseId: string | null
  lines: MerchIntakeLineSnapshot[]
  notes: string | null
  paidAmount: number
  debtAmount: number
  providerId: string
  providerName: string
}): Promise<void> {
  const now = new Date().toISOString()
  const paymentKind = input.paidAmount > 0 ? 'paid_now' : (input.debtAmount > 0 ? 'on_account' : 'none')
  await upsertLocalMerch({
    id: uuidv4(),
    shiftId: input.shift.id,
    storeId: input.shift.storeId,
    lines: input.lines,
    notes: input.notes,
    paymentKind,
    paidAmount: input.paidAmount,
    debtAmount: input.debtAmount,
    providerId: input.providerId,
    providerName: input.providerName,
    expenseId: input.expenseId,
    status: 'confirmed',
    createdAt: now,
    createdBy: input.shift.userId,
    createdByName: input.viewerName,
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
    syncStatus: 'pending',
    syncedAt: null,
  })
  await discardMerchVisitDraft(input.shift.id)
}

export { merchProductKey }
