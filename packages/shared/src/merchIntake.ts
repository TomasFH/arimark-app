/**
 * Puente v1.0 de ingreso de mercadería (FEAT-MERCH-INTAKE-01).
 *
 * Un registro = una entrega (varias líneas). Los rubros los arma el admin
 * (toda la licencia). Las plantillas de medición son fijas en código.
 *
 * Campos canónicos por línea (count, netKg, unitCount, kgPerUnit, createdAt
 * del encabezado) quedan listos para estadísticas semanales/mensuales:
 * agrupar por rubroId + storeId en un rango ISO. No implementa esas pantallas.
 */

export const MERCH_INTAKE_TEMPLATES = ['pieces_weight', 'packs', 'weight', 'count'] as const
export type MerchIntakeTemplate = (typeof MERCH_INTAKE_TEMPLATES)[number]

export const MERCH_INTAKE_TEMPLATE_LABELS: Record<MerchIntakeTemplate, string> = {
  pieces_weight: 'Piezas con kilo cada una',
  packs: 'Bultos (cajón / maple)',
  weight: 'Solo kilos',
  count: 'Solo unidades',
}

export const MERCH_INTAKE_PAYMENT_KINDS = ['none', 'paid_now', 'on_account'] as const
export type MerchIntakePaymentKind = (typeof MERCH_INTAKE_PAYMENT_KINDS)[number]

export const MERCH_INTAKE_PAYMENT_LABELS: Record<MerchIntakePaymentKind, string> = {
  none: 'Sin pago',
  paid_now: 'Pagó ahora',
  on_account: 'Queda debiendo',
}

/** Compat docs viejos (un renglón kg|u). */
export const MERCH_INTAKE_UNITS = ['kg', 'u'] as const
export type MerchIntakeUnit = (typeof MERCH_INTAKE_UNITS)[number]

export const MERCH_INTAKE_NOTES_MAX = 300
export const MERCH_INTAKE_NAME_MAX = 80
export const MERCH_INTAKE_QUANTITY_MAX = 99_999
export const MERCH_INTAKE_MAX_WEIGHTS = 40
export const MERCH_INTAKE_MAX_LINES = 20
export const MERCH_INTAKE_EXPENSE_CONCEPT_RE = /^mercader[ií]a\s*:/i

export function coerceMerchIntakeUnit(value: unknown): MerchIntakeUnit | null {
  return value === 'kg' || value === 'u' ? value : null
}

export function coerceMerchIntakePaymentKind(value: unknown): MerchIntakePaymentKind | null {
  return value === 'none' || value === 'paid_now' || value === 'on_account' ? value : null
}

export function coerceMerchIntakeTemplate(value: unknown): MerchIntakeTemplate | null {
  return (MERCH_INTAKE_TEMPLATES as readonly string[]).includes(value as string)
    ? (value as MerchIntakeTemplate)
    : null
}

export interface FactoryMerchRubro {
  id: string
  name: string
  template: MerchIntakeTemplate
  packContents: number | null
  packTareKg: number | null
  packLabel: string | null
  sortOrder: number
}

/** Semillas de fábrica (ids estables entre PCs). El admin puede archivarlas o crear otras. */
export const FACTORY_MERCH_RUBROS: readonly FactoryMerchRubro[] = [
  { id: 'rubro_media_res', name: 'Media res', template: 'pieces_weight', packContents: null, packTareKg: null, packLabel: null, sortOrder: 10 },
  { id: 'rubro_pollo_entero', name: 'Pollo entero', template: 'packs', packContents: null, packTareKg: null, packLabel: 'Cajón', sortOrder: 20 },
  { id: 'rubro_maple', name: 'Maple', template: 'packs', packContents: null, packTareKg: null, packLabel: 'Maple', sortOrder: 30 },
  { id: 'rubro_cerdo', name: 'Cerdo', template: 'weight', packContents: null, packTareKg: null, packLabel: null, sortOrder: 40 },
  { id: 'rubro_bondiola', name: 'Bondiola', template: 'weight', packContents: null, packTareKg: null, packLabel: null, sortOrder: 50 },
  { id: 'rubro_costilla_cerdo', name: 'Costilla de cerdo', template: 'weight', packContents: null, packTareKg: null, packLabel: null, sortOrder: 60 },
  { id: 'rubro_chinchulin', name: 'Chinchulín', template: 'weight', packContents: null, packTareKg: null, packLabel: null, sortOrder: 70 },
  { id: 'rubro_chorizo', name: 'Chorizo', template: 'weight', packContents: null, packTareKg: null, packLabel: null, sortOrder: 80 },
  { id: 'rubro_morcilla', name: 'Morcilla', template: 'weight', packContents: null, packTareKg: null, packLabel: null, sortOrder: 90 },
  { id: 'rubro_carbon', name: 'Carbón', template: 'count', packContents: null, packTareKg: null, packLabel: null, sortOrder: 100 },
  { id: 'rubro_lenia', name: 'Leña', template: 'count', packContents: null, packTareKg: null, packLabel: null, sortOrder: 110 },
  { id: 'rubro_limpieza', name: 'Limpieza', template: 'count', packContents: null, packTareKg: null, packLabel: null, sortOrder: 120 },
]

