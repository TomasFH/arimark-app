import { describe, expect, it } from 'vitest'
import {
  STORE_TRANSFER_PENDING_LIMIT,
  cancelStoreTransfer,
  confirmStoreTransfer,
  pendingStoreTransfers,
  storeTransferIsPending,
  storeTransferLabel,
  transferOccurredAt,
  validateStoreTransferDraft,
} from '../storeTransfer'

const WHEN = transferOccurredAt('2026-11-15')

function draft(overrides: Partial<Parameters<typeof validateStoreTransferDraft>[0]> = {}) {
  return validateStoreTransferDraft({
    productName: '  Vacío  ',
    quantity: 12,
    unit: 'kg',
    fromStoreId: 'norte',
    toStoreId: 'sur',
    occurredAt: WHEN ?? '',
    notes: '  sale a la mañana  ',
    estimatedValue: null,
    ...overrides,
  })
}

describe('storeTransfer', () => {
  it('la fecha del movimiento es la medianoche civil de Argentina', () => {
    expect(WHEN).toBe('2026-11-15T03:00:00.000Z')
    expect(transferOccurredAt('2026-11-15T22:00:00.000-03:00')).toBeNull()
    expect(transferOccurredAt('2026-02-31')).toBeNull()
  })

  it('acepta el alta con valor estimado vacío y rechaza el mismo local', () => {
    const ok = draft()
    expect(ok).toEqual({
      ok: true,
      draft: {
        productName: 'Vacío',
        quantity: 12,
        unit: 'kg',
        fromStoreId: 'norte',
        toStoreId: 'sur',
        occurredAt: WHEN,
        notes: 'sale a la mañana',
        estimatedValue: null,
      },
    })
    expect(draft({ estimatedValue: 15000 }).ok).toBe(true)
    expect(draft({ toStoreId: 'norte' })).toEqual({ ok: false, reason: 'STORES' })
    expect(draft({ quantity: 1.5, unit: 'u' })).toEqual({ ok: false, reason: 'QUANTITY' })
    expect(draft({ quantity: 0 })).toEqual({ ok: false, reason: 'QUANTITY' })
    expect(draft({ estimatedValue: 10.5 })).toEqual({ ok: false, reason: 'VALUE' })
    expect(draft({ occurredAt: '2026-11-15T22:00:00.000-03:00' })).toEqual({ ok: false, reason: 'DATE' })
  })

  it('confirma igual, marca la diferencia y no confirma un cancelado', () => {
    const same = confirmStoreTransfer({ status: 'pending', quantity: 4, unit: 'cajon' }, 4)
    expect(same).toEqual({ ok: true, status: 'confirmed', receivedQuantity: 4, hasDifference: false })
    const other = confirmStoreTransfer({ status: 'pending', quantity: 4, unit: 'kg' }, 3.5)
    expect(other).toEqual({ ok: true, status: 'confirmed', receivedQuantity: 3.5, hasDifference: true })
    expect(confirmStoreTransfer({ status: 'pending', quantity: 4, unit: 'kg' }, 0)).toMatchObject({
      ok: true,
      hasDifference: true,
    })
    expect(confirmStoreTransfer({ status: 'cancelled', quantity: 4, unit: 'kg' }, 4)).toEqual({
      ok: false,
      reason: 'NOT_PENDING',
    })
    expect(storeTransferLabel({ status: 'confirmed', hasDifference: false })).toBe('Confirmado')
    expect(storeTransferLabel({ status: 'confirmed', hasDifference: true })).toBe('Con diferencia')
  })

  it('cancela un pendiente quien lo creó o un admin, y otra cajera no', () => {
    const pending = { status: 'pending' as const, createdBy: 'ana' }
    expect(cancelStoreTransfer(pending, { userId: 'ana', role: 'cashier' })).toEqual({
      ok: true,
      status: 'cancelled',
      receivedQuantity: null,
      hasDifference: false,
    })
    expect(cancelStoreTransfer(pending, { userId: 'dueño', role: 'admin' }).ok).toBe(true)
    expect(cancelStoreTransfer(pending, { userId: 'luis', role: 'cashier' })).toEqual({
      ok: false,
      reason: 'FORBIDDEN',
    })
    expect(cancelStoreTransfer({ status: 'confirmed', createdBy: 'ana' }, { userId: 'dueño', role: 'admin' })).toEqual({
      ok: false,
      reason: 'NOT_PENDING',
    })
    expect(storeTransferLabel({ status: 'cancelled', hasDifference: false })).toBe('Cancelado')
    expect(storeTransferIsPending({ status: 'cancelled' })).toBe(false)
    expect(storeTransferIsPending({ status: 'confirmed' })).toBe(false)
    expect(storeTransferIsPending({ status: 'pending' })).toBe(true)
  })

  it('más de 100 pendientes queda incompleta y el cancelado no entra en la cuenta', () => {
    expect(STORE_TRANSFER_PENDING_LIMIT).toBe(100)
    const rows = [
      ...Array.from({ length: 100 }, (_, index) => ({ id: `p-${index}`, status: 'pending' as const })),
      { id: 'cancelado', status: 'cancelled' as const },
      { id: 'cerrado', status: 'confirmed' as const },
    ]
    expect(pendingStoreTransfers(rows)).toEqual({
      rows: rows.slice(0, 100),
      incomplete: false,
    })
    const over = [...rows, { id: 'p-extra', status: 'pending' as const }]
    const page = pendingStoreTransfers(over)
    expect(page.incomplete).toBe(true)
    expect(page.rows).toHaveLength(100)
    expect(page.rows.some(row => row.status !== 'pending')).toBe(false)
    expect(page.rows.some(row => row.id === 'p-extra')).toBe(false)
  })
})
