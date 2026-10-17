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
  roundPurchaseUnitCost,
  snapshotFromFacts,
  type MerchIntakeLineSnapshot,
} from './merchIntake'

export const MERCH_COST_UNITS = ['kg', 'unit', 'pack'] as const
export type MerchCostUnit = (typeof MERCH_COST_UNITS)[number]

/** Cada cajón pide un kilo. Peso total es un solo kilo para todos los cajones. */
export const MERCH_WEIGH_MODES = ['each', 'total'] as const
export type MerchWeighMode = (typeof MERCH_WEIGH_MODES)[number]

/** payable entra a caja y deuda. informed queda en el comprobante. none no tiene precio. */
export const MERCH_MONEY_ROLES = ['payable', 'informed', 'none'] as const
export type MerchMoneyRole = (typeof MERCH_MONEY_ROLES)[number]

export const MERCH_PAYMENT_CHANNELS = ['cash', 'digital'] as const
export type MerchPaymentChannel = (typeof MERCH_PAYMENT_CHANNELS)[number]

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

export function coerceMerchWeighMode(value: unknown): MerchWeighMode | null {
  return value === 'each' || value === 'total' ? value : null
}

export function coerceMerchMoneyRole(value: unknown): MerchMoneyRole | null {
  return value === 'payable' || value === 'informed' || value === 'none' ? value : null
}

export function lineEntersVisitTotal(line: { moneyRole?: MerchMoneyRole | null }): boolean {
  return line.moneyRole !== 'informed' && line.moneyRole !== 'none'
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
    if (line.weighMode === 'total') {
      if (line.netKg != null && line.netKg > 0) parts.push(`peso total ${formatKg3(line.netKg)}`)
      return parts.join(' · ')
    }
    // Histórico y «cada cajón»: un kilo por cajón. No se muestra como un solo peso total.
    if (line.weightsKg.length > 1 && line.weightsKg.length === line.packCount) {
      parts.push(line.weightsKg.map(kg => formatKg3(kg)).join(' · '))
      return parts.join(' · ')
    }
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
  /** Costo informado: se ve en el comprobante y no entra al total. */
  aside?: string
}

export function merchVisitReceiptItems(drafts: MerchVisitLineDraft[]): MerchVisitReceiptItem[] {
  return drafts.flatMap((d, i) => {
    const r = resolveMerchVisitLine(d, { id: `r${i}`, sortOrder: i })
    if (!r.ok) return []
    const item: MerchVisitReceiptItem = { name: r.line.rubroName, qty: formatMerchVisitQty(r.line) }
    if (r.line.moneyRole === 'informed') item.aside = 'Costo informado'
    return [item]
  })
}

export function merchProductKey(productId: string | null | undefined, name: string): string {
  const id = productId?.trim()
  if (id) return `p:${id}`
  return `c:${merchNameKey(name)}`
}