export interface MerchLineFacts {
  count: number
  packContents: number | null
  packTareKg: number | null
  hasIce: boolean
  grossKg: number | null
  netKg: number | null
  unitCount: number | null
  kgPerUnit: number | null
  weightsKg: number[]
}

export type MerchLineComputeInput =
  | { template: 'pieces_weight'; weightsKg: number[] }
  | { template: 'packs'; packGrossKg: number[]; packContents: number; packTareKg: number; hasIce: boolean }
  | { template: 'weight'; kg: number }
  | { template: 'count'; count: number }

export type MerchLineComputeResult =
  | { ok: true; facts: MerchLineFacts }
  | { ok: false; error: string }

function roundKg(n: number): number {
  return Math.round(n * 1000) / 1000
}

function validateWeights(weightsKg: number[], label: string): string | null {
  if (!Array.isArray(weightsKg) || weightsKg.length < 1) {
    return `Indicá el peso de cada ${label}.`
  }
  if (weightsKg.length > MERCH_INTAKE_MAX_WEIGHTS) {
    return `Como máximo ${MERCH_INTAKE_MAX_WEIGHTS} ${label}s por renglón.`
  }
  for (const w of weightsKg) {
    if (!Number.isFinite(w) || w <= 0 || w > MERCH_INTAKE_QUANTITY_MAX) {
      return `Cada ${label} necesita un peso mayor a 0.`
    }
  }
  return null
}

export function computeMerchLineFacts(input: MerchLineComputeInput): MerchLineComputeResult {
  if (input.template === 'pieces_weight') {
    const err = validateWeights(input.weightsKg, 'pieza')
    if (err) return { ok: false, error: err }
    const weightsKg = input.weightsKg.map(roundKg)
    const grossKg = roundKg(weightsKg.reduce((s, w) => s + w, 0))
    const count = weightsKg.length
    return {
      ok: true,
      facts: {
        count,
        packContents: null,
        packTareKg: null,
        hasIce: false,
        grossKg,
        netKg: grossKg,
        unitCount: count,
        kgPerUnit: roundKg(grossKg / count),
        weightsKg,
      },
    }
  }

  if (input.template === 'packs') {
    const err = validateWeights(input.packGrossKg, 'bulto')
    if (err) return { ok: false, error: err }
    if (!Number.isInteger(input.packContents) || input.packContents <= 0) {
      return { ok: false, error: 'Indicá cuántas unidades van en cada bulto.' }
    }
    if (!Number.isFinite(input.packTareKg) || input.packTareKg < 0) {
      return { ok: false, error: 'La tara del bulto no puede ser negativa.' }
    }
    const weightsKg = input.packGrossKg.map(roundKg)
    const count = weightsKg.length
    const grossKg = roundKg(weightsKg.reduce((s, w) => s + w, 0))
    const tareTotal = roundKg(count * input.packTareKg)
    const netKg = roundKg(Math.max(0, grossKg - tareTotal))
    const unitCount = count * input.packContents
    return {
      ok: true,
      facts: {
        count,
        packContents: input.packContents,
        packTareKg: roundKg(input.packTareKg),
        hasIce: input.hasIce === true,
        grossKg,
        netKg,
        unitCount,
        kgPerUnit: unitCount > 0 ? roundKg(netKg / unitCount) : null,
        weightsKg,
      },
    }
  }

  if (input.template === 'weight') {
    if (!Number.isFinite(input.kg) || input.kg <= 0 || input.kg > MERCH_INTAKE_QUANTITY_MAX) {
      return { ok: false, error: 'Indicá los kilos (mayor a 0).' }
    }
    const kg = roundKg(input.kg)
    return {
      ok: true,
      facts: {
        count: 1,
        packContents: null,
        packTareKg: null,
        hasIce: false,
        grossKg: kg,
        netKg: kg,
        unitCount: null,
        kgPerUnit: null,
        weightsKg: [kg],
      },
    }
  }

  if (!Number.isInteger(input.count) || input.count <= 0 || input.count > MERCH_INTAKE_QUANTITY_MAX) {
    return { ok: false, error: 'Indicá la cantidad (entero mayor a 0).' }
  }
  return {
    ok: true,
    facts: {
      count: input.count,
      packContents: null,
      packTareKg: null,
      hasIce: false,
      grossKg: null,
      netKg: null,
      unitCount: input.count,
      kgPerUnit: null,
      weightsKg: [],
    },
  }
}

