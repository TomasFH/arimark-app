import { describe, expect, it } from 'vitest'
import {
  coerceInjectReason,
  injectConceptForReason,
  injectHistoryLabel,
  INJECT_REASON_LABELS,
} from '../injectReason'

describe('injectReason', () => {
  it('coacciona wallet_cash y el resto a aporte', () => {
    expect(coerceInjectReason('wallet_cash')).toBe('wallet_cash')
    expect(coerceInjectReason('aporte')).toBe('aporte')
    expect(coerceInjectReason(null)).toBe('aporte')
    expect(coerceInjectReason('otro')).toBe('aporte')
  })

  it('arma el concept persistido', () => {
    expect(injectConceptForReason('aporte')).toBe(INJECT_REASON_LABELS.aporte)
    expect(injectConceptForReason('wallet_cash')).toBe(INJECT_REASON_LABELS.wallet_cash)
  })

  it('etiqueta historial por reason o concept legado', () => {
    expect(injectHistoryLabel('wallet_cash')).toBe('Efectivo por digital')
    expect(injectHistoryLabel('aporte', 'Aporte')).toBe('Aporte')
    expect(injectHistoryLabel(undefined, 'Efectivo por digital')).toBe('Efectivo por digital')
    expect(injectHistoryLabel(undefined, 'Aporte')).toBe('Aporte')
  })
})
