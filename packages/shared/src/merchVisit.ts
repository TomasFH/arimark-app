/**
 * Visita de proveedor con mercadería (Gastos).
 * Hechos de renglón + costo de compra. No aplica perfiles de stock.
 */
import {
  MERCH_INTAKE_MAX_LINES,
  MERCH_INTAKE_MAX_WEIGHTS,
  MERCH_INTAKE_NAME_MAX,
  MERCH_INTAKE_QUANTITY_MAX,
  computeMerchLineFacts,
  formatKg3,
  merchNameKey,
  snapshotFromFacts,
  type MerchIntakeLineSnapshot,
} from './merchIntake'

export const MERCH_COST_UNITS = ['kg', 'unit', 'pack'] as const
export type MerchCostUnit = (typeof MERCH_COST_UNITS)[number]

export const PROVIDER_INTAKE_KINDS = ['catalog', 'media_res', 'chicken', 'insumos'] as const
export type ProviderIntakeKind = (typeof PROVIDER_INTAKE_KINDS)[number]

/** Visitas que escriben mercadería. Insumos usa gasto con proveedor, sin renglones. */
export const MERCH_VISIT_KINDS = ['catalog', 'media_res', 'chicken'] as const
export type MerchVisitKind = (typeof MERCH_VISIT_KINDS)[number]

/** Copy de caja. El valor interno `catalog` no se muestra. */
export const PROVIDER_INTAKE_KIND_LABELS: Record<ProviderIntakeKind, string> = {
  catalog: 'Productos',
  media_res: 'Media res',
  chicken: 'Pollo',
  insumos: 'Insumos',
}

export const MEDIA_RES_VISIT_NAME = 'Media res'
export const CHICKEN_VISIT_NAME = 'Pollo'

export const DEFAULT_MAPLE_PACK_CONTENTS = 12
export const DEFAULT_MAPLE_PACK_LABEL = 'Cajón'

export function coerceMerchCostUnit(value: unknown): MerchCostUnit | null {
  return value === 'kg' || value === 'unit' || value === 'pack' ? value : null
}

export function coerceProviderIntakeKind(value: unknown): ProviderIntakeKind | null {
  return value === 'catalog' || value === 'media_res' || value === 'chicken' || value === 'insumos'
    ? value
    : null
}

export function coerceMerchVisitKind(value: unknown): MerchVisitKind | null {
  return value === 'catalog' || value === 'media_res' || value === 'chicken' ? value : null
}

export function formatMerchCostUnit(unit: MerchCostUnit): string {
  if (unit === 'kg') return '$/kg'
  if (unit === 'pack') return '$/cajón'
  return '$/u'
}

export function formatPackCountLabel(count: number, packLabel: string | null | undefined): string {
  const raw = (packLabel && packLabel.trim()) || DEFAULT_MAPLE_PACK_LABEL
  const lower = raw.toLowerCase()
  if (count === 1) return `1 ${lower}`
  if (lower === 'cajón' || lower === 'cajon') return `${count} cajones`
  return `${count} ${lower}`
}

/** Cantidad de caja para el comprobante: producto aparte; acá unidades y/o kg. */
export function formatMerchVisitQty(line: MerchIntakeLineSnapshot): string {
  if (line.costUnit === 'pack' && line.packCount != null && line.packCount > 0) {
    const parts = [formatPackCountLabel(line.packCount, line.packLabel)]
    if (line.netKg != null && line.netKg > 0) parts.push(formatKg3(line.netKg))
    return parts.join(' · ')
  }
  if (line.template === 'packs' && line.count > 0) {
    return formatPackCountLabel(line.count, line.packLabel)
  }
  if (line.template === 'pieces_weight') {
    const units = line.count === 1 ? '1 u' : `${line.count} u`
    if (line.netKg != null && line.netKg > 0) return `${units} · ${formatKg3(line.netKg)}`
    return units
  }
  if (line.template === 'weight' && line.netKg != null && line.netKg > 0) {
    return formatKg3(line.netKg)
  }
  if (line.count > 0) return line.count === 1 ? '1 u' : `${line.count} u`
  if (line.netKg != null && line.netKg > 0) return formatKg3(line.netKg)
  return ''
}

