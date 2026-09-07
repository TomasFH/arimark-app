import { describe, it, expect } from 'vitest'
import {
  applyCustomerEventToSaldo,
  applyProviderEventToSaldo,
  checkpointCutoffRank,
  compareTsRank,
  debtCheckpointDocId,
  emptyCheckpoint,
  eventBelongsInCheckpoint,
  foldEventsIntoCheckpoint,
  pairHasPendingFold,
  planCreatedAtServerBackfill,
  CHECKPOINT_SAFETY_MS,
  msToTsRank,
  parseCompactableEvent,
  ranksEqual,
  estimateAdvanceReads,
} from '../debtCheckpoint'

const day = 24 * 60 * 60 * 1000
const now = Date.parse('2026-09-04T12:00:00.000Z')
const cutoff = checkpointCutoffRank(now)

describe('checkpointCutoffRank', () => {
  it('queda 5 días atrás', () => {
    const cut = checkpointCutoffRank(now)
    const expected = msToTsRank(now - CHECKPOINT_SAFETY_MS)
    expect(ranksEqual(cut, expected)).toBe(true)
  })
})

describe('eventBelongsInCheckpoint', () => {
  it('sin checkpoint incluye todo lo anterior o igual al corte', () => {
    expect(eventBelongsInCheckpoint(msToTsRank(now - 6 * day), null, cutoff)).toBe(true)
    expect(eventBelongsInCheckpoint(cutoff, null, cutoff)).toBe(true)
  })

  it('rechaza eventos dentro del margen de 5 días', () => {
    expect(eventBelongsInCheckpoint(msToTsRank(now - 2 * day), null, cutoff)).toBe(false)
    expect(eventBelongsInCheckpoint(msToTsRank(now), null, cutoff)).toBe(false)
  })

  it('exige timestamp de servidor estrictamente posterior al checkpoint', () => {
    const frontier = msToTsRank(now - 10 * day)
    expect(eventBelongsInCheckpoint(frontier, frontier, cutoff)).toBe(false)
    expect(eventBelongsInCheckpoint(msToTsRank(now - 10 * day + 1), frontier, cutoff)).toBe(true)
  })
})

describe('apply*EventToSaldo', () => {
  it('proveedor: debt suma, payment resta, usa abs', () => {
    expect(applyProviderEventToSaldo(0, 'debt', 1000)).toBe(1000)
    expect(applyProviderEventToSaldo(1000, 'payment', 400)).toBe(600)
    expect(applyProviderEventToSaldo(1000, 'payment', -400)).toBe(600)
  })

  it('cliente: created/debt/reopened cobran; pagos y cancel restan', () => {
    expect(applyCustomerEventToSaldo(0, 'created', 500)).toBe(500)
    expect(applyCustomerEventToSaldo(500, 'partial_payment', 200)).toBe(300)
    expect(applyCustomerEventToSaldo(300, 'cancelled', 300)).toBe(0)
    expect(applyCustomerEventToSaldo(0, 'reopened', 100)).toBe(100)
  })
})

describe('foldEventsIntoCheckpoint', () => {
  const base = emptyCheckpoint('provider', 'prov-1', 'store-1')

  it('no pliega eventos de los últimos 5 días', () => {
    const result = foldEventsIntoCheckpoint({
      kind: 'provider',
      current: base,
      cutoff,
      events: [
        { id: 'e-new', serverAt: msToTsRank(now - day), providerType: 'debt', amount: 999 },
      ],
    })
    expect(result.folded).toBe(0)
    expect(result.next.saldoAcumulado).toBe(0)
    expect(result.next.checkpointAt).toBeNull()
  })

  it('suma deuda y pago viejos y avanza la frontera al último incluido', () => {
    const t1 = msToTsRank(now - 20 * day)
    const t2 = msToTsRank(now - 12 * day)
    const result = foldEventsIntoCheckpoint({
      kind: 'provider',
      current: base,
      cutoff,
      events: [
        { id: 'b', serverAt: t2, providerType: 'payment', amount: 300 },
        { id: 'a', serverAt: t1, providerType: 'debt', amount: 1000 },
      ],
    })
    expect(result.folded).toBe(2)
    expect(result.next.saldoAcumulado).toBe(700)
    expect(ranksEqual(result.next.checkpointAt, t2)).toBe(true)
    expect(result.next.foldedCount).toBe(2)
  })

  it('avanza la frontera sobre deleted sin tocar el saldo', () => {
    const t1 = msToTsRank(now - 15 * day)
    const result = foldEventsIntoCheckpoint({
      kind: 'provider',
      current: base,
      cutoff,
      events: [{ id: 'x', serverAt: t1, deleted: true, providerType: 'debt', amount: 50 }],
    })
    expect(result.folded).toBe(1)
    expect(result.next.saldoAcumulado).toBe(0)
    expect(ranksEqual(result.next.checkpointAt, t1)).toBe(true)
  })

  it('no vuelve a plegar un evento ya en o detrás de la frontera', () => {
    const t1 = msToTsRank(now - 20 * day)
    const current = { ...base, saldoAcumulado: 1000, checkpointAt: t1, foldedCount: 1 }
    const result = foldEventsIntoCheckpoint({
      kind: 'provider',
      current,
      cutoff,
      events: [{ id: 'a', serverAt: t1, providerType: 'debt', amount: 1000 }],
    })
    expect(result.folded).toBe(0)
    expect(result.next.saldoAcumulado).toBe(1000)
  })

  it('fiado: created + pago', () => {
    const t1 = msToTsRank(now - 8 * day)
    const t2 = msToTsRank(now - 7 * day)
    const result = foldEventsIntoCheckpoint({
      kind: 'customer',
      current: emptyCheckpoint('customer', 'c1', 'store-1'),
      cutoff,
      events: [
        { id: '1', serverAt: t1, customerEventType: 'created', amount: 2000 },
        { id: '2', serverAt: t2, customerEventType: 'partial_payment', amount: 500 },
      ],
    })
    expect(result.next.saldoAcumulado).toBe(1500)
    expect(ranksEqual(result.next.checkpointAt, t2)).toBe(true)
  })
})

