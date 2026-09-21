import { describe, expect, it } from 'vitest'
import {
  computeMerchLineFacts,
  coerceMerchIntakeTemplate,
  formatMerchLineSummary,
  isMerchIntakeExpenseConcept,
  merchIntakeExpenseConcept,
  parseMerchLinesFromUnknown,
  parseMerchWeightsJson,
  resolveMerchLineFacts,
  summarizeMerchIntakeLines,
  synthesizeLegacyMerchLine,
} from '../merchIntake'

describe('merchIntake', () => {
  it('coacciona plantilla', () => {
    expect(coerceMerchIntakeTemplate('packs')).toBe('packs')
    expect(coerceMerchIntakeTemplate('kg')).toBeNull()
  })

  it('media res: un kilo por pieza y totales para stats', () => {
    const r = computeMerchLineFacts({ template: 'pieces_weight', weightsKg: [90, 88.5, 91] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.facts.count).toBe(3)
    expect(r.facts.unitCount).toBe(3)
    expect(r.facts.netKg).toBe(269.5)
    expect(r.facts.kgPerUnit).toBeCloseTo(89.833, 3)
    expect(r.facts.weightsKg).toEqual([90, 88.5, 91])
  })

  it('pollo en cajones: tara, neto y kg por pollo', () => {
    const r = computeMerchLineFacts({
      template: 'packs',
      packGrossKg: [12, 12.5],
      packContents: 10,
      packTareKg: 1,
      hasIce: true,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.facts.count).toBe(2)
    expect(r.facts.unitCount).toBe(20)
    expect(r.facts.grossKg).toBe(24.5)
    expect(r.facts.netKg).toBe(22.5)
    expect(r.facts.hasIce).toBe(true)
    expect(r.facts.kgPerUnit).toBe(1.125)
  })

  it('corte de cerdo: solo kilos', () => {
    const r = computeMerchLineFacts({ template: 'weight', kg: 18.25 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.facts.netKg).toBe(18.25)
    expect(r.facts.unitCount).toBeNull()
  })

  it('unidades sin peso (limpieza)', () => {
    const r = computeMerchLineFacts({ template: 'count', count: 6 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.facts.count).toBe(6)
    expect(r.facts.netKg).toBeNull()
  })

  it('rechaza piezas sin peso', () => {
    const r = computeMerchLineFacts({ template: 'pieces_weight', weightsKg: [] })
    expect(r.ok).toBe(false)
  })

  it('concepto de gasto y resumen de entrega', () => {
    expect(merchIntakeExpenseConcept(['Media res'])).toBe('Mercadería: Media res')
    expect(merchIntakeExpenseConcept(['Bondiola', 'Morcilla'])).toBe('Mercadería: Bondiola, Morcilla')
    expect(isMerchIntakeExpenseConcept('Mercadería: Maple')).toBe(true)
    expect(isMerchIntakeExpenseConcept('Mercadería')).toBe(false)
    expect(formatMerchLineSummary('pieces_weight', {
      count: 5, netKg: 450, unitCount: 5, kgPerUnit: 90, packContents: null,
    })).toContain('5 pzas')
    const sum = summarizeMerchIntakeLines([
      { netKg: 10, unitCount: null },
      { netKg: 5, unitCount: 2 },
    ])
    expect(sum.lineCount).toBe(2)
    expect(sum.totalNetKg).toBe(15)
    expect(sum.totalUnitCount).toBe(2)
  })

  it('parsea weights json', () => {
    expect(parseMerchWeightsJson('[1,2.5]')).toEqual([1, 2.5])
    expect(parseMerchWeightsJson('nope')).toEqual([])
  })

  it('resuelve pollo con defaults del rubro', () => {
    const r = resolveMerchLineFacts(
      'packs',
      { rubroId: 'rubro_pollo_entero', weightsKg: [12], hasIce: true },
      { packContents: 10, packTareKg: 1 },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.facts.unitCount).toBe(10)
    expect(r.facts.netKg).toBe(11)
    expect(r.facts.hasIce).toBe(true)
  })

  it('exige tara si el rubro de bultos no la tiene', () => {
    const r = resolveMerchLineFacts(
      'packs',
      { rubroId: 'rubro_pollo_entero', weightsKg: [12], packContents: 10 },
      { packContents: null, packTareKg: null },
    )
    expect(r.ok).toBe(false)
  })

  it('sintetiza un renglón v1 para stats posteriores', () => {
    const line = synthesizeLegacyMerchLine({
      intakeId: 'abc',
      category: 'Media res',
      unit: 'u',
      quantity: 2,
    })
    expect(line.rubroId).toBe('rubro_media_res')
    expect(line.template).toBe('count')
    expect(line.unitCount).toBe(2)
    expect(line.netKg).toBeNull()
  })

  it('parsea lines[] o cae al documento viejo', () => {
    const fromLines = parseMerchLinesFromUnknown(
      [{ id: 'l1', rubroId: 'rubro_cerdo', rubroName: 'Cerdo', template: 'weight', count: 1, netKg: 8, weightsKg: [8] }],
      { intakeId: 'x' },
    )
    expect(fromLines).toHaveLength(1)
    expect(fromLines[0]?.netKg).toBe(8)
    const legacy = parseMerchLinesFromUnknown(undefined, {
      intakeId: 'y',
      category: 'Carbón',
      unit: 'u',
      quantity: 10,
    })
    expect(legacy[0]?.rubroId).toBe('rubro_carbon')
    expect(legacy[0]?.count).toBe(10)
  })
})
