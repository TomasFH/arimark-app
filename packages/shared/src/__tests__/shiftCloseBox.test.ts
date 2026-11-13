import { describe, expect, it } from 'vitest'
import {
  amountPatch,
  shiftCloseBox,
  shiftCloseBoxText,
} from '../shiftCloseBox'
import { expectedRegisterCash, shiftMoneyAction, summaryMoneyView, tallyShiftMoney, type SummaryShiftCard } from '../summaryMoney'
import { saleSplitSlices } from '../summaryMoney'

const format = (amount: number) => `$${amount}`

describe('shiftCloseBox', () => {
  it('vacío es sin anotar', () => {
    const box = shiftCloseBox({ cashLeft: null, withdrawn: null, expectedCash: 10000 })
    expect(box).toEqual({ kind: 'unnoted' })
    expect(shiftCloseBoxText(box, format)).toBe('sin anotar')
    expect(shiftCloseBox({ cashLeft: undefined, withdrawn: undefined, expectedCash: 0 }).kind).toBe('unnoted')
  })

  it('solo quedó muestra el número y no inventa diferencia, incluso si es 0', () => {
    const written = shiftCloseBox({ cashLeft: 4000, withdrawn: null, expectedCash: 10000 })
    expect(written).toEqual({ kind: 'left_only', cashLeft: 4000 })
    expect(shiftCloseBoxText(written, format)).toBe('$4000 · retiro sin anotar')
    const zero = shiftCloseBox({ cashLeft: 0, withdrawn: undefined, expectedCash: 500 })
    expect(zero).toEqual({ kind: 'left_only', cashLeft: 0 })
    expect(shiftCloseBox({ cashLeft: null, withdrawn: 800, expectedCash: 800 }).kind).toBe('unnoted')
  })

  it('los dos montos cuadran', () => {
    const box = shiftCloseBox({ cashLeft: 4000, withdrawn: 6000, expectedCash: 10000 })
    expect(box).toEqual({ kind: 'matched' })
    expect(shiftCloseBoxText(box, format)).toBe('cerró bien')
  })

  it('los dos montos no cuadran y la diferencia es esperado menos quedó y retirado', () => {
    const box = shiftCloseBox({ cashLeft: 4000, withdrawn: 5000, expectedCash: 10000 })
    expect(box).toEqual({ kind: 'difference', difference: 1000 })
    expect(shiftCloseBoxText(box, format)).toBe('$1000')
  })

  it('cero escrito en los dos, contra cero esperado, cerró bien', () => {
    expect(shiftCloseBox({ cashLeft: 0, withdrawn: 0, expectedCash: 0 })).toEqual({ kind: 'matched' })
  })

  it('sin plata del turno no dice que cerró bien', () => {
    expect(shiftCloseBox({ cashLeft: 100, withdrawn: 200, expectedCash: null }).kind).toBe('pending')
    expect(shiftCloseBox({ cashLeft: null, withdrawn: null, expectedCash: null }).kind).toBe('pending')
    expect(shiftCloseBoxText(shiftCloseBox({ cashLeft: null, withdrawn: null, expectedCash: null }), format)).toBe('todavía no llegó')
  })

  it('el campo vacío no entra al payload y el cero sí', () => {
    expect(amountPatch(null, null)).toEqual({})
    expect(amountPatch(0, null)).toEqual({ cashLeft: 0 })
    expect(amountPatch(null, 0)).toEqual({ withdrawn: 0 })
    expect(amountPatch(1500, 400)).toEqual({ cashLeft: 1500, withdrawn: 400 })
  })
})

describe('expectedRegisterCash', () => {
  it('suma apertura, efectivo, aportes y digital, y resta gastos', () => {
    expect(expectedRegisterCash({
      openingCash: 1000,
      cashTotal: 15000,
      contributionTotal: 500,
      walletCashTotal: 200,
      expenseTotal: 700,
    })).toBe(16000)
  })
})

describe('tallyShiftMoney', () => {
  it('separa venta, fiado, aporte y efectivo por digital', () => {
    const money = tallyShiftMoney({
      sales: [
        { status: 'confirmed', total: 10000, payments: [{ method: 'cash', amount: 4000 }, { method: 'debit', amount: 3000 }] },
        { status: 'cancelled', total: 999, payments: [{ method: 'cash', amount: 999 }] },
      ],
      cashDeposits: 100,
      cardDeposits: 50,
      debtEvents: [
        { eventType: 'created', amount: 3000, paymentMethod: null },
        { eventType: 'partial_payment', amount: -200, paymentMethod: 'cash' },
        { eventType: 'partial_payment', amount: -80, paymentMethod: 'wallet' },
      ],
      movements: [
        { kind: 'expense', amount: 500, injectReason: null, concept: 'Hielo' },
        { kind: 'inject', amount: 700, injectReason: 'aporte', concept: 'Aporte' },
        { kind: 'inject', amount: 40, injectReason: 'wallet_cash', concept: 'Efectivo por digital' },
      ],
    })
    expect(money.soldTotal).toBe(10000)
    expect(money.debtTotal).toBe(3000)
    expect(money.cashTotal).toBe(4300)
    expect(money.cardWalletTotal).toBe(3130)
    expect(money.expenseTotal).toBe(500)
    expect(money.contributionTotal).toBe(700)
    expect(money.walletCashTotal).toBe(40)
  })
})

