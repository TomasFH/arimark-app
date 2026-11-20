import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transferOccurredAt } from '@carniceria/shared'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { debtEvents, expenses, merchandiseIntakes, storeTransfers, stores, users } from '../../db/schema'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('../../activeSession', () => ({
  getActiveSession: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerStoreTransferHandlers } from '../storeTransfer.handler'

type HandlerFn = (_event: unknown, payload?: unknown) => { ok: boolean; code?: string; data?: unknown }

function getHandler(channel: string): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls.filter(call => call[0] === channel)
  const call = calls[calls.length - 1]
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const WHEN = transferOccurredAt('2026-11-15') ?? ''
const CASHIER = {
  userId: 'ana',
  storeId: 'norte',
  role: 'cashier' as const,
  shiftId: null,
  displayName: 'Ana',
}
const OTHER = { ...CASHIER, userId: 'luis', displayName: 'Luis' }
const ADMIN = {
  userId: 'admin-1',
  storeId: 'norte',
  role: 'admin' as const,
  shiftId: null,
  displayName: 'Admin',
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    productName: 'Vacío',
    quantity: 4,
    unit: 'kg',
    fromStoreId: 'norte',
    toStoreId: 'sur',
    occurredAt: WHEN,
    notes: null,
    estimatedValue: null,
    ...overrides,
  }
}

describe('storeTransfer.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db
    const now = '2026-11-20T15:00:00.000Z'
    db.insert(stores).values([
      { id: 'norte', name: 'Norte', createdAt: now },
      { id: 'sur', name: 'Sur', createdAt: now },
      { id: 'archivado', name: 'Viejo', createdAt: now, archivedAt: now },
    ]).run()
    db.insert(users).values({ id: 'ana', name: 'Ana', createdAt: now }).run()
    db.insert(users).values({ id: 'luis', name: 'Luis', createdAt: now }).run()
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(CASHIER)
    registerStoreTransferHandlers()
  })

  function others() {
    return {
      expenses: db.select().from(expenses).all().length,
      debts: db.select().from(debtEvents).all().length,
      intakes: db.select().from(merchandiseIntakes).all().length,
    }
  }

  describe('alta', () => {
    it('la cajera guarda un pendiente sin turno y sin gastos, deuda ni ingresos', () => {
      const result = getHandler('ipc:create-store-transfer')(null, draft())
      expect(result.ok).toBe(true)
      const row = db.select().from(storeTransfers).all()[0]
      expect(row).toMatchObject({
        status: 'pending',
        createdBy: 'ana',
        receivedQuantity: null,
        hasDifference: false,
        quantity: 4,
      })
      expect(others()).toEqual({ expenses: 0, debts: 0, intakes: 0 })
    })

    it('un admin sin fila en users también puede dar de alta', () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN)
      const result = getHandler('ipc:create-store-transfer')(null, draft({ unit: 'cajon', quantity: 2 }))
      expect(result.ok).toBe(true)
      expect(db.select().from(storeTransfers).all()[0]).toMatchObject({
        createdBy: 'admin-1',
        unit: 'cajon',
        status: 'pending',
      })
    })

    it('un payload malformado no toca la base', () => {
      const result = getHandler('ipc:create-store-transfer')(null, { productName: 'Vacío', quantity: '4' })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
      expect(getDb).not.toHaveBeenCalled()
      expect(db.select().from(storeTransfers).all()).toHaveLength(0)
    })

    it('sin sesión no toca la base', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:create-store-transfer')(null, draft())
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
      expect(getDb).not.toHaveBeenCalled()
      expect(db.select().from(storeTransfers).all()).toHaveLength(0)
    })

    it('la misma fecha con hora, o el mismo local, no abre la base', () => {
      const dated = getHandler('ipc:create-store-transfer')(null, draft({
        occurredAt: '2026-11-15T22:00:00.000Z',
      }))
      expect(dated).toMatchObject({ ok: false, code: 'DATE' })
      const sameStore = getHandler('ipc:create-store-transfer')(null, draft({ toStoreId: 'norte' }))
      expect(sameStore).toMatchObject({ ok: false, code: 'STORES' })
      expect(getDb).not.toHaveBeenCalled()
    })
  })

  describe('confirmación', () => {
    function createOne(): string {
      const created = getHandler('ipc:create-store-transfer')(null, draft()) as {
        ok: boolean
        data: { id: string }
      }
      expect(created.ok).toBe(true)
      vi.mocked(getDb).mockClear()
      return created.data.id
    }

    it('confirma con diferencia y la segunda vez no cambia la cantidad', () => {
      const id = createOne()
      vi.mocked(getActiveSession).mockReturnValue(OTHER)
      const first = getHandler('ipc:confirm-store-transfer')(null, { id, receivedQuantity: 3.5 })
      expect(first).toEqual({ ok: true, data: { hasDifference: true } })
      const second = getHandler('ipc:confirm-store-transfer')(null, { id, receivedQuantity: 4 })
      expect(second).toMatchObject({ ok: false, code: 'NOT_PENDING' })
      expect(db.select().from(storeTransfers).all()[0]).toMatchObject({
        status: 'confirmed',
        receivedQuantity: 3.5,
        hasDifference: true,
        confirmedBy: 'luis',
      })
      expect(others()).toEqual({ expenses: 0, debts: 0, intakes: 0 })
    })

    it('un payload malformado no toca la base', () => {
      createOne()
      const result = getHandler('ipc:confirm-store-transfer')(null, { id: 'no-es-uuid', receivedQuantity: 1 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
      expect(getDb).not.toHaveBeenCalled()
      expect(db.select().from(storeTransfers).all()[0]?.status).toBe('pending')
    })

    it('sin sesión no toca la base', () => {
      const id = createOne()
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:confirm-store-transfer')(null, { id, receivedQuantity: 4 })
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
      expect(getDb).not.toHaveBeenCalled()
      expect(db.select().from(storeTransfers).all()[0]?.status).toBe('pending')
    })
  })

  describe('cancelación', () => {
    function createOne(): string {
      const created = getHandler('ipc:create-store-transfer')(null, draft()) as {
        ok: boolean
        data: { id: string }
      }
      vi.mocked(getDb).mockClear()
      return created.data.id
    }

    it('la cancela quien la creó', () => {
      const id = createOne()
      const result = getHandler('ipc:cancel-store-transfer')(null, { id })
      expect(result).toEqual({ ok: true, data: { id } })
      expect(db.select().from(storeTransfers).all()[0]?.status).toBe('cancelled')
      expect(others()).toEqual({ expenses: 0, debts: 0, intakes: 0 })
    })

    it('otra cajera no puede, y un admin sí si sigue pendiente', () => {
      const id = createOne()
      vi.mocked(getActiveSession).mockReturnValue(OTHER)
      const denied = getHandler('ipc:cancel-store-transfer')(null, { id })
      expect(denied).toMatchObject({ ok: false, code: 'FORBIDDEN' })
      expect(db.select().from(storeTransfers).all()[0]?.status).toBe('pending')

      vi.mocked(getActiveSession).mockReturnValue(ADMIN)
      const allowed = getHandler('ipc:cancel-store-transfer')(null, { id })
      expect(allowed).toEqual({ ok: true, data: { id } })
      expect(db.select().from(storeTransfers).all()[0]).toMatchObject({
        status: 'cancelled',
        updatedBy: 'admin-1',
      })
    })

    it('un confirmado no se puede cancelar', () => {
      const id = createOne()
      getHandler('ipc:confirm-store-transfer')(null, { id, receivedQuantity: 4 })
      vi.mocked(getActiveSession).mockReturnValue(ADMIN)
      const result = getHandler('ipc:cancel-store-transfer')(null, { id })
      expect(result).toMatchObject({ ok: false, code: 'NOT_PENDING' })
      expect(db.select().from(storeTransfers).all()[0]?.status).toBe('confirmed')
    })

    it('un payload malformado no toca la base', () => {
      createOne()
      const result = getHandler('ipc:cancel-store-transfer')(null, { id: 12 })
      expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
      expect(getDb).not.toHaveBeenCalled()
      expect(db.select().from(storeTransfers).all()[0]?.status).toBe('pending')
    })

    it('sin sesión no toca la base', () => {
      const id = createOne()
      vi.mocked(getActiveSession).mockReturnValue(null)
      const result = getHandler('ipc:cancel-store-transfer')(null, { id })
      expect(result).toMatchObject({ ok: false, code: 'NO_SESSION' })
      expect(getDb).not.toHaveBeenCalled()
      expect(db.select().from(storeTransfers).all()[0]?.status).toBe('pending')
    })
  })
})