export function lineCostTotal(costUnit: MerchCostUnit, unitCost: number, qty: number): number {
  // El unitario de compra es la excepción a los montos enteros (centavos de la boleta).
  // Se redondea a 2 decimales antes de multiplicar; el total de la línea vuelve al peso.
  // Math.round en positivos: el .5 se aleja de cero (24002.5 → 24003).
  const cost = roundPurchaseUnitCost(unitCost)
  if (!Number.isFinite(cost) || cost < 0) return 0
  if (!Number.isFinite(qty) || qty <= 0) return 0
  if (costUnit === 'kg') return Math.round(qty * cost)
  return Math.round(Math.round(qty) * cost)
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
  /** each = un kilo por cajón. total = un solo kilo. null = maple sin pesar, o histórico. */
  weighMode?: MerchWeighMode | null
  /** Por pieza con precio y sin rol: arranca como costo informado. */
  moneyRole?: MerchMoneyRole | null
  /** Suma al total y no crea producto ni PLU. */
  notForSale?: boolean
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

/** Cómo se compra, además del precio. La cantidad no se recuerda. */
export interface PurchaseMemory {
  unitCost: number
  costUnit: MerchCostUnit
  packContents: number | null
  weighMode: MerchWeighMode | null
}

export interface PurchaseRecallChange {
  productKey: string
  name: string
  price: { previous: number; next: number } | null
  costUnit: { previous: MerchCostUnit; next: MerchCostUnit } | null
  packContents: { previous: number | null; next: number | null } | null
  weighMode: { previous: MerchWeighMode | null; next: MerchWeighMode | null } | null
  /** El mismo producto está más de una vez: el recuerdo guarda una sola forma. */
  duplicate: boolean
}

export function purchaseRecallChanges(
  lines: Array<{
    productKey: string
    name: string
    unitCost: number
    costUnit: MerchCostUnit | null
    packContents: number | null
    weighMode: MerchWeighMode | null
  }>,
  memory: Record<string, PurchaseMemory>,
): PurchaseRecallChange[] {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line.productKey, (counts.get(line.productKey) ?? 0) + 1)
  const seen = new Set<string>()
  const out: PurchaseRecallChange[] = []
  for (const line of lines) {
    if (seen.has(line.productKey)) continue
    seen.add(line.productKey)
    const previous = memory[line.productKey]
    if (!previous) continue
    const duplicate = (counts.get(line.productKey) ?? 0) > 1
    const prevCost = roundPurchaseUnitCost(previous.unitCost)
    const nextCost = roundPurchaseUnitCost(line.unitCost)
    const price = Number.isFinite(prevCost) && Number.isFinite(nextCost) && prevCost !== nextCost && nextCost > 0
      ? { previous: prevCost, next: nextCost }
      : null
    const costUnit = line.costUnit && line.costUnit !== previous.costUnit
      ? { previous: previous.costUnit, next: line.costUnit }
      : null
    const prevPack = previous.packContents ?? null
    const nextPack = line.packContents ?? null
    const packContents = prevPack !== nextPack ? { previous: prevPack, next: nextPack } : null
    const prevWeigh = previous.weighMode ?? null
    const nextWeigh = line.weighMode ?? null
    const weighMode = prevWeigh !== nextWeigh ? { previous: prevWeigh, next: nextWeigh } : null
    if (!price && !costUnit && !packContents && !weighMode && !duplicate) continue
    out.push({
      productKey: line.productKey,
      name: line.name,
      price,
      costUnit,
      packContents,
      weighMode,
      duplicate,
    })
  }
  return out
}

export function formatWeighMode(mode: MerchWeighMode | null): string {
  if (mode === 'each') return 'cada cajón'
  if (mode === 'total') return 'peso total'
  return 'sin pesar'
}

