/**
 * Mapeo SQLite ↔ snapshot de líneas de mercadería (sin red).
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { merchandiseIntakeLines, merchandiseIntakeRubros } from '../db/schema'
import {
  FACTORY_MERCH_RUBROS,
  parseMerchWeightsJson,
  serializeMerchWeightsJson,
  type MerchIntakeLineSnapshot,
} from '@carniceria/shared'

type MerchDb = Pick<ReturnType<typeof getDb>, 'delete' | 'insert'>
const FACTORY_CREATED_AT = '2026-09-17T00:00:00.000Z'

export function ensureFactoryMerchRubros(db: ReturnType<typeof getDb> = getDb()): void {
  for (const r of FACTORY_MERCH_RUBROS) {
    db.insert(merchandiseIntakeRubros).values({
      id: r.id,
      name: r.name,
      template: r.template,
      packContents: r.packContents,
      packTareKg: r.packTareKg,
      packLabel: r.packLabel,
      sortOrder: r.sortOrder,
      createdAt: FACTORY_CREATED_AT,
      syncedAt: null,
    }).onConflictDoNothing().run()
  }
}

export function merchDbLineToSnapshot(row: {
  id: string
  rubroId: string
  rubroName: string
  template: MerchIntakeLineSnapshot['template']
  sortOrder: number
  packLabel: string | null
  count: number
  packContents: number | null
  packTareKg: number | null
  hasIce: boolean
  grossKg: number | null
  netKg: number | null
  unitCount: number | null
  kgPerUnit: number | null
  weightsJson: string | null
  productId?: string | null
  nameKey?: string | null
  costUnit?: string | null
  unitCost?: number | null
  costTotal?: number | null
  packCount?: number | null
}): MerchIntakeLineSnapshot {
  return {
    id: row.id,
    rubroId: row.rubroId,
    rubroName: row.rubroName,
    template: row.template,
    sortOrder: row.sortOrder,
    packLabel: row.packLabel,
    count: row.count,
    packContents: row.packContents,
    packTareKg: row.packTareKg,
    hasIce: row.hasIce,
    grossKg: row.grossKg,
    netKg: row.netKg,
    unitCount: row.unitCount,
    kgPerUnit: row.kgPerUnit,
    weightsKg: parseMerchWeightsJson(row.weightsJson),
    productId: row.productId ?? null,
    nameKey: row.nameKey ?? '',
    costUnit: row.costUnit === 'kg' || row.costUnit === 'unit' || row.costUnit === 'pack' ? row.costUnit : null,
    unitCost: row.unitCost ?? 0,
    costTotal: row.costTotal ?? 0,
    packCount: row.packCount ?? null,
  }
}

export function snapshotToDbLine(intakeId: string, line: MerchIntakeLineSnapshot) {
  return {
    id: line.id,
    intakeId,
    rubroId: line.rubroId,
    rubroName: line.rubroName,
    template: line.template,
    sortOrder: line.sortOrder,
    packLabel: line.packLabel,
    count: line.count,
    packContents: line.packContents,
    packTareKg: line.packTareKg,
    hasIce: line.hasIce,
    grossKg: line.grossKg,
    netKg: line.netKg,
    unitCount: line.unitCount,
    kgPerUnit: line.kgPerUnit,
    weightsJson: serializeMerchWeightsJson(line.weightsKg),
    productId: line.productId,
    nameKey: line.nameKey,
    costUnit: line.costUnit,
    unitCost: line.unitCost,
    costTotal: line.costTotal,
    packCount: line.packCount,
  }
}

export function replaceIntakeLines(
  tx: MerchDb,
  intakeId: string,
  lines: MerchIntakeLineSnapshot[],
): void {
  tx.delete(merchandiseIntakeLines).where(eq(merchandiseIntakeLines.intakeId, intakeId)).run()
  for (const line of lines) {
    tx.insert(merchandiseIntakeLines).values(snapshotToDbLine(intakeId, line)).run()
  }
}
