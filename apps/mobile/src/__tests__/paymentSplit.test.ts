import { describe, it, expect } from 'vitest'
import { paidTotal, remainderForField, settleSalePayments } from '../lib/paymentSplit'
import { amountsToPayments, EMPTY_PAYMENT_AMOUNTS } from '../components/PaymentMethodFields'

describe('paymentSplit + amountsToPayments', () => {
  it('campos vacíos: pagado 0 y resto = total', () => {
    expect(paidTotal(EMPTY_PAYMENT_AMOUNTS)).toBe(0)
    expect(remainderForField(15000, EMPTY_PAYMENT_AMOUNTS, 'cash')).toBe(15000)
  })

  it('el resto ignora el campo actual (botón ← $resto)', () => {
    const amounts = { ...EMPTY_PAYMENT_AMOUNTS, cash: '1.000', debit: '4.000' }
    expect(remainderForField(10000, amounts, 'cash')).toBe(6000)
    expect(remainderForField(10000, amounts, 'wallet')).toBe(5000)
  })

  it('amountsToPayments omite ceros y vacíos', () => {
    expect(amountsToPayments(EMPTY_PAYMENT_AMOUNTS)).toEqual([])
    expect(amountsToPayments({ ...EMPTY_PAYMENT_AMOUNTS, cash: '0', debit: '2.500' })).toEqual([
      { paymentMethod: 'debit', amount: 2500 },
    ])
  })

  it('no deja resto negativo: si ya se cubrió, fill = 0', () => {
    const amounts = { ...EMPTY_PAYMENT_AMOUNTS, cash: '20.000' }
    expect(remainderForField(5000, amounts, 'debit')).toBe(0)
  })

  it('paidTotal parsea miles es-AR y el resto del propio campo ignora lo ya escrito ahí', () => {
    const amounts = { ...EMPTY_PAYMENT_AMOUNTS, cash: '1.250', debit: '750' }
    expect(paidTotal(amounts)).toBe(2000)
    expect(remainderForField(2000, amounts, 'cash')).toBe(1250)
    expect(remainderForField(2000, amounts, 'debit')).toBe(750)
  })

  it('total 0: resto 0 aunque los campos estén vacíos', () => {
    expect(remainderForField(0, EMPTY_PAYMENT_AMOUNTS, 'cash')).toBe(0)
  })
})

describe('settleSalePayments — vuelto de efectivo', () => {
  it('efectivo de más (2 de 20 mil sobre 37.500) registra el total y calcula vuelto', () => {
    const settled = settleSalePayments(37500, { ...EMPTY_PAYMENT_AMOUNTS, cash: '40.000' })
    expect(settled.canConfirm).toBe(true)
    expect(settled.change).toBe(2500)
    expect(settled.payments).toEqual([{ paymentMethod: 'cash', amount: 37500 }])
  })

  it('efectivo justo: sin vuelto, pago = total', () => {
    const settled = settleSalePayments(37500, { ...EMPTY_PAYMENT_AMOUNTS, cash: '37.500' })
    expect(settled.canConfirm).toBe(true)
    expect(settled.change).toBe(0)
    expect(settled.payments).toEqual([{ paymentMethod: 'cash', amount: 37500 }])
  })

  it('efectivo de menos no deja confirmar (salvo fiado)', () => {
    const cobro = settleSalePayments(37500, { ...EMPTY_PAYMENT_AMOUNTS, cash: '20.000' })
    expect(cobro.canConfirm).toBe(false)
    expect(cobro.remaining).toBe(17500)

    const fiado = settleSalePayments(37500, { ...EMPTY_PAYMENT_AMOUNTS, cash: '20.000' }, { allowPartial: true })
    expect(fiado.canConfirm).toBe(true)
    expect(fiado.payments).toEqual([{ paymentMethod: 'cash', amount: 20000 }])
    expect(fiado.remaining).toBe(17500)
  })

  it('mixto de más no es vuelto (igual que dividir en PC)', () => {
    const settled = settleSalePayments(37500, {
      ...EMPTY_PAYMENT_AMOUNTS,
      debit: '10.000',
      cash: '40.000',
    })
    expect(settled.canConfirm).toBe(false)
    expect(settled.mixedOverage).toBe(true)
    expect(settled.change).toBe(0)
  })

  it('vacío no confirma cobro; fiado sí (sin pago inicial)', () => {
    expect(settleSalePayments(1000, EMPTY_PAYMENT_AMOUNTS).canConfirm).toBe(false)
    expect(settleSalePayments(1000, EMPTY_PAYMENT_AMOUNTS, { allowPartial: true }).canConfirm).toBe(true)
    expect(settleSalePayments(1000, EMPTY_PAYMENT_AMOUNTS, { allowPartial: true }).payments).toEqual([])
  })
})
