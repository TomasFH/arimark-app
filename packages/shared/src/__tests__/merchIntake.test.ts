import { describe, expect, it } from 'vitest'
import {
  buildMerchWeekBook,
  redactMerchWeekBook,
  computeMerchLineFacts,
  coerceMerchIntakeTemplate,
  formatKg3,
  formatMerchLineSummary,
  isMerchIntakeExpenseConcept,
  merchIntakeExpenseConcept,
  merchPaidCaption,
  oldDebtByIntake,
  parseMerchLinesFromUnknown,
  parseMerchWeightsJson,
  resolveMerchLineFacts,
  snapshotFromFacts,
  summarizeMerchIntakeLines,
  synthesizeLegacyMerchLine,
  type MerchIntakeLineSnapshot,
  type MerchWeekIntakeInput,
} from '../merchIntake'

describe('merchIntake', () => {
  it('muestra los kilos como se leen en Argentina', () => {
    expect(formatKg3(103)).toBe('103 kg')
    expect(formatKg3(75)).toBe('75 kg')
    expect(formatKg3(0.234)).toBe('0,234 kg')
    expect(formatKg3(1.255)).toBe('1,255 kg')
    expect(formatKg3(1600.9)).toBe('1.600,9 kg')
  })

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

  it('al bajar una línea conserva centavos del unitario y no reescala', () => {
    const lines = parseMerchLinesFromUnknown(
      [{
        id: 'l1',
        rubroId: 'rubro_bondiola',
        rubroName: 'Bondiola',
        template: 'weight',
        count: 1,
        netKg: 5,
        unitCost: 4800.5,
        costTotal: 24002.5,
      }, {
        id: 'l2',
        rubroId: 'rubro_maple',
        rubroName: 'Maple',
        template: 'packs',
        count: 1,
        unitCost: 9000,
        costTotal: 9000,
      }],
      { intakeId: 'x' },
    )
    expect(lines[0]?.unitCost).toBe(4800.5)
    expect(lines[0]?.costTotal).toBe(24003)
    expect(lines[1]?.unitCost).toBe(9000)
  })
})

function weekLine(
  template: MerchIntakeLineSnapshot['template'],
  rubroId: string,
  rubroName: string,
  factsInput: Parameters<typeof computeMerchLineFacts>[0],
): MerchIntakeLineSnapshot {
  const computed = computeMerchLineFacts(factsInput)
  if (!computed.ok) throw new Error(computed.error)
  return snapshotFromFacts({
    id: `${rubroId}-${rubroName}`,
    rubroId,
    rubroName,
    template,
    sortOrder: 0,
    packLabel: template === 'packs' ? 'Cajón' : null,
  }, computed.facts)
}

function weekVisit(partial: Partial<MerchWeekIntakeInput> & Pick<MerchWeekIntakeInput, 'id' | 'lines'>): MerchWeekIntakeInput {
  return {
    providerId: partial.providerId ?? null,
    providerName: partial.providerName ?? 'Proveedor',
    createdAt: partial.createdAt ?? '2026-10-19T15:00:00.000Z',
    createdByName: partial.createdByName ?? 'Ana',
    storeId: partial.storeId ?? 'store-001',
    storeName: partial.storeName ?? 'Local 1',
    notes: partial.notes ?? null,
    paidAmount: partial.paidAmount ?? 0,
    debtAmount: partial.debtAmount ?? 0,
    cashOut: partial.cashOut ?? 0,
    oldDebtSettled: partial.oldDebtSettled ?? 0,
    id: partial.id,
    lines: partial.lines,
  }
}

