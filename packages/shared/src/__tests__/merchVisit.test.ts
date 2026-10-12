import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAPLE_PACK_CONTENTS,
  coerceMerchVisitKind,
  coerceProviderIntakeKind,
  emptyChickenFormLine,
  emptyMerchVisitFormLine,
  formatMerchVisitQty,
  formatPurchaseUnitCostInput,
  lineCostTotal,
  merchFormLineToDraft,
  merchProductKey,
  merchVisitReceiptItems,
  merchVisitTotal,
  purchasePriceChanges,
  resolveMerchVisitLine,
} from '../merchVisit'

describe('merchVisit', () => {
  it('bondiola: kilos × último costo', () => {
    const r = resolveMerchVisitLine({
      productId: 'prod-bondiola',
      name: 'Bondiola',
      catalogUnit: 'kg',
      purchasePackLabel: null,
      purchasePackContents: null,
      kg: 5,
      packCount: null,
      count: null,
      weightsKg: [],
      unitCost: 4800,
    }, { id: 'l1', sortOrder: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line.costTotal).toBe(24000)
    expect(r.line.netKg).toBe(5)
    expect(r.line.costUnit).toBe('kg')
    expect(r.line.productId).toBe('prod-bondiola')
  })

  it('maple: 3 cajones × 12 maples y precio por cajón', () => {
    const r = resolveMerchVisitLine({
      productId: 'prod-maple',
      name: 'Maple',
      catalogUnit: 'unit',
      purchasePackLabel: 'Cajón',
      purchasePackContents: DEFAULT_MAPLE_PACK_CONTENTS,
      kg: null,
      packCount: 3,
      count: null,
      weightsKg: [],
      unitCost: 9000,
    }, { id: 'l1', sortOrder: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line.packCount).toBe(3)
    expect(r.line.unitCount).toBe(36)
    expect(r.line.costTotal).toBe(27000)
    expect(r.line.costUnit).toBe('pack')
    expect(r.line.netKg).toBeNull()
  })

  it('media res: kilos de cada pieza, sin cobrar por kg', () => {
    const r = resolveMerchVisitLine({
      productId: null,
      name: 'Media res',
      catalogUnit: null,
      purchasePackLabel: null,
      purchasePackContents: null,
      kg: null,
      packCount: null,
      count: null,
      weightsKg: [100, 98],
      unitCost: 0,
    }, { id: 'l1', sortOrder: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line.count).toBe(2)
    expect(r.line.netKg).toBe(198)
    expect(r.line.costTotal).toBe(0)
    expect(r.line.rubroId).toBe('custom:media res')
  })

  it('pollo: kilos por cajón y precio por cajón, no por kg', () => {
    const r = resolveMerchVisitLine({
      productId: null,
      name: 'Pollo',
      catalogUnit: 'unit',
      purchasePackLabel: 'Cajón',
      purchasePackContents: null,
      kg: null,
      packCount: 2,
      count: null,
      weightsKg: [18.5, 19],
      unitCost: 9000,
      costUnit: 'pack',
    }, { id: 'l1', sortOrder: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line.packCount).toBe(2)
    expect(r.line.count).toBe(2)
    expect(r.line.netKg).toBe(37.5)
    expect(r.line.costUnit).toBe('pack')
    expect(r.line.costTotal).toBe(18_000)
  })

  it('primera vez no lista cambio de precio; si cambia, sí', () => {
    expect(purchasePriceChanges(
      [{ productKey: 'p:1', name: 'Bondiola', unitCost: 4800 }],
      {},
    )).toEqual([])
    expect(purchasePriceChanges(
      [{ productKey: 'p:1', name: 'Bondiola', unitCost: 5000 }],
      { 'p:1': 4800 },
    )).toEqual([{ productKey: 'p:1', name: 'Bondiola', previous: 4800, next: 5000 }])
    expect(purchasePriceChanges(
      [{ productKey: 'p:1', name: 'Bondiola', unitCost: 4800 }],
      { 'p:1': 4800 },
    )).toEqual([])
  })

  it('clave de producto de catálogo vs nombre libre', () => {
    expect(merchProductKey('abc', 'Bondiola')).toBe('p:abc')
    expect(merchProductKey(null, 'Media Res')).toBe('c:media res')
  })

  it('acepta insumos como tipo de proveedor, no como visita de mercadería', () => {
    expect(coerceProviderIntakeKind('insumos')).toBe('insumos')
    expect(coerceProviderIntakeKind('catalog')).toBe('catalog')
    expect(coerceMerchVisitKind('insumos')).toBeNull()
    expect(coerceMerchVisitKind('chicken')).toBe('chicken')
  })

  it('total de la tanda suma renglones', () => {
    expect(merchVisitTotal([{ costTotal: 24000 }, { costTotal: 27000 }])).toBe(51000)
  })

  it('5 kg × $4800,50 redondea la línea al peso y conserva el unitario', () => {
    const r = resolveMerchVisitLine({
      productId: 'prod-bondiola',
      name: 'Bondiola',
      catalogUnit: 'kg',
      purchasePackLabel: null,
      purchasePackContents: null,
      kg: 5,
      packCount: null,
      count: null,
      weightsKg: [],
      unitCost: 4800.5,
    }, { id: 'l1', sortOrder: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line.unitCost).toBe(4800.5)
    expect(r.line.costTotal).toBe(24003)
    expect(lineCostTotal('kg', 4800.5, 5)).toBe(24003)
  })

  it('3 cajones × $9000,40 redondea la línea al peso', () => {
    const r = resolveMerchVisitLine({
      productId: 'prod-maple',
      name: 'Maple',
      catalogUnit: 'unit',
      purchasePackLabel: 'Cajón',
      purchasePackContents: DEFAULT_MAPLE_PACK_CONTENTS,
      kg: null,
      packCount: 3,
      count: null,
      weightsKg: [],
      unitCost: 9000.4,
    }, { id: 'l1', sortOrder: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.line.unitCost).toBe(9000.4)
    expect(r.line.costTotal).toBe(27001)
    expect(lineCostTotal('pack', 9000.4, 3)).toBe(27001)
  })

  it('no pierde centavos del unitario ni reescala un entero', () => {
    const noisy = resolveMerchVisitLine({
      productId: 'prod-bondiola',
      name: 'Bondiola',
      catalogUnit: 'kg',
      purchasePackLabel: null,
      purchasePackContents: null,
      kg: 1,
      packCount: null,
      count: null,
      weightsKg: [],
      unitCost: 4800.505,
    }, { id: 'l1', sortOrder: 0 })
    expect(noisy.ok).toBe(true)
    if (!noisy.ok) return
    expect(noisy.line.unitCost).toBe(4800.51)

    const whole = resolveMerchVisitLine({
      productId: 'prod-maple',
      name: 'Maple',
      catalogUnit: 'unit',
      purchasePackLabel: 'Cajón',
      purchasePackContents: DEFAULT_MAPLE_PACK_CONTENTS,
      kg: null,
      packCount: 1,
      count: null,
      weightsKg: [],
      unitCost: 9000,
    }, { id: 'l2', sortOrder: 0 })
    expect(whole.ok).toBe(true)
    if (!whole.ok) return
    expect(whole.line.unitCost).toBe(9000)
    expect(whole.line.costTotal).toBe(9000)

    const draft = merchFormLineToDraft(emptyMerchVisitFormLine({
      name: 'Bondiola',
      catalogUnit: 'kg',
      kgRaw: '5',
      unitCostRaw: '4.800,50',
    }))
    expect(draft).toMatchObject({ unitCost: 4800.5 })
    expect(formatPurchaseUnitCostInput(4800.5)).toBe('4.800,50')
    expect(formatPurchaseUnitCostInput(9000)).toBe('9.000,00')
    expect(emptyChickenFormLine(9000.4).unitCostRaw).toBe('9.000,40')
  })

  it('cantidad del comprobante: pollo, maple, kg y media res', () => {
    const pollo = resolveMerchVisitLine({
      productId: null,
      name: 'Pollo',
      catalogUnit: 'unit',
      purchasePackLabel: 'Cajón',
      purchasePackContents: null,
      kg: null,
      packCount: 2,
      count: null,
      weightsKg: [18.5, 19],
      unitCost: 9000,
      costUnit: 'pack',
    }, { id: 'l1', sortOrder: 0 })
    expect(pollo.ok).toBe(true)
    if (!pollo.ok) return
    expect(formatMerchVisitQty(pollo.line)).toBe('2 cajones · 37.500 kg')

    const maple = resolveMerchVisitLine({
      productId: 'prod-maple',
      name: 'Maple',
      catalogUnit: 'unit',
      purchasePackLabel: 'Cajón',
      purchasePackContents: DEFAULT_MAPLE_PACK_CONTENTS,
      kg: null,
      packCount: 3,
      count: null,
      weightsKg: [],
      unitCost: 9000,
    }, { id: 'l1', sortOrder: 0 })
    expect(maple.ok).toBe(true)
    if (!maple.ok) return
    expect(formatMerchVisitQty(maple.line)).toBe('3 cajones')

    const bondiola = resolveMerchVisitLine({
      productId: 'prod-bondiola',
      name: 'Bondiola',
      catalogUnit: 'kg',
      purchasePackLabel: null,
      purchasePackContents: null,
      kg: 5,
      packCount: null,
      count: null,
      weightsKg: [],
      unitCost: 4800,
    }, { id: 'l1', sortOrder: 0 })
    expect(bondiola.ok).toBe(true)
    if (!bondiola.ok) return
    expect(formatMerchVisitQty(bondiola.line)).toBe('5.000 kg')

    const media = resolveMerchVisitLine({
      productId: null,
      name: 'Media res',
      catalogUnit: null,
      purchasePackLabel: null,
      purchasePackContents: null,
      kg: null,
      packCount: null,
      count: null,
      weightsKg: [100, 98],
      unitCost: 0,
    }, { id: 'l1', sortOrder: 0 })
    expect(media.ok).toBe(true)
    if (!media.ok) return
    expect(formatMerchVisitQty(media.line)).toBe('2 u · 198.000 kg')

    expect(merchVisitReceiptItems([{
      productId: null,
      name: 'Pollo',
      catalogUnit: 'unit',
      purchasePackLabel: 'Cajón',
      purchasePackContents: null,
      kg: null,
      packCount: 2,
      count: null,
      weightsKg: [18.5, 19],
      unitCost: 9000,
      costUnit: 'pack',
    }])).toEqual([{ name: 'Pollo', qty: '2 cajones · 37.500 kg' }])
  })
})