export interface MerchVisitReceiptItem {
  name: string
  qty: string
}

export function merchVisitReceiptItems(drafts: MerchVisitLineDraft[]): MerchVisitReceiptItem[] {
  return drafts.flatMap((d, i) => {
    const r = resolveMerchVisitLine(d, { id: `r${i}`, sortOrder: i })
    if (!r.ok) return []
    return [{ name: r.line.rubroName, qty: formatMerchVisitQty(r.line) }]
  })
}

export function merchProductKey(productId: string | null | undefined, name: string): string {
  const id = productId?.trim()
  if (id) return `p:${id}`
  return `c:${merchNameKey(name)}`
}

export function lineCostTotal(costUnit: MerchCostUnit, unitCost: number, qty: number): number {
  const cost = Math.round(unitCost)
  if (!Number.isFinite(cost) || cost < 0) return 0
  if (!Number.isFinite(qty) || qty <= 0) return 0
  if (costUnit === 'kg') return Math.round(qty * cost)
  return Math.round(qty) * cost
}

export function resizeWeightInputs(count: number, existing: string[]): string[] {
  const n = Math.max(0, Math.min(MERCH_INTAKE_MAX_WEIGHTS, Math.trunc(count)))
  if (n === existing.length) return existing
  const next = existing.slice(0, n)
  while (next.length < n) next.push('')
  return next
}

export interface MerchVisitLineDraft {
  productId: string | null
  name: string
  catalogUnit: 'kg' | 'unit' | null
  purchasePackLabel: string | null
  purchasePackContents: number | null
  kg: number | null
  packCount: number | null
  count: number | null
  weightsKg: number[]
  unitCost: number
  /** Si está, pisa la inferencia (pollo: pack + kilos por cajón). */
  costUnit?: MerchCostUnit | null
}

export interface LastPurchasePrice {
  productKey: string
  name: string
  costUnit: MerchCostUnit
  unitCost: number
}

export interface PurchasePriceChange {
  productKey: string
  name: string
  previous: number
  next: number
}

export function purchasePriceChanges(
  lines: Array<{ productKey: string; name: string; unitCost: number }>,
  lastByKey: Record<string, number>,
): PurchasePriceChange[] {
  const seen = new Set<string>()
  const out: PurchasePriceChange[] = []
  for (const line of lines) {
    if (seen.has(line.productKey)) continue
    seen.add(line.productKey)
    const previous = lastByKey[line.productKey]
    if (previous == null) continue
    if (previous === line.unitCost) continue
    out.push({
      productKey: line.productKey,
      name: line.name,
      previous,
      next: line.unitCost,
    })
  }
  return out
}

export type MerchVisitLineResult =
  | { ok: true; line: MerchIntakeLineSnapshot }
  | { ok: false; error: string }