describe('buildMerchWeekBook', () => {
  it('suma dos visitas del mismo rubro sin promediar el kilo', () => {
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'a',
        providerId: 'p1',
        providerName: 'Oso',
        createdAt: '2026-10-19T12:00:00.000Z',
        lines: [weekLine('pieces_weight', 'rubro_media_res', 'Media res', {
          template: 'pieces_weight',
          weightsKg: [90, 90],
        })],
      }),
      weekVisit({
        id: 'b',
        providerId: 'p1',
        providerName: 'Oso',
        createdAt: '2026-10-20T12:00:00.000Z',
        lines: [weekLine('pieces_weight', 'rubro_media_res', 'Media res', {
          template: 'pieces_weight',
          weightsKg: [80],
        })],
      }),
    ])
    expect(book.rubros).toHaveLength(1)
    expect(book.rubros[0]?.pieces).toBe(3)
    expect(book.rubros[0]?.netKg).toBe(260)
    expect(book.rubros[0]?.qtyLabel).toBe('3 u · 260 kg')
    expect(book.rubros[0]?.qtyLabel.includes('/u')).toBe(false)
    expect(book.providers).toHaveLength(1)
    expect(book.providers[0]?.deliveries.map(d => d.id)).toEqual(['a', 'b'])
  })

  it('no mezcla dos proveedores', () => {
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'oso',
        providerId: 'p-oso',
        providerName: 'Oso',
        paidAmount: 10_000,
        cashOut: 10_000,
        lines: [weekLine('weight', 'rubro_bondiola', 'Bondiola', { template: 'weight', kg: 4 })],
      }),
      weekVisit({
        id: 'guido',
        providerId: 'p-guido',
        providerName: 'Guido',
        paidAmount: 3_000,
        cashOut: 3_000,
        lines: [weekLine('weight', 'rubro_cerdo', 'Cerdo', { template: 'weight', kg: 2 })],
      }),
    ])
    expect(book.providers.map(p => p.providerName)).toEqual(['Guido', 'Oso'])
    expect(book.providers.find(p => p.providerName === 'Guido')?.paid).toBe(3_000)
    expect(book.providers.find(p => p.providerName === 'Oso')?.paid).toBe(10_000)
    expect(book.paid).toBe(13_000)
    expect(book.rubros.map(r => r.rubroName)).toEqual(['Bondiola', 'Cerdo'])
  })

  it('digital suma pagado y deja en 0 lo que salió de caja', () => {
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'd1',
        providerId: 'p1',
        providerName: 'Oso',
        paidAmount: 10_000,
        cashOut: 0,
        lines: [weekLine('weight', 'rubro_cerdo', 'Cerdo', { template: 'weight', kg: 2 })],
      }),
      weekVisit({
        id: 'd2',
        providerId: 'p1',
        providerName: 'Oso',
        paidAmount: 8_000,
        cashOut: 0,
        lines: [weekLine('weight', 'rubro_cerdo', 'Cerdo', { template: 'weight', kg: 1 })],
      }),
    ])
    expect(book.paid).toBe(18_000)
    expect(book.cashOut).toBe(0)
    expect(book.providers[0]?.paid).toBe(18_000)
    expect(book.providers[0]?.cashOut).toBe(0)
  })

  it('efectivo con deuda vieja hace que salió de caja sea mayor que paidAmount', () => {
    const paidAmount = 20_000
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'cash',
        providerId: 'p1',
        providerName: 'Oso',
        paidAmount,
        oldDebtSettled: 5_000,
        cashOut: 25_000,
        lines: [weekLine('weight', 'rubro_cerdo', 'Cerdo', { template: 'weight', kg: 6 })],
      }),
    ])
    expect(book.paid).toBe(25_000)
    expect(book.cashOut).toBe(25_000)
    expect(book.cashOut).toBeGreaterThan(paidAmount)
    expect(book.providers[0]?.cashOut).toBeGreaterThan(paidAmount)
    expect(book.providers[0]?.paid).toBe(25_000)
    expect(book.providers[0]?.deliveries[0]?.oldDebtSettled).toBe(5_000)
    expect(book.providers[0]?.deliveries[0]?.paid).toBe(25_000)
  })

  it('media res entra en las cantidades con plata en 0', () => {
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'media',
        providerId: 'p1',
        providerName: 'Frigorífico',
        paidAmount: 0,
        debtAmount: 0,
        cashOut: 0,
        oldDebtSettled: 0,
        lines: [weekLine('pieces_weight', 'rubro_media_res', 'Media res', {
          template: 'pieces_weight',
          weightsKg: [100, 98],
        })],
      }),
    ])
    expect(book.rubros[0]?.rubroName).toBe('Media res')
    expect(book.rubros[0]?.pieces).toBe(2)
    expect(book.rubros[0]?.netKg).toBe(198)
    expect(book.paid).toBe(0)
    expect(book.cashOut).toBe(0)
    expect(book.debt).toBe(0)
    expect(book.providers[0]?.paid).toBe(0)
    expect(book.providers[0]?.cashOut).toBe(0)
    expect(book.providers[0]?.debt).toBe(0)
  })

  it('semana sin entregas', () => {
    const book = buildMerchWeekBook([])
    expect(book.rubros).toEqual([])
    expect(book.providers).toEqual([])
    expect(book.paid).toBe(0)
    expect(book.cashOut).toBe(0)
    expect(book.debt).toBe(0)
  })

  it('oculta el costo informado y no toca el pagado ni la deuda', () => {
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'v',
        providerName: 'Oso',
        paidAmount: 5_000,
        debtAmount: 1_000,
        lines: [
          {
            ...weekLine('weight', 'rubro_bondiola', 'Bondiola', { template: 'weight', kg: 2 }),
            unitCost: 2500,
            costTotal: 5000,
            moneyRole: 'payable',
          },
          {
            ...weekLine('pieces_weight', 'rubro_media_res', 'Media res', {
              template: 'pieces_weight',
              weightsKg: [90],
            }),
            unitCost: 0,
            costTotal: 250_000,
            moneyRole: 'informed',
          },
        ],
      }),
    ])
    const redacted = redactMerchWeekBook(book, line => line.rubroId === 'rubro_media_res')
    const lines = redacted.providers[0]?.deliveries[0]?.lines ?? []
    expect(lines.find(line => line.rubroId === 'rubro_bondiola')).toMatchObject({
      unitCost: 2500,
      costTotal: 5000,
    })
    expect(lines.find(line => line.rubroId === 'rubro_media_res')).toMatchObject({
      unitCost: 0,
      costTotal: 0,
      moneyRole: 'none',
    })
    expect(redacted.providers[0]?.deliveries[0]?.paid).toBe(5_000)
    expect(redacted.debt).toBe(1_000)
    expect(redacted.paid).toBe(5_000)
  })

  it('si el precio oculto entraba al total, sale del pagado', () => {
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'v',
        providerName: 'Oso',
        paidAmount: 9_000,
        debtAmount: 0,
        lines: [
          {
            ...weekLine('pieces_weight', 'rubro_media_res', 'Media res', {
              template: 'pieces_weight',
              weightsKg: [90],
            }),
            costTotal: 4_000,
            moneyRole: 'payable',
          },
        ],
      }),
    ])
    const redacted = redactMerchWeekBook(book, line => line.rubroId === 'rubro_media_res')
    expect(redacted.providers[0]?.deliveries[0]?.paid).toBe(5_000)
    expect(redacted.paid).toBe(5_000)
  })

  it('ocultar un precio de esta visita no come el pago de deuda anterior', () => {
    const book = buildMerchWeekBook([
      weekVisit({
        id: 'v',
        providerName: 'Guido',
        paidAmount: 9_000,
        oldDebtSettled: 5_000,
        debtAmount: 0,
        cashOut: 14_000,
        lines: [
          {
            ...weekLine('pieces_weight', 'rubro_media_res', 'Media res', {
              template: 'pieces_weight',
              weightsKg: [90],
            }),
            costTotal: 4_000,
            moneyRole: 'payable',
          },
        ],
      }),
    ])
    const redacted = redactMerchWeekBook(book, line => line.rubroId === 'rubro_media_res')
    const delivery = redacted.providers[0]?.deliveries[0]
    expect(delivery?.oldDebtSettled).toBe(5_000)
    expect(delivery?.paid).toBe(10_000)
    expect(redacted.paid).toBe(10_000)
  })
})