export function parseMerchWeightsJson(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
  } catch {
    return []
  }
}

export function merchIntakeExpenseConcept(rubroNames: string[]): string {
  const names = rubroNames.map(n => n.trim()).filter(Boolean)
  if (names.length === 0) return 'Mercadería'
  if (names.length === 1) return `Mercadería: ${names[0]}`
  const shown = names.slice(0, 3).join(', ')
  const extra = names.length > 3 ? '…' : ''
  return `Mercadería: ${shown}${extra}`
}

export function isMerchIntakeExpenseConcept(concept: string | null | undefined): boolean {
  return Boolean(concept && MERCH_INTAKE_EXPENSE_CONCEPT_RE.test(concept.trim()))
}

export function formatKg3(kg: number): string {
  return `${kg.toFixed(3)} kg`
}

export function formatMerchLineSummary(
  template: MerchIntakeTemplate,
  facts: Pick<MerchLineFacts, 'count' | 'netKg' | 'unitCount' | 'kgPerUnit' | 'packContents'>,
  packLabel?: string | null,
): string {
  const bulto = (packLabel && packLabel.trim()) || 'bulto'
  if (template === 'pieces_weight') {
    const kg = facts.netKg != null ? ` · ${formatKg3(facts.netKg)}` : ''
    return `${facts.count} pza${facts.count === 1 ? '' : 's'}${kg}`
  }
  if (template === 'packs') {
    const units = facts.unitCount != null ? ` · ${facts.unitCount} u` : ''
    const kg = facts.netKg != null ? ` · ${formatKg3(facts.netKg)} neto` : ''
    const avg = facts.kgPerUnit != null ? ` · ${formatKg3(facts.kgPerUnit)}/u` : ''
    return `${facts.count} ${bulto}${facts.count === 1 ? '' : 's'}${units}${kg}${avg}`
  }
  if (template === 'weight') {
    return facts.netKg != null ? formatKg3(facts.netKg) : '0 kg'
  }
  return `${facts.count} u`
}

export function summarizeMerchIntakeLines(
  lines: Array<{ netKg: number | null; unitCount: number | null }>,
): { lineCount: number; totalNetKg: number | null; totalUnitCount: number | null } {
  const lineCount = lines.length
  const kgParts = lines.map(l => l.netKg).filter((n): n is number => n != null)
  const unitParts = lines.map(l => l.unitCount).filter((n): n is number => n != null)
  return {
    lineCount,
    totalNetKg: kgParts.length === 0 ? null : roundKg(kgParts.reduce((s, n) => s + n, 0)),
    totalUnitCount: unitParts.length === 0 ? null : unitParts.reduce((s, n) => s + n, 0),
  }
}

export function merchNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function matchFactoryRubroByName(name: string): FactoryMerchRubro | null {
  const key = merchNameKey(name)
  if (!key) return null
  return FACTORY_MERCH_RUBROS.find(r => merchNameKey(r.name) === key) ?? null
}

export interface MerchLineDraftInput {
  rubroId: string
  weightsKg?: number[]
  kg?: number
  count?: number
  packContents?: number | null
  packTareKg?: number | null
  hasIce?: boolean
}