function roundKg(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function resolveMerchVisitLine(
  draft: MerchVisitLineDraft,
  opts: { id: string; sortOrder: number },
): MerchVisitLineResult {
  const name = draft.name.trim()
  if (!name) return { ok: false, error: 'Indicá el producto.' }
  if (name.length > MERCH_INTAKE_NAME_MAX) {
    return { ok: false, error: `El nombre no puede superar ${MERCH_INTAKE_NAME_MAX} caracteres.` }
  }
  const unitCost = Math.round(draft.unitCost)
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    return { ok: false, error: `Precio inválido en ${name}.` }
  }

  const productId = draft.productId?.trim() || null
  const nameKey = merchNameKey(name)
  const rubroId = productId ?? `custom:${nameKey}`
  const weights = (draft.weightsKg ?? []).filter(n => Number.isFinite(n) && n > 0)
  if (weights.length > MERCH_INTAKE_MAX_WEIGHTS) {
    return { ok: false, error: `Como máximo ${MERCH_INTAKE_MAX_WEIGHTS} pesos por renglón.` }
  }

  const packContents = draft.purchasePackContents
  const usePack = draft.catalogUnit === 'unit' && packContents != null && packContents > 0
  const costUnitHint = coerceMerchCostUnit(draft.costUnit)

  if (costUnitHint === 'pack') {
    const packs = draft.packCount
    if (packs == null || !Number.isInteger(packs) || packs <= 0 || packs > MERCH_INTAKE_QUANTITY_MAX) {
      return { ok: false, error: `Indicá cuántos cajones de ${name}.` }
    }
    if (weights.length !== packs) {
      return { ok: false, error: 'Cada cajón necesita su kilo.' }
    }
    if (unitCost <= 0) {
      return { ok: false, error: `Indicá el precio por cajón de ${name}.` }
    }
    const factsOk = computeMerchLineFacts({ template: 'pieces_weight', weightsKg: weights })
    if (!factsOk.ok) return factsOk
    const line = snapshotFromFacts({
      id: opts.id,
      rubroId,
      rubroName: name,
      template: 'pieces_weight',
      sortOrder: opts.sortOrder,
      packLabel: draft.purchasePackLabel || DEFAULT_MAPLE_PACK_LABEL,
    }, factsOk.facts)
    return {
      ok: true,
      line: {
        ...line,
        productId,
        nameKey,
        costUnit: 'pack',
        unitCost,
        costTotal: lineCostTotal('pack', unitCost, packs),
        packCount: packs,
      },
    }
  }

  if (usePack) {
    const packs = draft.packCount
    if (packs == null || !Number.isInteger(packs) || packs <= 0 || packs > MERCH_INTAKE_QUANTITY_MAX) {
      return { ok: false, error: `Indicá cuántos ${(draft.purchasePackLabel || 'cajón').toLowerCase()}s de ${name}.` }
    }
    const unitCount = packs * packContents
    const line = snapshotFromFacts({
      id: opts.id,
      rubroId,
      rubroName: name,
      template: 'packs',
      sortOrder: opts.sortOrder,
      packLabel: draft.purchasePackLabel,
    }, {
      count: packs,
      packContents,
      packTareKg: 0,
      hasIce: false,
      grossKg: null,
      netKg: null,
      unitCount,
      kgPerUnit: null,
      weightsKg: [],
    })
    return {
      ok: true,
      line: {
        ...line,
        productId,
        nameKey,
        costUnit: 'pack',
        unitCost,
        costTotal: lineCostTotal('pack', unitCost, packs),
        packCount: packs,
      },
    }
  }

  if (weights.length > 0) {
    const factsOk = computeMerchLineFacts({ template: 'pieces_weight', weightsKg: weights })
    if (!factsOk.ok) return factsOk
    const line = snapshotFromFacts({
      id: opts.id,
      rubroId,
      rubroName: name,
      template: 'pieces_weight',
      sortOrder: opts.sortOrder,
      packLabel: null,
    }, factsOk.facts)
    return {
      ok: true,
      line: {
        ...line,
        productId,
        nameKey,
        costUnit: 'kg',
        unitCost,
        costTotal: lineCostTotal('kg', unitCost, factsOk.facts.netKg ?? 0),
        packCount: null,
      },
    }
  }

  if (draft.catalogUnit === 'kg' || (draft.catalogUnit == null && draft.kg != null && draft.count == null)) {
    const kg = draft.kg
    if (kg == null || !Number.isFinite(kg) || kg <= 0 || kg > MERCH_INTAKE_QUANTITY_MAX) {
      return { ok: false, error: `Indicá los kilos de ${name}.` }
    }
    const factsOk = computeMerchLineFacts({ template: 'weight', kg: roundKg(kg) })
    if (!factsOk.ok) return factsOk
    const line = snapshotFromFacts({
      id: opts.id,
      rubroId,
      rubroName: name,
      template: 'weight',
      sortOrder: opts.sortOrder,
      packLabel: null,
    }, factsOk.facts)
    return {
      ok: true,
      line: {
        ...line,
        productId,
        nameKey,
        costUnit: 'kg',
        unitCost,
        costTotal: lineCostTotal('kg', unitCost, factsOk.facts.netKg ?? 0),
        packCount: null,
      },
    }
  }

  const count = draft.count
  if (count == null || !Number.isInteger(count) || count <= 0 || count > MERCH_INTAKE_QUANTITY_MAX) {
    return { ok: false, error: `Indicá la cantidad de ${name}.` }
  }
  const factsOk = computeMerchLineFacts({ template: 'count', count })
  if (!factsOk.ok) return factsOk
  const line = snapshotFromFacts({
    id: opts.id,
    rubroId,
    rubroName: name,
    template: 'count',
    sortOrder: opts.sortOrder,
    packLabel: null,
  }, factsOk.facts)
  return {
    ok: true,
    line: {
      ...line,
      productId,
      nameKey,
      costUnit: 'unit',
      unitCost,
      costTotal: lineCostTotal('unit', unitCost, count),
      packCount: null,
    },
  }
}