describe('parseCompactableEvent', () => {
  it('omite eventos sin createdAtServer', () => {
    expect(parseCompactableEvent('provider', 'e1', { type: 'debt', amount: 1 })).toBeNull()
  })

  it('lee Timestamp-like', () => {
    const parsed = parseCompactableEvent('provider', 'e1', {
      createdAtServer: { seconds: 100, nanoseconds: 5 },
      type: 'payment',
      amount: 10,
    })
    expect(parsed?.serverAt).toEqual({ seconds: 100, nanos: 5 })
    expect(parsed?.providerType).toBe('payment')
  })
})

describe('debtCheckpointDocId', () => {
  it('no deja barras en el id', () => {
    expect(debtCheckpointDocId('a/b', 's/1')).toBe('a_b__s_1')
  })
})

describe('compareTsRank', () => {
  it('usa nanos como desempate', () => {
    expect(compareTsRank({ seconds: 1, nanos: 2 }, { seconds: 1, nanos: 3 })).toBeLessThan(0)
  })
})

describe('pairHasPendingFold', () => {
  it('exige tail con primer evento anterior al corte y último posterior al checkpoint', () => {
    const first = msToTsRank(now - 20 * day)
    const last = msToTsRank(now - 10 * day)
    expect(pairHasPendingFold({
      firstEventAt: first,
      lastEventAt: last,
      checkpointAt: msToTsRank(now - 15 * day),
      cutoff,
    })).toBe(true)
  })

  it('omite pares ya alcanzados por el checkpoint', () => {
    const t = msToTsRank(now - 10 * day)
    expect(pairHasPendingFold({
      firstEventAt: msToTsRank(now - 20 * day),
      lastEventAt: t,
      checkpointAt: t,
      cutoff,
    })).toBe(false)
  })

  it('omite pares cuya actividad es solo de los últimos 5 días', () => {
    expect(pairHasPendingFold({
      firstEventAt: msToTsRank(now - 2 * day),
      lastEventAt: msToTsRank(now - day),
      checkpointAt: null,
      cutoff,
    })).toBe(false)
  })
})

describe('planCreatedAtServerBackfill', () => {
  it('no pisa un createdAtServer ya presente', () => {
    expect(planCreatedAtServerBackfill({
      createdAtServer: { seconds: 1, nanoseconds: 0 },
      createdAt: '2026-01-01T00:00:00.000Z',
    })).toEqual({ action: 'skip', reason: 'already-has-server-ts' })
  })

  it('asigna desde createdAt ISO', () => {
    const plan = planCreatedAtServerBackfill({ createdAt: '2026-08-01T15:04:00.000Z' })
    expect(plan.action).toBe('assign')
    if (plan.action !== 'assign') return
    expect(plan.source).toBe('createdAt')
    expect(plan.iso).toBe('2026-08-01T15:04:00.000Z')
    expect(plan.rank).toEqual(msToTsRank(Date.parse('2026-08-01T15:04:00.000Z')))
  })

  it('cae a date si no hay createdAt', () => {
    const plan = planCreatedAtServerBackfill({ date: '2026-07-15T10:00:00.000Z' })
    expect(plan.action).toBe('assign')
    if (plan.action !== 'assign') return
    expect(plan.source).toBe('date')
  })

  it('deja sin campo si no hay timestamp parseable', () => {
    expect(planCreatedAtServerBackfill({ createdAt: 'ayer' })).toMatchObject({
      action: 'leave-unset',
      reason: 'unparseable',
    })
    expect(planCreatedAtServerBackfill({})).toMatchObject({
      action: 'leave-unset',
      reason: 'missing',
    })
  })
})

describe('estimateAdvanceReads', () => {
  it('cuenta query + relock de cada evento', () => {
    expect(estimateAdvanceReads(0)).toBe(2)
    expect(estimateAdvanceReads(400)).toBe(802)
  })
})
