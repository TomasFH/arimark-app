/**
 * Último costo de compra por proveedor. Colección chica (1 doc por proveedor).
 * Path: licenses/{tenantId}/providerPurchasePrices/{providerId}
 */
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'
import log from 'electron-log'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { providerPurchasePrices } from '../db/schema'
import { getFirebaseApp, isFirebaseAvailable } from './firebase'
import { coerceMerchCostUnit, type MerchCostUnit } from '@carniceria/shared'

export interface PurchasePriceRow {
  providerId: string
  productKey: string
  name: string
  costUnit: MerchCostUnit
  unitCost: number
  updatedAt: string
}

export async function pullProviderPurchasePrices(
  tenantId: string,
  providerId: string,
): Promise<void> {
  if (!isFirebaseAvailable()) return
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const snap = await getDoc(doc(firestore, 'licenses', tenantId, 'providerPurchasePrices', providerId))
  if (!snap.exists()) return
  const data = snap.data() as { items?: unknown }
  if (!data.items || typeof data.items !== 'object') return
  const db = getDb()
  const now = new Date().toISOString()
  const items = data.items as Record<string, unknown>
  for (const [productKey, raw] of Object.entries(items)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const costUnit = coerceMerchCostUnit(row['costUnit'])
    const unitCost = typeof row['unitCost'] === 'number' ? Math.round(row['unitCost']) : null
    const name = typeof row['name'] === 'string' ? row['name'].trim() : ''
    if (!costUnit || unitCost == null || unitCost < 0 || !name) continue
    const updatedAt = typeof row['updatedAt'] === 'string' ? row['updatedAt'] : now
    const existing = db.select().from(providerPurchasePrices).where(and(
      eq(providerPurchasePrices.providerId, providerId),
      eq(providerPurchasePrices.productKey, productKey),
    )).get()
    if (existing && existing.syncedAt == null) continue
    db.insert(providerPurchasePrices).values({
      providerId,
      productKey,
      name: name.slice(0, 80),
      costUnit,
      unitCost,
      updatedAt,
      syncedAt: now,
    }).onConflictDoUpdate({
      target: [providerPurchasePrices.providerId, providerPurchasePrices.productKey],
      set: { name: name.slice(0, 80), costUnit, unitCost, updatedAt, syncedAt: now },
    }).run()
  }
}

export async function pushUnsyncedProviderPurchasePrices(tenantId: string): Promise<void> {
  if (!isFirebaseAvailable()) return
  const db = getDb()
  const pending = db.select().from(providerPurchasePrices).where(isNull(providerPurchasePrices.syncedAt)).all()
  if (pending.length === 0) return
  const byProvider = new Map<string, typeof pending>()
  for (const row of pending) {
    const list = byProvider.get(row.providerId) ?? []
    list.push(row)
    byProvider.set(row.providerId, list)
  }
  const app = getFirebaseApp()
  const firestore = getFirestore(app)
  const now = new Date().toISOString()
  for (const [providerId, rows] of byProvider) {
    try {
      const all = db.select().from(providerPurchasePrices).where(eq(providerPurchasePrices.providerId, providerId)).all()
      const items: Record<string, { name: string; costUnit: string; unitCost: number; updatedAt: string }> = {}
      for (const row of all) {
        items[row.productKey] = {
          name: row.name,
          costUnit: row.costUnit,
          unitCost: row.unitCost,
          updatedAt: row.updatedAt,
        }
      }
      await setDoc(doc(firestore, 'licenses', tenantId, 'providerPurchasePrices', providerId), {
        providerId,
        items,
        updatedAt: now,
      }, { merge: true })
      for (const row of rows) {
        db.update(providerPurchasePrices)
          .set({ syncedAt: now })
          .where(and(
            eq(providerPurchasePrices.providerId, providerId),
            eq(providerPurchasePrices.productKey, row.productKey),
          ))
          .run()
      }
    } catch (err) {
      log.error('[purchasePriceSync] Error al pushear costos', { providerId, err })
    }
  }
}

export function localPurchasePrices(providerId: string): PurchasePriceRow[] {
  const db = getDb()
  return db.select().from(providerPurchasePrices)
    .where(eq(providerPurchasePrices.providerId, providerId))
    .all()
    .map(r => ({
      providerId: r.providerId,
      productKey: r.productKey,
      name: r.name,
      costUnit: r.costUnit,
      unitCost: r.unitCost,
      updatedAt: r.updatedAt,
    }))
}

export function applyPurchasePrices(
  tx: Pick<ReturnType<typeof getDb>, 'insert' | 'select'>,
  opts: {
    providerId: string
    lines: Array<{ productKey: string; name: string; costUnit: MerchCostUnit | null; unitCost: number }>
    acceptPriceUpdates: boolean
    now: string
  },
): void {
  for (const line of opts.lines) {
    if (!line.costUnit || line.unitCost <= 0) continue
    const existing = tx.select().from(providerPurchasePrices).where(and(
      eq(providerPurchasePrices.providerId, opts.providerId),
      eq(providerPurchasePrices.productKey, line.productKey),
    )).get()
    if (existing && existing.unitCost !== line.unitCost && !opts.acceptPriceUpdates) continue
    tx.insert(providerPurchasePrices).values({
      providerId: opts.providerId,
      productKey: line.productKey,
      name: line.name.slice(0, 80),
      costUnit: line.costUnit,
      unitCost: line.unitCost,
      updatedAt: opts.now,
      syncedAt: null,
    }).onConflictDoUpdate({
      target: [providerPurchasePrices.providerId, providerPurchasePrices.productKey],
      set: {
        name: line.name.slice(0, 80),
        costUnit: line.costUnit,
        unitCost: line.unitCost,
        updatedAt: opts.now,
        syncedAt: null,
      },
    }).run()
  }
}