export function resolveMerchVisitLines(
  drafts: MerchVisitLineDraft[],
): { ok: true; lines: MerchIntakeLineSnapshot[] } | { ok: false; error: string } {
  if (drafts.length < 1 || drafts.length > MERCH_INTAKE_MAX_LINES) {
    return { ok: false, error: 'La visita necesita al menos un producto.' }
  }
  const lines: MerchIntakeLineSnapshot[] = []
  for (let i = 0; i < drafts.length; i++) {
    const resolved = resolveMerchVisitLine(drafts[i]!, {
      id: `tmp-${i}`,
      sortOrder: i,
    })
    if (!resolved.ok) return resolved
    lines.push(resolved.line)
  }
  return { ok: true, lines }
}

export function merchVisitTotal(lines: Array<{ costTotal: number }>): number {
  return lines.reduce((s, l) => s + Math.max(0, Math.round(l.costTotal)), 0)
}

export interface MerchVisitFormLine {
  key: string
  productId: string | null
  name: string
  catalogUnit: 'kg' | 'unit' | null
  purchasePackLabel: string | null
  purchasePackContents: number | null
  kgRaw: string
  packCountRaw: string
  countRaw: string
  weightRaws: string[]
  unitCostRaw: string
  weighPieces: boolean
  costUnit: MerchCostUnit | null
}

export function emptyMerchVisitFormLine(partial?: Partial<MerchVisitFormLine>): MerchVisitFormLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: null,
    name: '',
    catalogUnit: null,
    purchasePackLabel: null,
    purchasePackContents: null,
    kgRaw: '',
    packCountRaw: '',
    countRaw: '',
    weightRaws: [],
    unitCostRaw: '',
    weighPieces: false,
    costUnit: null,
    ...partial,
  }
}

export function emptyMediaResFormLine(): MerchVisitFormLine {
  return emptyMerchVisitFormLine({
    name: MEDIA_RES_VISIT_NAME,
    weighPieces: true,
    countRaw: '',
    weightRaws: [],
    unitCostRaw: '0',
    costUnit: null,
  })
}

export function emptyChickenFormLine(lastCost?: number): MerchVisitFormLine {
  return emptyMerchVisitFormLine({
    name: CHICKEN_VISIT_NAME,
    catalogUnit: 'unit',
    purchasePackLabel: DEFAULT_MAPLE_PACK_LABEL,
    purchasePackContents: null,
    weighPieces: true,
    packCountRaw: '',
    weightRaws: [],
    unitCostRaw: lastCost != null && lastCost > 0 ? String(lastCost) : '',
    costUnit: 'pack',
  })
}

function parsePesosRaw(raw: string): number | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

