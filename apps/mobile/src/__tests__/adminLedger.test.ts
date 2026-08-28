import { describe, it, expect } from 'vitest'
import {
  calcCustomerBalance,
  calcProviderBalance,
  planProviderStoreCompensation,
  ledgerDeltaToTarget,
  formatAdminAdjustNote,
  isAdminAdjustNote,
  providerIdFromName,
  providerNameKey,
  expenseTitle,
  expenseNote,
  normalizeDebtEventType,
  asIsoTimestamp,
  planCustomerDebtPayments,
} from '../lib/adminLedger'

describe('calcCustomerBalance', () => {
  it('suma created/debt y resta pagos aunque el signo del monto varíe', () => {
    expect(calcCustomerBalance([
      { eventType: 'created', amount: 17000 },
      { eventType: 'debt', amount: 5000 },
    ])).toBe(22000)

    expect(calcCustomerBalance([
      { eventType: 'created', amount: 17000 },
      { eventType: 'partial_payment', amount: -7000 },
    ])).toBe(10000)

    expect(calcCustomerBalance([
      { eventType: 'created', amount: 17000 },
      { eventType: 'partial_payment', amount: 7000 },
    ])).toBe(10000)
  })

  it('no trata un created como pago (regresión filtro Todos los locales)', () => {
    const events = [
      { eventType: 'created', amount: 17000 },
      { eventType: 'debt', amount: 17000 },
    ]
    // Dos cargos distintos se suman; no se anulan entre sí.
    expect(calcCustomerBalance(events)).toBe(34000)
    expect(calcCustomerBalance([{ eventType: 'created', amount: 17000 }])).toBe(17000)
  })
})

describe('calcProviderBalance', () => {
  it('deuda menos pagos por local', () => {
    expect(calcProviderBalance([
      { type: 'debt', amount: 500000 },
      { type: 'payment', amount: 400000 },
    ])).toBe(100000)
  })
})

describe('planProviderStoreCompensation', () => {
  it('netea crédito de un local contra deuda de otro', () => {
    expect(planProviderStoreCompensation({
      cam: -50000,
      sm: 50000,
    })).toEqual([
      { storeId: 'cam', type: 'debt', amount: 50000 },
      { storeId: 'sm', type: 'payment', amount: 50000 },
    ])
  })
})

describe('ledgerDeltaToTarget', () => {
  it('genera deuda o pago para dejar el saldo en el monto pedido', () => {
    expect(ledgerDeltaToTarget(-50000, 0)).toEqual({ type: 'debt', amount: 50000 })
    expect(ledgerDeltaToTarget(400000, 0)).toEqual({ type: 'payment', amount: 400000 })
    expect(ledgerDeltaToTarget(400000, 100000)).toEqual({ type: 'payment', amount: 300000 })
    expect(ledgerDeltaToTarget(90000, -20000)).toEqual({ type: 'payment', amount: 110000 })
    expect(ledgerDeltaToTarget(0, 0)).toBeNull()
  })
})

describe('formatAdminAdjustNote', () => {
  it('deja claro que el admin fijó el saldo', () => {
    expect(formatAdminAdjustNote(10000)).toContain('Ajuste de admin')
    expect(formatAdminAdjustNote(10000)).toContain('deuda')
    expect(formatAdminAdjustNote(-20000)).toContain('a favor')
    expect(formatAdminAdjustNote(0)).toContain('$ 0')
    expect(isAdminAdjustNote(formatAdminAdjustNote(10000))).toBe(true)
    expect(isAdminAdjustNote('Pago')).toBe(false)
    expect(formatAdminAdjustNote(10000, 'Admin Prueba')).toContain('(Admin Prueba)')
  })
})

describe('providerIdFromName', () => {
  it('hex del nameKey (mismo criterio que desktop)', () => {
    expect(providerNameKey('  Oso ')).toBe('oso')
    expect(providerIdFromName('Oso')).toBe(
      Array.from(new TextEncoder().encode('oso'))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
    )
  })
})

describe('expenseTitle', () => {
  it('usa el proveedor como título (layout desktop)', () => {
    expect(expenseTitle({
      providerName: 'Oso',
      description: null,
      category: '',
    })).toBe('Oso')
  })

  it('usa concept/description para vales sin proveedor', () => {
    expect(expenseTitle({
      providerName: null,
      concept: 'Vale: Tomas Holgado',
      category: '',
    })).toBe('Vale: Tomas Holgado')
    expect(expenseTitle({
      providerName: null,
      description: null,
      category: 'vale',
    })).toBe('Vale')
  })
})

describe('expenseNote', () => {
  it('no duplica el título en la nota', () => {
    expect(expenseNote({ providerName: 'Oso', concept: 'Oso' })).toBe(null)
    expect(expenseNote({ providerName: 'Oso', concept: 'Mercadería' })).toBe('Mercadería')
  })
})

describe('normalizeDebtEventType', () => {
  it('mapea el legado mobile debt → created', () => {
    expect(normalizeDebtEventType('debt')).toBe('created')
    expect(normalizeDebtEventType('created')).toBe('created')
    expect(normalizeDebtEventType('partial_payment')).toBe('partial_payment')
  })
})

describe('asIsoTimestamp', () => {
  it('acepta string y Timestamp-like', () => {
    expect(asIsoTimestamp('2026-08-18T00:00:00.000Z')).toBe('2026-08-18T00:00:00.000Z')
    expect(asIsoTimestamp(null)).toBe(null)
    expect(asIsoTimestamp({
      toDate: () => new Date('2026-08-18T12:00:00.000Z'),
    })).toBe('2026-08-18T12:00:00.000Z')
  })
})

describe('planCustomerDebtPayments', () => {
  it('arma un evento por medio y marca paid solo al cubrir el saldo', () => {
    expect(planCustomerDebtPayments(10000, [
      { method: 'cash', amount: 4000 },
      { method: 'debit', amount: 6000 },
    ])).toEqual({
      ok: true,
      payments: [
        { amount: 4000, method: 'cash', eventType: 'partial_payment' },
        { amount: 6000, method: 'debit', eventType: 'paid' },
      ],
    })
  })

  it('permite pago parcial de un solo medio', () => {
    expect(planCustomerDebtPayments(10000, [
      { method: 'cash', amount: 3000 },
      { method: 'debit', amount: 0 },
    ])).toEqual({
      ok: true,
      payments: [{ amount: 3000, method: 'cash', eventType: 'partial_payment' }],
    })
  })

  it('rechaza excedente o vacío', () => {
    expect(planCustomerDebtPayments(5000, [
      { method: 'cash', amount: 3000 },
      { method: 'debit', amount: 3000 },
    ]).ok).toBe(false)
    expect(planCustomerDebtPayments(5000, [
      { method: 'cash', amount: 0 },
    ]).ok).toBe(false)
  })
})
