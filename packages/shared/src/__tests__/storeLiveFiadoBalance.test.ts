import { describe, expect, it } from 'vitest'
import {
  emptyCheckpoint,
  msToTsRank,
  type CompactableDebtEvent,
  type TsRank,
} from '../debtCheckpoint'
import { storeLiveFiadoBalance, type CustomerLivePair } from '../summaryFiado'

function pair(
  customerId: string,
  storeId: string,
  saldo: number,
  events: CompactableDebtEvent[] = [],
  checkpointAt: TsRank | null = null,
): CustomerLivePair {
  return {
    customerId,
    storeId,
    checkpoint: {
      ...emptyCheckpoint('customer', customerId, storeId),
      saldoAcumulado: saldo,
      checkpointAt,
    },
    events,
  }
}

function event(
  id: string,
  atSeconds: number,
  eventType: string,
  amount: number,
  deleted = false,
): CompactableDebtEvent {
  return {
    id,
    serverAt: msToTsRank(atSeconds * 1000),
    deleted,
    customerEventType: eventType,
    amount,
  }
}

describe('storeLiveFiadoBalance', () => {
  const frontier = msToTsRank(50_000)

  it('sin pares el saldo queda pendiente', () => {
    expect(storeLiveFiadoBalance('norte', [])).toBeNull()
  })

  it('un par de otro local no cuenta como cero de este', () => {
    expect(storeLiveFiadoBalance('sur', [pair('c1', 'norte', 4_000)])).toBeNull()
  })

  it('suma el checkpoint y la cola posterior, y deja afuera al que ya pagó', () => {
    const owing = pair('c1', 'norte', 10_000, [
      event('pago', 80, 'partial_payment', 3_000),
    ], frontier)
    const settled = pair('c2', 'norte', 5_000, [
      event('cancela', 80, 'paid', 5_000),
    ], frontier)
    expect(storeLiveFiadoBalance('norte', [owing, settled])).toBe(7_000)
  })

  it('si todos los pares de ese local están en cero, el saldo es cero', () => {
    expect(storeLiveFiadoBalance('norte', [
      pair('c1', 'norte', 5_000, [event('pago', 80, 'paid', 5_000)], frontier),
    ])).toBe(0)
  })

  it('un centavo no es deuda y dos centavos sí', () => {
    expect(storeLiveFiadoBalance('norte', [pair('c1', 'norte', 0.01)])).toBe(0)
    expect(storeLiveFiadoBalance('norte', [pair('c1', 'norte', 0.02)])).toBe(0.02)
  })

  it('no muestra el local si el cliente ya no debe en el total', () => {
    const pairs = [
      pair('c1', 'norte', 5_000),
      pair('c1', 'sur', -5_000),
    ]
    expect(storeLiveFiadoBalance('norte', pairs)).toBe(0)
    expect(storeLiveFiadoBalance('sur', pairs)).toBe(0)
  })

  it('suma el saldo del local cuando el total de locales sigue siendo deuda', () => {
    expect(storeLiveFiadoBalance('norte', [
      pair('c1', 'norte', 8_000),
      pair('c1', 'sur', -3_000),
    ])).toBe(8_000)
  })

  it('un evento borrado o ya plegado no vuelve a entrar', () => {
    const atFrontier = event('viejo', 50, 'created', 500)
    const before = event('anterior', 40, 'created', 500)
    const removed = event('borrado', 90, 'created', 9_000, true)
    const fresh = event('nuevo', 90, 'created', 200)
    expect(storeLiveFiadoBalance('norte', [
      pair('c1', 'norte', 1_000, [atFrontier, before, removed, fresh], frontier),
    ])).toBe(1_200)
  })

  it('ignora un par de proveedor y un par repetido usa el último', () => {
    const provider: CustomerLivePair = {
      customerId: 'prov',
      storeId: 'norte',
      checkpoint: {
        ...emptyCheckpoint('provider', 'prov', 'norte'),
        saldoAcumulado: 99_000,
      },
      events: [],
    }
    expect(storeLiveFiadoBalance('norte', [
      provider,
      pair('c1', 'norte', 1_000),
      pair('c1', 'norte', 4_000),
    ])).toBe(4_000)
  })
})