function parseKgRaw(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const normalized = t.includes(',')
    ? t.replace(/\./g, '').replace(',', '.')
    : t
  const n = Number(normalized)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function merchFormLineToDraft(line: MerchVisitFormLine): MerchVisitLineDraft | { error: string } {
  const name = line.name.trim()
  if (!name) return { error: 'Indicá el producto.' }
  const costUnit = coerceMerchCostUnit(line.costUnit)
  const parsedCost = parsePesosRaw(line.unitCostRaw)
  const allowZeroCost = costUnit !== 'pack' && line.weighPieces && !line.productId
  if (!allowZeroCost && (parsedCost == null || parsedCost <= 0)) {
    return {
      error: costUnit === 'pack'
        ? `Indicá el precio por cajón de ${name}.`
        : `Indicá el precio de compra de ${name}.`,
    }
  }
  const unitCost = parsedCost ?? 0
  const weightsKg = line.weighPieces || costUnit === 'pack'
    ? line.weightRaws.map(raw => parseKgRaw(raw)).filter((n): n is number => n != null && n > 0)
    : []
  const expectedPieces = costUnit === 'pack'
    ? parsePesosRaw(line.packCountRaw)
    : (line.weighPieces ? parsePesosRaw(line.countRaw) : null)
  if (expectedPieces != null && expectedPieces > 0 && weightsKg.length !== expectedPieces) {
    return {
      error: costUnit === 'pack'
        ? 'Cada cajón necesita su kilo.'
        : 'Cargá el kilo de cada media res.',
    }
  }
  return {
    productId: line.productId,
    name,
    catalogUnit: line.catalogUnit,
    purchasePackLabel: line.purchasePackLabel,
    purchasePackContents: line.purchasePackContents,
    kg: line.catalogUnit === 'kg' || (line.catalogUnit == null && !line.weighPieces && line.kgRaw.trim())
      ? parseKgRaw(line.kgRaw)
      : null,
    packCount: parsePesosRaw(line.packCountRaw),
    count: parsePesosRaw(line.countRaw),
    weightsKg,
    unitCost,
    costUnit,
  }
}

export function visitLinesFromForm(lines: MerchVisitFormLine[]):
  | { ok: true; drafts: MerchVisitLineDraft[]; total: number }
  | { ok: false; error: string } {
  const drafts: MerchVisitLineDraft[] = []
  for (const line of lines) {
    const draft = merchFormLineToDraft(line)
    if ('error' in draft) return { ok: false, error: draft.error }
    const resolved = resolveMerchVisitLine(draft, { id: line.key, sortOrder: drafts.length })
    if (!resolved.ok) return { ok: false, error: resolved.error }
    drafts.push(draft)
  }
  if (drafts.length === 0) return { ok: false, error: 'Agregá al menos un producto.' }
  const resolvedAll = drafts.map((d, i) => resolveMerchVisitLine(d, { id: `l${i}`, sortOrder: i }))
  const snapshots = resolvedAll.flatMap(r => r.ok ? [r.line] : [])
  if (snapshots.length !== drafts.length) return { ok: false, error: 'Revisá los renglones.' }
  return { ok: true, drafts, total: merchVisitTotal(snapshots) }
}

export function parseMerchVisitFormLines(raw: string | null | undefined): MerchVisitFormLine[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const lines: MerchVisitFormLine[] = []
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      if (typeof r['name'] !== 'string' || typeof r['key'] !== 'string') continue
      const catalogUnit = r['catalogUnit'] === 'kg' || r['catalogUnit'] === 'unit' ? r['catalogUnit'] : null
      lines.push({
        key: String(r['key']),
        productId: typeof r['productId'] === 'string' && r['productId'] ? r['productId'] : null,
        name: String(r['name'] ?? ''),
        catalogUnit,
        purchasePackLabel: typeof r['purchasePackLabel'] === 'string' ? r['purchasePackLabel'] : null,
        purchasePackContents: typeof r['purchasePackContents'] === 'number' ? r['purchasePackContents'] : null,
        kgRaw: typeof r['kgRaw'] === 'string' ? r['kgRaw'] : '',
        packCountRaw: typeof r['packCountRaw'] === 'string' ? r['packCountRaw'] : '',
        countRaw: typeof r['countRaw'] === 'string' ? r['countRaw'] : '',
        weightRaws: Array.isArray(r['weightRaws']) ? r['weightRaws'].filter((x): x is string => typeof x === 'string') : [],
        unitCostRaw: typeof r['unitCostRaw'] === 'string' ? r['unitCostRaw'] : '',
        weighPieces: r['weighPieces'] === true,
        costUnit: coerceMerchCostUnit(r['costUnit']),
      })
    }
    return lines.slice(0, MERCH_INTAKE_MAX_LINES)
  } catch {
    return []
  }
}
