import { describe, expect, it } from 'vitest'
import { mediaResAverageKg, mediaResVisits, MEDIA_RES_RUBRO_ID } from '../mediaResSummary'
import { summaryMonthSpan } from '../weekRange'
import { civilYmd } from '../pickupHours'
import {
  boxAporteAmount,
  summaryMoneyView,
  summaryNewDebt,
  summaryShownAmounts,
  summarySoldByDay,
  type SummaryShiftCard,
} from '../summaryMoney'
import {
  collectionNote,
  combineFiadoSlices,
  storeFiadoSlice,
  sumCollections,
  paymentsInCivilRange,
  type LedgerEvent,
} from '../summaryFiado'
import { summaryBoxTally, shiftCloseBoxText } from '../shiftCloseBox'
import { summaryPreview, summaryPreviewSelection } from '../summaryPreview'

function card(partial: Partial<SummaryShiftCard> & Pick<SummaryShiftCard, 'id' | 'startedAt'>): SummaryShiftCard {
  return {
    cashierName: 'Ana',
    shiftType: 'morning',
    closedAt: partial.startedAt,
    openingCash: 0,
    cashLeft: null,
    withdrawn: null,
    soldTotal: null,
    cashTotal: null,
    cardWalletTotal: null,
    debtTotal: null,
    expenseTotal: null,
    contributionTotal: null,
    walletCashTotal: null,
    moneySnapshottedAt: null,
    live: false,
    ...partial,
  }
}

function withMoney(
  id: string,
  startedAt: string,
  sold: number,
  debt = 0,
): SummaryShiftCard {
  return card({
    id,
    startedAt,
    soldTotal: sold,
    cashTotal: sold,
    cardWalletTotal: 0,
    debtTotal: debt,
    expenseTotal: 0,
    contributionTotal: 0,
    walletCashTotal: 0,
    moneySnapshottedAt: startedAt,
  })
}