export function formatRecallCostUnit(unit: MerchCostUnit): string {
  if (unit === 'kg') return 'kilo'
  if (unit === 'pack') return 'cajón'
  return 'unidad'
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
    const prevCost = roundPurchaseUnitCost(previous)
    const nextCost = roundPurchaseUnitCost(line.unitCost)
    if (!Number.isFinite(prevCost) || !Number.isFinite(nextCost) || prevCost === nextCost) continue
    out.push({
      productKey: line.productKey,
      name: line.name,
      previous: prevCost,
      next: nextCost,
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
  const unitCost = roundPurchaseUnitCost(draft.unitCost)
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
  const weighMode = coerceMerchWeighMode(draft.weighMode)
  const notForSale = draft.notForSale === true

  if (costUnitHint === 'pack') {
    const packs = draft.packCount
    if (packs == null || !Number.isInteger(packs) || packs <= 0 || packs > MERCH_INTAKE_QUANTITY_MAX) {
      return { ok: false, error: `Indicá cuántos cajones de ${name}.` }
    }
    if (unitCost <= 0) {
      return { ok: false, error: `Indicá el precio por cajón de ${name}.` }
    }
    const packLabel = draft.purchasePackLabel || DEFAULT_MAPLE_PACK_LABEL
    const costTotal = lineCostTotal('pack', unitCost, packs)
    if (weighMode === 'total') {
      if (weights.length !== 1) {
        return { ok: false, error: 'Indicá el peso total.' }
      }
      const kg = roundKg(weights[0]!)
      const factsOk = computeMerchLineFacts({ template: 'weight', kg })
      if (!factsOk.ok) return factsOk
      const line = snapshotFromFacts({
        id: opts.id,
        rubroId,
        rubroName: name,
        template: 'weight',
        sortOrder: opts.sortOrder,
        packLabel,
      }, factsOk.facts)
      return {
        ok: true,
        line: {
          ...line,
          count: packs,
          productId,
          nameKey,
          costUnit: 'pack',
          unitCost,
          costTotal,
          packCount: packs,
          packContents: packContents != null && packContents > 0 ? packContents : null,
          weightsKg: [kg],
          weighMode: 'total',
          moneyRole: 'payable',
          notForSale,
        },
      }
    }
    if (weighMode === 'each' || weights.length > 0) {
      if (weights.length !== packs) {
        return { ok: false, error: 'Cada cajón necesita su kilo.' }
      }
      const factsOk = computeMerchLineFacts({ template: 'pieces_weight', weightsKg: weights })
      if (!factsOk.ok) return factsOk
      const line = snapshotFromFacts({
        id: opts.id,
        rubroId,
        rubroName: name,
        template: 'pieces_weight',
        sortOrder: opts.sortOrder,
        packLabel,
      }, factsOk.facts)
      return {
        ok: true,
        line: {
          ...line,
          productId,
          nameKey,
          costUnit: 'pack',
          unitCost,
          costTotal,
          packCount: packs,
          packContents: packContents != null && packContents > 0 ? packContents : null,
          weighMode: 'each',
          moneyRole: 'payable',
          notForSale,
        },
      }
    }
    const line = snapshotFromFacts({
      id: opts.id,
      rubroId,
      rubroName: name,
      template: 'packs',
      sortOrder: opts.sortOrder,
      packLabel,
    }, {
      count: packs,
      packContents: packContents != null && packContents > 0 ? packContents : null,
      packTareKg: 0,
      hasIce: false,
      grossKg: null,
      netKg: null,
      unitCount: packContents != null && packContents > 0 ? packs * packContents : null,
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
        costTotal,
        packCount: packs,
        weighMode: null,
        moneyRole: 'payable',
        notForSale,
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
        weighMode: null,
        moneyRole: 'payable',
        notForSale,
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
    const explicitRole = coerceMerchMoneyRole(draft.moneyRole)
    const moneyRole: MerchMoneyRole = explicitRole === 'payable'
      ? 'payable'
      : (unitCost > 0 ? 'informed' : 'none')
    if (moneyRole === 'payable' && unitCost <= 0) {
      return { ok: false, error: `Indicá el precio de ${name}.` }
    }
    return {
      ok: true,
      line: {
        ...line,
        productId,
        nameKey,
        costUnit: unitCost > 0 ? 'kg' : null,
        unitCost,
        costTotal: moneyRole === 'none' ? 0 : lineCostTotal('kg', unitCost, factsOk.facts.netKg ?? 0),
        packCount: null,
        weighMode: null,
        moneyRole,
        notForSale,
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
        weighMode: null,
        moneyRole: 'payable',
        notForSale,
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
      weighMode: null,
      moneyRole: 'payable',
      notForSale,
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

export function merchVisitTotal(lines: Array<{ costTotal: number; moneyRole?: MerchMoneyRole | null }>): number {
  return lines.reduce((s, l) => (
    lineEntersVisitTotal(l) ? s + Math.max(0, Math.round(l.costTotal)) : s
  ), 0)
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
  weighMode: MerchWeighMode | null
  moneyRole: MerchMoneyRole | null
  notForSale: boolean
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
    weighMode: null,
    moneyRole: null,
    notForSale: false,
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
    unitCostRaw: lastCost != null && lastCost > 0 ? formatPurchaseUnitCostInput(lastCost) : '',
    costUnit: 'pack',
  })
}

/** Texto es-AR del DecimalInput de precio de compra, siempre con 2 decimales. */
export function formatPurchaseUnitCostInput(amount: number): string {
  const rounded = roundPurchaseUnitCost(amount)
  if (!Number.isFinite(rounded)) return ''
  const [intRaw, dec] = rounded.toFixed(2).split('.')
  const withDots = (intRaw ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${withDots},${dec ?? '00'}`
}

/** Precio unitario de compra para leer en pantalla (2 decimales). Los totales siguen en pesos enteros. */
export function formatPurchaseUnitCost(amount: number): string {
  const rounded = roundPurchaseUnitCost(amount)
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(rounded) ? rounded : 0)
}

function parsePesosRaw(raw: string): number | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

/** Precio de compra es-AR (4.800,50). Sin coma, los puntos son miles: 9.000 → 9000, no 9. */
function parsePurchaseUnitCostRaw(raw: string): number | null {
  const t = raw.trim()
  if (!t || t === ',') return null
  const normalized = t.includes(',')
    ? t.replace(/\./g, '').replace(',', '.')
    : t.replace(/\./g, '')
  const n = Number(normalized)
  const rounded = roundPurchaseUnitCost(n)
  return Number.isFinite(rounded) ? rounded : null
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
  const moneyRole = coerceMerchMoneyRole(line.moneyRole)
  // El pollo viejo marca weighPieces sin modalidad: sigue siendo un kilo por cajón.
  const weighMode = coerceMerchWeighMode(line.weighMode)
    ?? (line.weighPieces && costUnit === 'pack' ? 'each' : null)
  const parsedCost = parsePurchaseUnitCostRaw(line.unitCostRaw)
  const isPieces = line.weighPieces && costUnit !== 'pack'
  if (isPieces) {
    if ((moneyRole === 'payable' || moneyRole === 'informed') && (parsedCost == null || parsedCost <= 0)) {
      return { error: `Indicá el precio de ${name}.` }
    }
  } else if (parsedCost == null || parsedCost <= 0) {
    return {
      error: costUnit === 'pack'
        ? `Indicá el precio por cajón de ${name}.`
        : `Indicá el precio de compra de ${name}.`,
    }
  }
  const unitCost = parsedCost ?? 0
  const collectWeights = isPieces || (costUnit === 'pack' && (weighMode === 'each' || weighMode === 'total'))
  const weightsKg = collectWeights
    ? line.weightRaws.map(raw => parseKgRaw(raw)).filter((n): n is number => n != null && n > 0)
    : []
  if (costUnit === 'pack' && weighMode === 'total') {
    if (weightsKg.length !== 1) return { error: 'Indicá el peso total.' }
  } else if (costUnit === 'pack' && weighMode === 'each') {
    const packs = parsePesosRaw(line.packCountRaw)
    if (packs != null && packs > 0 && weightsKg.length !== packs) {
      return { error: 'Cada cajón necesita su kilo.' }
    }
  } else if (isPieces) {
    const pieces = parsePesosRaw(line.countRaw)
    if (pieces != null && pieces > 0 && weightsKg.length !== pieces) {
      return { error: 'Cargá el kilo de cada media res.' }
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
    weighMode,
    moneyRole: isPieces ? (moneyRole ?? (unitCost > 0 ? 'informed' : 'none')) : (moneyRole ?? 'payable'),
    notForSale: line.notForSale === true,
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
        weighMode: coerceMerchWeighMode(r['weighMode']),
        moneyRole: coerceMerchMoneyRole(r['moneyRole']),
        notForSale: r['notForSale'] === true,
      })
    }
    return lines.slice(0, MERCH_INTAKE_MAX_LINES)
  } catch {
    return []
  }
}