export interface MerchIntakeLineSnapshot {
  id: string
  rubroId: string
  rubroName: string
  template: MerchIntakeTemplate
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
  weightsKg: number[]
  productId: string | null
  nameKey: string
  costUnit: 'kg' | 'unit' | 'pack' | null
  unitCost: number
  costTotal: number
  packCount: number | null
}

export function resolveMerchLineFacts(
  template: MerchIntakeTemplate,
  draft: MerchLineDraftInput,
  defaults: { packContents: number | null; packTareKg: number | null },
): MerchLineComputeResult {
  if (template === 'pieces_weight') {
    return computeMerchLineFacts({ template, weightsKg: draft.weightsKg ?? [] })
  }
  if (template === 'packs') {
    const packContents = draft.packContents ?? defaults.packContents
    const packTareKg = draft.packTareKg ?? defaults.packTareKg
    if (packContents == null) {
      return { ok: false, error: 'Indicá cuántas unidades van en cada bulto (o cargalo en el rubro).' }
    }
    if (packTareKg == null) {
      return { ok: false, error: 'Indicá la tara del bulto en kg (0 si no tiene). Podés guardarla en el rubro.' }
    }
    return computeMerchLineFacts({
      template: 'packs',
      packGrossKg: draft.weightsKg ?? [],
      packContents,
      packTareKg,
      hasIce: draft.hasIce === true,
    })
  }
  if (template === 'weight') {
    if (draft.kg == null) return { ok: false, error: 'Indicá los kilos (mayor a 0).' }
    return computeMerchLineFacts({ template: 'weight', kg: draft.kg })
  }
  if (draft.count == null) return { ok: false, error: 'Indicá la cantidad (entero mayor a 0).' }
  return computeMerchLineFacts({ template: 'count', count: draft.count })
}

export function serializeMerchWeightsJson(weightsKg: number[]): string {
  return JSON.stringify(weightsKg)
}

export function snapshotFromFacts(
  opts: {
    id: string
    rubroId: string
    rubroName: string
    template: MerchIntakeTemplate
    sortOrder: number
    packLabel: string | null
  },
  facts: MerchLineFacts,
): MerchIntakeLineSnapshot {
  return {
    ...opts,
    count: facts.count,
    packContents: facts.packContents,
    packTareKg: facts.packTareKg,
    hasIce: facts.hasIce,
    grossKg: facts.grossKg,
    netKg: facts.netKg,
    unitCount: facts.unitCount,
    kgPerUnit: facts.kgPerUnit,
    weightsKg: facts.weightsKg,
    productId: null,
    nameKey: merchNameKey(opts.rubroName),
    costUnit: null,
    unitCost: 0,
    costTotal: 0,
    packCount: null,
  }
}