describe('ventas por día', () => {
  it('octubre 2026 va del 5/10 al 1/11 y un día sin ficha no es cero', () => {
    const october = summaryMonthSpan(2026, 10)
    expect(october.startYmd).toBe('2026-10-05')
    expect(october.endInclusiveYmd).toBe('2026-11-01')
    const bars = summarySoldByDay(
      [
        withMoney('lun', '2026-10-05T15:00:00.000Z', 1000),
        withMoney('cero', '2026-10-06T15:00:00.000Z', 0),
        card({ id: 'sin', startedAt: '2026-10-07T15:00:00.000Z', closedAt: '2026-10-07T20:00:00.000Z' }),
      ],
      october.startYmd,
      october.endInclusiveYmd,
    )
    expect(bars).toHaveLength(28)
    expect(bars[0]).toMatchObject({ ymd: '2026-10-05', amount: 1000 })
    expect(bars[1]).toMatchObject({ ymd: '2026-10-06', amount: 0 })
    expect(bars[2]?.amount).toBeNull()
    expect(bars.at(-1)).toMatchObject({ ymd: '2026-11-01', amount: null })
  })

  it('la semana tiene 7 barras y dos fichas del mismo día se suman', () => {
    const bars = summarySoldByDay(
      [
        withMoney('a', '2026-10-26T15:00:00.000Z', 100),
        withMoney('b', '2026-10-26T21:00:00.000Z', 40),
        card({ id: 'c', startedAt: '2026-10-26T18:00:00.000Z' }),
      ],
      '2026-10-26',
      '2026-11-01',
    )
    expect(bars).toHaveLength(7)
    expect(bars.map(bar => bar.label)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'])
    expect(bars[0]?.amount).toBe(140)
    expect(bars.slice(1).every(bar => bar.amount === null)).toBe(true)
  })
})

describe('fiado nuevo y aportes', () => {
  it('un turno sin ficha no suma cero y sin ninguna ficha no hay número', () => {
    expect(summaryNewDebt([])).toBeNull()
    expect(summaryNewDebt([card({ id: 'a', startedAt: '2026-10-26T15:00:00.000Z' })])).toBeNull()
    expect(summaryNewDebt([
      withMoney('a', '2026-10-26T15:00:00.000Z', 100, 40),
      card({ id: 'b', startedAt: '2026-10-27T15:00:00.000Z' }),
    ])).toBe(40)
  })

  it('aportes no sale en las estadísticas y sí en una diferencia', () => {
    const view = summaryMoneyView([
      card({
        id: 'dif',
        startedAt: '2026-10-26T15:00:00.000Z',
        closedAt: '2026-10-26T20:00:00.000Z',
        openingCash: 0,
        cashLeft: 100_000,
        withdrawn: 0,
        soldTotal: 180_000,
        cashTotal: 100_000,
        cardWalletTotal: 80_000,
        debtTotal: 0,
        expenseTotal: 0,
        contributionTotal: 25_000,
        walletCashTotal: 0,
        moneySnapshottedAt: '2026-10-26T20:00:00.000Z',
      }),
    ])
    const shown = summaryShownAmounts(view)
    expect(Object.keys(shown)).toEqual(['vendio', 'efectivo', 'tarjeta', 'gastos', 'digital'])
    expect(JSON.stringify(shown)).not.toMatch(/Aportes/)
    expect(shown.digital).toBe(0)
    const row = view.boxes[0]
    expect(row).toBeTruthy()
    if (!row) return
    expect(row.box.kind).toBe('difference')
    expect(boxAporteAmount(row)).toBe(25_000)
    expect(shiftCloseBoxText(row.box, amount => String(amount))).not.toBe('cerró bien')
  })

  it('sin ficha no es cerró bien aunque haya quedó y se retiró', () => {
    const view = summaryMoneyView([
      card({
        id: 'pend',
        startedAt: '2026-10-28T15:00:00.000Z',
        closedAt: '2026-10-28T20:00:00.000Z',
        cashLeft: 4_000,
        withdrawn: 1_000,
      }),
    ])
    expect(view.boxes[0]?.box.kind).toBe('pending')
    expect(summaryBoxTally(view.boxes.map(row => row.box))).toEqual([
      { kind: 'pending', label: 'todavía no llegó', count: 1 },
    ])
  })
})

describe('cobros del período', () => {
  const events: LedgerEvent[] = [
    {
      customerId: 'c1',
      storeId: 'norte',
      eventType: 'created',
      amount: 20_000,
      createdAt: '2026-10-01T15:00:00.000Z',
      shiftId: 'viejo',
    },
    {
      customerId: 'c1',
      storeId: 'norte',
      eventType: 'paid',
      amount: -5_000,
      createdAt: '2026-10-26T15:00:00.000Z',
      shiftId: 'turno',
    },
    {
      customerId: 'c1',
      storeId: 'norte',
      eventType: 'partial_payment',
      amount: -3_000,
      createdAt: '2026-10-27T15:00:00.000Z',
      shiftId: null,
    },
    {
      customerId: 'c2',
      storeId: 'norte',
      eventType: 'created',
      amount: 8_000,
      createdAt: '2026-10-20T15:00:00.000Z',
      shiftId: 'otro',
    },
    {
      customerId: 'c2',
      storeId: 'sur',
      eventType: 'cancelled',
      amount: -8_000,
      createdAt: '2026-10-21T15:00:00.000Z',
      shiftId: null,
    },
  ]

  it('el cobro sin turno entra en cobranzas y no en la frase de efectivo o tarjeta', () => {
    const slice = storeFiadoSlice(
      'norte',
      events,
      '2026-10-26T03:00:00.000Z',
      '2026-11-02T03:00:00.000Z',
    )
    expect(slice.payments).not.toBeNull()
    const collections = sumCollections(slice.payments ?? [])
    expect(collections.total).toBe(8_000)
    expect(collections.unshifted).toBe(3_000)
    const note = collectionNote(collections.unshifted)
    expect(note).toBe('Hay cobros sin turno. No entran en efectivo ni en tarjeta.')
    expect(note ?? '').not.toMatch(/ya están|efectivo o tarjeta|todos/i)
    expect(slice.debtNow).toBe(12_000)
    expect(collectionNote(0)).toBeNull()
  })

  it('sin eventos el saldo es pendiente y todos suma local por local', () => {
    const empty = storeFiadoSlice('sur', events.filter(event => event.storeId === 'norte' && event.customerId === 'c1'), 'a', 'b')
    expect(empty).toEqual({ debtNow: null, payments: null })
    const norte = storeFiadoSlice('norte', events, '2026-10-26T03:00:00.000Z', '2026-11-02T03:00:00.000Z')
    const sur = storeFiadoSlice('sur', [
      ...events,
      {
        customerId: 'c3',
        storeId: 'sur',
        eventType: 'created',
        amount: 4_000,
        createdAt: '2026-09-01T15:00:00.000Z',
        shiftId: null,
      },
    ], '2026-10-26T03:00:00.000Z', '2026-11-02T03:00:00.000Z')
    expect(combineFiadoSlices([norte, sur]).debtNow).toBe(12_000 + 4_000)
    expect(combineFiadoSlices([
      { debtNow: null, payments: null },
      { debtNow: null, payments: null },
    ])).toEqual({ debtNow: null, payments: null })
  })
})

describe('promedio de medias', () => {
  it('no hay promedio si las piezas no tienen kilo', () => {
    const visits = mediaResVisits([{
      id: 'v',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Frigorífico',
      receivedByName: 'Ana',
      lines: [{ rubroId: MEDIA_RES_RUBRO_ID, count: 3, netKg: 90, weightsKg: [] }],
    }])
    expect(visits[0]?.count).toBe(3)
    expect(visits[0]?.pieces).toEqual([])
    expect(mediaResAverageKg(visits)).toBeNull()
  })

  it('promedio es kilos sobre piezas con kilo', () => {
    const visits = mediaResVisits([{
      id: 'v',
      createdAt: '2026-10-26T15:00:00.000Z',
      providerName: 'Frigorífico',
      receivedByName: 'Ana',
      lines: [{ rubroId: MEDIA_RES_RUBRO_ID, count: 2, netKg: 180, weightsKg: [90, 88] }],
    }])
    expect(mediaResAverageKg(visits)).toBe(89)
  })
})

describe('datos de prueba', () => {
  it('el mes de octubre no coincide con hoy ni con la semana, y hay gastos', () => {
    const now = new Date('2026-10-29T15:00:00.000-03:00')
    const preview = summaryPreview(now)
    const selected = summaryPreviewSelection(preview, 'all')
    const slice = (start: string, end: string) => selected.shifts.filter(shift => {
      const ymd = civilYmd(new Date(shift.startedAt))
      return ymd >= start && ymd <= end
    })
    const today = summaryMoneyView(slice('2026-10-29', '2026-10-29'))
    const week = summaryMoneyView(slice('2026-10-26', '2026-11-01'))
    const month = summaryMoneyView(slice('2026-10-05', '2026-11-01'))
    const vendio = (view: ReturnType<typeof summaryMoneyView>) => summaryShownAmounts(view).vendio ?? 0
    const gastos = (view: ReturnType<typeof summaryMoneyView>) => summaryShownAmounts(view).gastos ?? 0
    expect(vendio(today)).toBeGreaterThan(0)
    expect(vendio(week)).toBeGreaterThan(vendio(today))
    expect(vendio(month)).toBeGreaterThan(vendio(week))
    expect(gastos(today)).toBeGreaterThan(0)
    expect(gastos(week)).toBeGreaterThan(gastos(today))
    expect(gastos(month)).toBeGreaterThan(gastos(week))
    const visitsIn = (start: string, end: string) => selected.visits.filter(visit => visit.ymd >= start && visit.ymd <= end)
    expect(visitsIn('2026-10-29', '2026-10-29').length).toBeGreaterThan(0)
    expect(visitsIn('2026-10-05', '2026-11-01').length).toBeGreaterThan(visitsIn('2026-10-26', '2026-11-01').length)
    const weekPay = sumCollections(paymentsInCivilRange(selected.fiado.payments ?? [], '2026-10-26', '2026-11-01'))
    const monthPay = sumCollections(paymentsInCivilRange(selected.fiado.payments ?? [], '2026-10-05', '2026-11-01'))
    expect(weekPay.unshifted).toBeGreaterThan(0)
    expect(monthPay.total).toBeGreaterThan(weekPay.total)
    expect(selected.fiado.debtNow).toBe(120_000)
    const days = summarySoldByDay(slice('2026-10-26', '2026-11-01'), '2026-10-26', '2026-11-01')
    expect(days.some(day => day.amount == null)).toBe(true)
  })
})