function card(partial: Partial<SummaryShiftCard> & Pick<SummaryShiftCard, 'id'>): SummaryShiftCard {
  return {
    cashierName: 'Ana',
    shiftType: 'evening',
    startedAt: '2026-10-26T12:00:00.000Z',
    closedAt: '2026-10-26T20:00:00.000Z',
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

describe('shiftMoneyAction', () => {
  it('una ficha ya escrita no se vuelve a calcular, aunque esta máquina tenga las ventas', () => {
    expect(shiftMoneyAction({
      closedAt: '2026-10-01T21:00:00.000Z',
      startedAt: '2026-10-01T12:00:00.000Z',
      moneySnapshottedAt: '2026-10-01T21:00:00.000Z',
      hasLocalLedger: true,
      todayYmd: '2026-10-28',
    })).toBe('keep')
  })

  it('ayer cerrado y sin ficha se calcula una vez', () => {
    expect(shiftMoneyAction({
      closedAt: '2026-10-27T21:00:00.000Z',
      startedAt: '2026-10-27T12:00:00.000Z',
      moneySnapshottedAt: null,
      hasLocalLedger: false,
      todayYmd: '2026-10-28',
    })).toBe('backfill')
  })

  it('hoy cerrado sin ficha y sin ventas en esta máquina no se inventa', () => {
    expect(shiftMoneyAction({
      closedAt: '2026-10-28T21:00:00.000Z',
      startedAt: '2026-10-28T12:00:00.000Z',
      moneySnapshottedAt: null,
      hasLocalLedger: false,
      todayYmd: '2026-10-28',
    })).toBe('pending')
  })
})

describe('summaryMoneyView', () => {
  it('sin turnos los montos son cero, no «todavía no llegó»', () => {
    const view = summaryMoneyView([])
    expect(view.lines.map(line => line.label)).toEqual([
      'Vendió',
      'Entró en efectivo',
      'Tarjeta y billetera',
      'Gastos',
    ])
    expect(view.lines.every(line => line.amount === 0)).toBe(true)
    expect(view.separate.map(line => line.label)).toEqual(['Aportes', 'Efectivo por digital'])
    expect(view.pendingCount).toBe(0)
  })

  it('si la ficha no llegó no suma cero', () => {
    const view = summaryMoneyView([card({ id: 'a' })])
    expect(view.lines.every(line => line.amount === null)).toBe(true)
    expect(view.pendingCount).toBe(1)
    expect(view.boxes[0]?.box.kind).toBe('pending')
  })

  it('tres turnos de la misma persona son tres filas y un turno de hoy sin ficha no suma cero', () => {
    const money = (id: string, sold: number, startedAt: string, shiftType: 'morning' | 'evening') => card({
      id,
      cashierName: 'Admin Prueba',
      shiftType,
      startedAt,
      closedAt: startedAt,
      soldTotal: sold,
      cashTotal: sold,
      cardWalletTotal: 0,
      debtTotal: 0,
      expenseTotal: 0,
      contributionTotal: 0,
      walletCashTotal: 0,
      moneySnapshottedAt: startedAt,
    })
    const view = summaryMoneyView([
      money('tarde-22', 2_141_692, '2026-10-22T21:00:00.000Z', 'evening'),
      money('manana-22', 2_803_899, '2026-10-22T11:00:00.000Z', 'morning'),
      money('tarde-21', 2_853_219, '2026-10-21T21:00:00.000Z', 'evening'),
      card({
        id: 'hoy',
        cashierName: 'Admin Prueba',
        startedAt: '2026-10-28T21:00:00.000Z',
        closedAt: '2026-10-28T23:00:00.000Z',
      }),
    ])
    expect(view.boxes.map(row => row.id)).toEqual(['hoy', 'tarde-22', 'manana-22', 'tarde-21'])
    expect(new Set(view.boxes.map(row => row.cashierName)).size).toBe(1)
    expect(view.lines[0]?.amount).toBe(2_141_692 + 2_803_899 + 2_853_219)
    expect(view.pendingCount).toBe(1)
    expect(view.boxes.find(row => row.id === 'hoy')?.box.kind).toBe('pending')
  })

  it('la torta parte efectivo y tarjeta', () => {
    const slices = saleSplitSlices(2000, 1000)
    expect(slices.map(slice => slice.label)).toEqual(['Entró en efectivo', 'Tarjeta y billetera'])
    expect(slices.map(slice => slice.amount)).toEqual([2000, 1000])
    expect(slices.reduce((sum, slice) => sum + slice.fraction, 0)).toBeCloseTo(1)
  })
})