export function synthesizeLegacyMerchLine(opts: {
  intakeId: string
  category: string
  unit: MerchIntakeUnit
  quantity: number
}): MerchIntakeLineSnapshot {
  const name = opts.category.trim() || 'Mercadería'
  const factory = matchFactoryRubroByName(name)
  const template: MerchIntakeTemplate = opts.unit === 'kg' ? 'weight' : 'count'
  const computed = opts.unit === 'kg'
    ? computeMerchLineFacts({ template: 'weight', kg: opts.quantity })
    : computeMerchLineFacts({
      template: 'count',
      count: Number.isInteger(opts.quantity) ? opts.quantity : Math.round(opts.quantity),
    })
  const facts: MerchLineFacts = computed.ok
    ? computed.facts
    : {
      count: 1,
      packContents: null,
      packTareKg: null,
      hasIce: false,
      grossKg: null,
      netKg: null,
      unitCount: null,
      kgPerUnit: null,
      weightsKg: [],
    }
  return snapshotFromFacts({
    id: `${opts.intakeId}-l1`,
    rubroId: factory?.id ?? `legacy_${opts.intakeId}`,
    rubroName: name,
    template,
    sortOrder: 0,
    packLabel: factory?.packLabel ?? null,
  }, facts)
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function parseMerchLineSnapshot(raw: unknown, index: number, intakeId: string): MerchIntakeLineSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const template = coerceMerchIntakeTemplate(data['template'])
  if (!template) return null
  const rubroId = typeof data['rubroId'] === 'string' ? data['rubroId'].trim() : ''
  const rubroName = typeof data['rubroName'] === 'string' ? data['rubroName'].trim() : ''
  if (!rubroId || !rubroName) return null
  const count = asFiniteNumber(data['count'])
  if (count == null || count <= 0) return null
  const packContents = asFiniteNumber(data['packContents'])
  const packTareKg = asFiniteNumber(data['packTareKg'])
  const grossKg = asFiniteNumber(data['grossKg'])
  const netKg = asFiniteNumber(data['netKg'])
  const unitCount = asFiniteNumber(data['unitCount'])
  const kgPerUnit = asFiniteNumber(data['kgPerUnit'])
  const sortOrder = asFiniteNumber(data['sortOrder'])
  const id = typeof data['id'] === 'string' && data['id'].trim()
    ? data['id'].trim()
    : `${intakeId}-l${index + 1}`
  const packLabel = typeof data['packLabel'] === 'string' ? data['packLabel'] : null
  const weightsKg = Array.isArray(data['weightsKg'])
    ? data['weightsKg'].filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    : parseMerchWeightsJson(typeof data['weightsJson'] === 'string' ? data['weightsJson'] : null)
  return {
    id,
    rubroId,
    rubroName: rubroName.slice(0, MERCH_INTAKE_NAME_MAX),
    template,
    sortOrder: sortOrder != null ? Math.round(sortOrder) : index,
    packLabel,
    count: Math.round(count),
    packContents: packContents != null ? Math.round(packContents) : null,
    packTareKg,
    hasIce: data['hasIce'] === true,
    grossKg,
    netKg,
    unitCount: unitCount != null ? Math.round(unitCount) : null,
    kgPerUnit,
    weightsKg,
    productId: typeof data['productId'] === 'string' && data['productId'].trim() ? data['productId'].trim() : null,
    nameKey: typeof data['nameKey'] === 'string' && data['nameKey'].trim()
      ? data['nameKey'].trim()
      : merchNameKey(rubroName),
    costUnit: data['costUnit'] === 'kg' || data['costUnit'] === 'unit' || data['costUnit'] === 'pack'
      ? data['costUnit']
      : null,
    unitCost: Math.max(0, Math.round(asFiniteNumber(data['unitCost']) ?? 0)),
    costTotal: Math.max(0, Math.round(asFiniteNumber(data['costTotal']) ?? 0)),
    packCount: (() => {
      const n = asFiniteNumber(data['packCount'])
      return n != null && n > 0 ? Math.round(n) : null
    })(),
  }
}

export function parseMerchLinesFromUnknown(
  rawLines: unknown,
  fallback: { intakeId: string; category?: unknown; unit?: unknown; quantity?: unknown },
): MerchIntakeLineSnapshot[] {
  if (Array.isArray(rawLines) && rawLines.length > 0) {
    const parsed = rawLines
      .map((row, i) => parseMerchLineSnapshot(row, i, fallback.intakeId))
      .filter((row): row is MerchIntakeLineSnapshot => row != null)
      .slice(0, MERCH_INTAKE_MAX_LINES)
    if (parsed.length > 0) return parsed
  }
  const category = typeof fallback.category === 'string' ? fallback.category : ''
  const unit = coerceMerchIntakeUnit(fallback.unit)
  const quantity = asFiniteNumber(fallback.quantity)
  if (!category || !unit || quantity == null || quantity <= 0) return []
  return [synthesizeLegacyMerchLine({
    intakeId: fallback.intakeId,
    category,
    unit,
    quantity,
  })]
}

export function merchLineToFirestore(line: MerchIntakeLineSnapshot): Record<string, unknown> {
  return {
    id: line.id,
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
    weightsKg: line.weightsKg,
    productId: line.productId,
    nameKey: line.nameKey,
    costUnit: line.costUnit,
    unitCost: line.unitCost,
    costTotal: line.costTotal,
    packCount: line.packCount,
  }
}

export function formatMerchIntakeTitle(lines: MerchIntakeLineSnapshot[]): string {
  if (lines.length === 0) return 'Mercadería'
  return lines
    .map(line => `${line.rubroName} · ${formatMerchLineSummary(line.template, line, line.packLabel)}`)
    .join(' · ')
}