describe('oldDebtByIntake', () => {
  const guidoVisit = {
    id: '91ef1877-2636-4db1-9180-962037dc4f13',
    expenseId: '22cf8a30-91e7-4bb3-b34f-20f7460a6175',
    providerId: '677569646f',
    providerName: 'Guido',
    shiftId: '88de0685-1686-4af2-9627-c7296a1b6cef',
  }

  it('el pago de Guido del 26/11 sin gasto local queda en esa visita', () => {
    const totals = oldDebtByIntake(
      [guidoVisit],
      [{
        amount: 836_307,
        expenseId: null,
        providerId: '677569646f',
        providerName: 'Guido',
        shiftId: guidoVisit.shiftId,
      }],
    )
    expect(totals.get(guidoVisit.id)).toBe(836_307)
  })

  it('usa el gasto cuando el pago lo trae', () => {
    const totals = oldDebtByIntake(
      [guidoVisit],
      [{
        amount: 836_307,
        expenseId: guidoVisit.expenseId,
        providerId: '677569646f',
        providerName: 'Guido',
        shiftId: null,
      }],
    )
    expect(totals.get(guidoVisit.id)).toBe(836_307)
  })

  it('no reparte un pago suelto entre dos visitas del mismo proveedor', () => {
    const totals = oldDebtByIntake(
      [guidoVisit, { ...guidoVisit, id: 'otra', expenseId: 'otro-gasto' }],
      [{
        amount: 836_307,
        expenseId: null,
        providerId: '677569646f',
        providerName: 'Guido',
        shiftId: guidoVisit.shiftId,
      }],
    )
    expect(totals.size).toBe(0)
  })

  it('no atribuye el pago de otro proveedor del mismo turno', () => {
    const totals = oldDebtByIntake(
      [guidoVisit],
      [{
        amount: 90_000,
        expenseId: null,
        providerId: 'provoletas',
        providerName: 'Provoletas',
        shiftId: guidoVisit.shiftId,
      }],
    )
    expect(totals.size).toBe(0)
  })
})

describe('merchPaidCaption', () => {
  it('todo el pago a deuda anterior', () => {
    expect(merchPaidCaption(836_307, 836_307)).toBe('all')
  })

  it('parte a esta visita y parte a deuda anterior', () => {
    expect(merchPaidCaption(25_000, 5_000)).toBe('part')
  })

  it('sin deuda anterior no hay aclaración', () => {
    expect(merchPaidCaption(90_000, 0)).toBe('none')
  })
})
