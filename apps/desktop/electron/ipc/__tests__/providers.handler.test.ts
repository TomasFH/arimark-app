import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, providers, providerDebtEvents, shifts, expenses } from '../../db/schema'

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

vi.mock('../../businessConfig', () => ({
  getBusinessConfig: vi.fn(() => ({ tenant_id: 'test-license', default_store_id: 'store-001' })),
}))

vi.mock('../../licensing/providerSync', () => ({
  pushUnsyncedProviders: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedDebtEvents: vi.fn().mockResolvedValue(undefined),
  markDebtEventsDeletedInFirestore: vi.fn().mockResolvedValue(undefined),
  restoreProviderLedgerInFirestore: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../licensing/expenseSync', () => ({
  pushUnsyncedExpenses: vi.fn().mockResolvedValue(undefined),
  markExpensesDeletedInFirestore: vi.fn().mockResolvedValue(undefined),
}))

// GET_PROVIDERS_WITH_DEBT usa Firebase o fallback local; en tests usa fallback local.
vi.mock('../../licensing/firebase', () => ({
  isFirebaseAvailable: vi.fn(() => false),
  getFirebaseApp: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  updateDoc: vi.fn(),
}))

import { ipcMain } from 'electron'
import { getDb } from '../../db/client'
import { getActiveSession } from '../../activeSession'
import { registerProvidersHandlers } from '../providers.handler'
import { providerIdFromName } from '../providerUtils'

type HandlerFn = (_event: unknown, payload?: unknown) => unknown

function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

const ADMIN_SESSION = { userId: 'admin-001', storeId: 'store-001', role: 'admin' as const, shiftId: null }
const CASHIER_SESSION = { userId: 'user-001', storeId: 'store-001', role: 'cashier' as const, shiftId: null }

describe('providers.handler', () => {
  let db: Awaited<ReturnType<typeof createInMemoryDb>>['db']

  beforeEach(async () => {
    vi.clearAllMocks()
    const instance = await createInMemoryDb()
    db = instance.db

    db.insert(stores).values({ id: 'store-001', name: 'Local A', createdAt: new Date().toISOString() }).run()
    db.insert(stores).values({ id: 'store-002', name: 'Local B', createdAt: new Date().toISOString() }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera Test', storeId: 'store-001', role: 'cashier', active: true, createdAt: new Date().toISOString() }).run()
    db.insert(users).values({ id: 'admin-001', name: 'Admin', storeId: 'store-001', role: 'cashier', active: true, createdAt: new Date().toISOString() }).run()

    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)

    registerProvidersHandlers()
  })

  // -------------------------------------------------------------------------
  describe('LIST_PROVIDERS (ipc:list-providers)', () => {
    it('retorna lista vacía cuando no hay proveedores', () => {
      const handler = getHandler('ipc:list-providers')
      const result = handler(null, {}) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('lista los proveedores activos', () => {
      const id = providerIdFromName('oso')
      db.insert(providers).values({ id, name: 'Oso', nameKey: 'oso', createdAt: new Date().toISOString() }).run()

      const handler = getHandler('ipc:list-providers')
      const result = handler(null, {}) as { ok: boolean; data: Array<{ id: string; name: string }> }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Oso')
    })

    it('excluye archivados por defecto', () => {
      const id = providerIdFromName('archivado')
      db.insert(providers).values({
        id,
        name: 'Archivado',
        nameKey: 'archivado',
        createdAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
      }).run()

      const handler = getHandler('ipc:list-providers')
      const result = handler(null, {}) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })

    it('incluye archivados cuando se pide', () => {
      const id = providerIdFromName('archivado')
      db.insert(providers).values({
        id,
        name: 'Archivado',
        nameKey: 'archivado',
        createdAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
      }).run()

      const handler = getHandler('ipc:list-providers')
      const result = handler(null, { includeArchived: true }) as { ok: boolean; data: unknown[] }
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
    })

    it('rechaza si no hay sesión', () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:list-providers')
      const result = handler(null, {}) as { ok: boolean; code: string }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })
  })

  // -------------------------------------------------------------------------
  describe('CREATE_PROVIDER (ipc:create-provider)', () => {
    it('crea un proveedor nuevo con id determinístico', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-provider')
      const result = await (handler(null, { name: 'Proveedor Nuevo' }) as Promise<{ ok: boolean; data: { id: string; name: string } }>)
      expect(result.ok).toBe(true)
      expect(result.data.id).toBe(providerIdFromName('Proveedor Nuevo'))
      expect(result.data.name).toBe('Proveedor Nuevo')

      const row = db.select().from(providers).all()[0]
      expect(row.nameKey).toBe('proveedor nuevo')
    })

    it('dedup: crear el mismo proveedor dos veces retorna el existente sin duplicar', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-provider')
      await (handler(null, { name: 'Oso' }) as Promise<unknown>)
      await (handler(null, { name: 'oso' }) as Promise<unknown>)

      const all = db.select().from(providers).all()
      expect(all).toHaveLength(1)
    })

    it('reactiva un proveedor archivado al crear el mismo nombre', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const id = providerIdFromName('oso')
      db.insert(providers).values({
        id,
        name: 'Oso',
        nameKey: 'oso',
        createdAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
      }).run()

      const handler = getHandler('ipc:create-provider')
      const result = await (handler(null, { name: 'Oso' }) as Promise<{ ok: boolean; data: { archivedAt?: string } }>)
      expect(result.ok).toBe(true)
      expect(result.data.archivedAt).toBeFalsy()
      expect(db.select().from(providers).all()[0]?.archivedAt).toBeNull()
    })

    it('dedup case-insensitive: "OSO" y "oso" son el mismo proveedor', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-provider')
      const r1 = await (handler(null, { name: 'OSO' }) as Promise<{ ok: boolean; data: { id: string } }>)
      const r2 = await (handler(null, { name: 'oso' }) as Promise<{ ok: boolean; data: { id: string } }>)
      expect(r1.data.id).toBe(r2.data.id)
    })

    it('rechaza payload inválido — nombre vacío', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:create-provider')
      const result = await (handler(null, { name: '' }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })
  })

  // -------------------------------------------------------------------------
  describe('UPDATE_PROVIDER (ipc:update-provider)', () => {
    it('actualiza el nombre de pantalla (no la identidad nameKey/id)', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const id = providerIdFromName('oso')
      db.insert(providers).values({ id, name: 'Oso', nameKey: 'oso', createdAt: new Date().toISOString() }).run()

      const handler = getHandler('ipc:update-provider')
      const result = await (handler(null, { id, name: 'Oso Grande' }) as Promise<{ ok: boolean; data: { name: string } }>)
      expect(result.ok).toBe(true)
      expect(result.data.name).toBe('Oso Grande')

      const row = db.select().from(providers).all()[0]
      expect(row.id).toBe(id) // id no cambia
      expect(row.nameKey).toBe('oso') // nameKey tampoco
      expect(row.name).toBe('Oso Grande')
    })

    it('retorna NOT_FOUND si el id no existe', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:update-provider')
      const result = await (handler(null, { id: 'no-existe', name: 'X' }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })
  })

  // -------------------------------------------------------------------------
  describe('ARCHIVE_PROVIDER (ipc:archive-provider)', () => {
    it('archiva un proveedor existente', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const id = providerIdFromName('a archivar')
      db.insert(providers).values({ id, name: 'A Archivar', nameKey: 'a archivar', createdAt: new Date().toISOString() }).run()

      const handler = getHandler('ipc:archive-provider')
      const result = await (handler(null, { id }) as Promise<{ ok: boolean }>)
      expect(result.ok).toBe(true)

      const row = db.select().from(providers).all()[0]
      expect(row.archivedAt).toBeTruthy()
    })

    it('retorna NOT_FOUND si el id no existe', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:archive-provider')
      const result = await (handler(null, { id: 'no-existe' }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })
  })

  describe('UNARCHIVE_PROVIDER (ipc:unarchive-provider)', () => {
    it('restaura un proveedor archivado', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const id = providerIdFromName('a restaurar')
      db.insert(providers).values({
        id,
        name: 'A Restaurar',
        nameKey: 'a restaurar',
        createdAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
      }).run()

      const handler = getHandler('ipc:unarchive-provider')
      const result = await (handler(null, { id }) as Promise<{ ok: boolean }>)
      expect(result.ok).toBe(true)
      expect(db.select().from(providers).all()[0]?.archivedAt).toBeNull()
    })
  })

  describe('DELETE_PROVIDER (ipc:delete-provider)', () => {
    it('oculta el proveedor y conserva el historial de deuda', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const id = providerIdFromName('oso borrar')
      const now = new Date().toISOString()
      db.insert(providers).values({ id, name: 'Oso Borrar', nameKey: 'oso borrar', createdAt: now }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-del-1',
        storeId: 'store-001',
        providerId: id,
        provider: 'Oso Borrar',
        type: 'debt',
        amount: 500000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:delete-provider')
      const result = await (handler(null, { id }) as Promise<{ ok: boolean }>)
      expect(result.ok).toBe(true)

      const row = db.select().from(providers).all()[0]
      expect(row?.archivedAt).toBeTruthy()
      const events = db.select().from(providerDebtEvents).all()
      expect(events).toHaveLength(1)
      expect(events[0]?.amount).toBe(500000)
    })

    it('cajera recibe FORBIDDEN', async () => {
      const handler = getHandler('ipc:delete-provider')
      const result = await (handler(null, { id: 'x' }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })
  })

  // -------------------------------------------------------------------------
  describe('GET_PROVIDERS_WITH_DEBT (ipc:get-providers-with-debt)', () => {
    it('rechaza si no es admin', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:get-providers-with-debt')
      const result = await (handler(null) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })

    it('admin recibe lista (vacía si no hay eventos)', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:get-providers-with-debt')
      const result = await (handler(null) as Promise<{ ok: boolean; data: unknown[] }>)
      expect(result.ok).toBe(true)
      expect(result.data).toBeInstanceOf(Array)
    })

    it('incluye teléfono y notas del proveedor', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const pid = providerIdFromName('frigorifico')
      const now = new Date().toISOString()
      db.insert(providers).values({
        id: pid,
        name: 'Frigorifico',
        nameKey: 'frigorifico',
        phone: '1145678901',
        notes: 'martes y viernes',
        createdAt: now,
      }).run()

      const handler = getHandler('ipc:get-providers-with-debt')
      const result = await (handler(null) as Promise<{
        ok: boolean
        data: Array<{ name: string; phone?: string; notes?: string }>
      }>)
      expect(result.ok).toBe(true)
      const row = result.data.find(p => p.name === 'Frigorifico')
      expect(row?.phone).toBe('1145678901')
      expect(row?.notes).toBe('martes y viernes')
    })

    it('el total es la suma de locales; un saldo a favor no se oculta como sin deuda', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const pid = providerIdFromName('oso')
      const now = new Date().toISOString()
      db.insert(providers).values({ id: pid, name: 'Oso', nameKey: 'oso', createdAt: now }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-debt-sm',
        storeId: 'store-002',
        providerId: pid,
        provider: 'Oso',
        type: 'debt',
        amount: 500000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-pay-cam',
        storeId: 'store-001',
        providerId: pid,
        provider: 'Oso',
        type: 'payment',
        amount: 475000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-providers-with-debt')
      const result = await (handler(null) as Promise<{
        ok: boolean
        data: Array<{ total: number; perStore: Array<{ storeId: string; balance: number }> }>
      }>)
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].total).toBe(25000)
      const cam = result.data[0].perStore.find(s => s.storeId === 'store-001')
      const sm = result.data[0].perStore.find(s => s.storeId === 'store-002')
      expect(cam?.balance).toBe(-475000)
      expect(sm?.balance).toBe(500000)
    })

    it('excluye archivados salvo que se pida includeArchived', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const pid = providerIdFromName('archivado debt')
      const now = new Date().toISOString()
      db.insert(providers).values({
        id: pid,
        name: 'Archivado Debt',
        nameKey: 'archivado debt',
        createdAt: now,
        archivedAt: now,
      }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-arch',
        storeId: 'store-001',
        providerId: pid,
        provider: 'Archivado Debt',
        type: 'debt',
        amount: 1000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:get-providers-with-debt')
      const hidden = await (handler(null) as Promise<{ ok: boolean; data: Array<{ id: string }> }>)
      expect(hidden.data.find(p => p.id === pid)).toBeUndefined()

      const shown = await (handler(null, { includeArchived: true }) as Promise<{
        ok: boolean
        data: Array<{ id: string; archivedAt?: string; total: number }>
      }>)
      const row = shown.data.find(p => p.id === pid)
      expect(row).toBeTruthy()
      expect(row?.archivedAt).toBeTruthy()
      expect(row?.total).toBe(1000)
    })
  })

  // -------------------------------------------------------------------------
  describe('GET_PROVIDER_DEBT_HISTORY (ipc:get-provider-debt-history)', () => {
    const SHIFT_ID = 'shift-001'
    const PROVIDER_ID = providerIdFromName('proveedor test')

    function insertTestData() {
      const now = new Date().toISOString()
      db.insert(shifts).values({
        id: SHIFT_ID,
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 0,
      }).run()
      db.insert(providers).values({
        id: PROVIDER_ID,
        name: 'Proveedor Test',
        nameKey: 'proveedor test',
        createdAt: now,
      }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-001',
        storeId: 'store-001',
        providerId: PROVIDER_ID,
        provider: 'Proveedor Test',
        type: 'debt',
        amount: 5000,
        shiftId: SHIFT_ID,
        createdAt: now,
        createdBy: 'user-001',
      }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-002',
        storeId: 'store-002',
        providerId: PROVIDER_ID,
        provider: 'Proveedor Test',
        type: 'payment',
        amount: 2000,
        shiftId: SHIFT_ID,
        createdAt: new Date(Date.now() - 1000).toISOString(),
        createdBy: 'admin-001',
      }).run()
    }

    it('payload inválido retorna INVALID_PAYLOAD', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:get-provider-debt-history')
      const result = await (handler(null, { providerId: '' }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('cajera no-admin recibe FORBIDDEN', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:get-provider-debt-history')
      const result = await (handler(null, { providerId: PROVIDER_ID }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })

    it('admin recibe historial con eventos del proveedor ordenados por fecha desc', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      insertTestData()

      const handler = getHandler('ipc:get-provider-debt-history')
      const result = await (handler(null, { providerId: PROVIDER_ID }) as Promise<{
        ok: boolean
        data: Array<{
          id: string
          type: string
          amount: number
          storeName: string
          createdByName: string
        }>
      }>)

      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
      // Primer elemento es el más reciente (evt-001 se insertó con Date.now())
      expect(result.data[0].id).toBe('evt-001')
      expect(result.data[0].type).toBe('debt')
      expect(result.data[0].amount).toBe(5000)
      expect(result.data[0].storeName).toBe('Local A')
      expect(result.data[0].createdByName).toBe('Cajera Test')

      expect(result.data[1].id).toBe('evt-002')
      expect(result.data[1].type).toBe('payment')
      expect(result.data[1].amount).toBe(2000)
      expect(result.data[1].storeName).toBe('Local B')
      expect(result.data[1].createdByName).toBe('Admin')
    })

    it('no hay sesión retorna NO_SESSION', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:get-provider-debt-history')
      const result = await (handler(null, { providerId: PROVIDER_ID }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })

    it('proveedor sin eventos retorna array vacío', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const now = new Date().toISOString()
      db.insert(providers).values({
        id: PROVIDER_ID,
        name: 'Proveedor Test',
        nameKey: 'proveedor test',
        createdAt: now,
      }).run()

      const handler = getHandler('ipc:get-provider-debt-history')
      const result = await (handler(null, { providerId: PROVIDER_ID }) as Promise<{ ok: boolean; data: unknown[] }>)
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  describe('SETTLE_PROVIDER_DEBT (ipc:settle-provider-debt)', () => {
    const PROVIDER_ID = providerIdFromName('proveedor settle')

    function insertProvider() {
      db.insert(providers).values({
        id: PROVIDER_ID,
        name: 'Proveedor Settle',
        nameKey: 'proveedor settle',
        createdAt: new Date().toISOString(),
      }).run()
    }

    it('payload inválido retorna INVALID_PAYLOAD', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:settle-provider-debt')
      const result = await (handler(null, { providerId: PROVIDER_ID, amount: -100 }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('cajera recibe FORBIDDEN', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:settle-provider-debt')
      const result = await (handler(null, { providerId: PROVIDER_ID, amount: 5000 }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })

    it('sin sesión retorna NO_SESSION', async () => {
      vi.mocked(getActiveSession).mockReturnValue(null)
      const handler = getHandler('ipc:settle-provider-debt')
      const result = await (handler(null, { providerId: PROVIDER_ID, amount: 5000 }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SESSION')
    })

    it('admin con sesión inserta evento payment en SQLite y retorna eventId', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      insertProvider()

      const handler = getHandler('ipc:settle-provider-debt')
      const result = await (handler(null, { providerId: PROVIDER_ID, amount: 8000 }) as Promise<{
        ok: boolean
        data: { eventId: string }
      }>)

      expect(result.ok).toBe(true)
      expect(result.data.eventId).toBeTruthy()

      const allEvents = db.select().from(providerDebtEvents).all()
      expect(allEvents).toHaveLength(1)
      const evt = allEvents[0]
      expect(evt.type).toBe('payment')
      expect(evt.amount).toBe(8000)
      expect(evt.providerId).toBe(PROVIDER_ID)
      expect(evt.storeId).toBe('store-001')
      expect(evt.shiftId).toBeNull()
      expect(evt.syncedAt).toBeNull()
    })
  })

  describe('RECORD_PROVIDER_LEDGER (ipc:record-provider-ledger)', () => {
    it('rechaza payload malformado', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:record-provider-ledger')
      const result = await (handler(null, { providerId: '', storeId: 'store-001', type: 'debt', amount: 1 }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('cajera recibe FORBIDDEN', async () => {
      const handler = getHandler('ipc:record-provider-ledger')
      const result = await (handler(null, {
        providerId: 'x',
        storeId: 'store-001',
        type: 'debt',
        amount: 1000,
      }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })

    it('admin registra deuda manual sin caja', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const pid = providerIdFromName('manual debt')
      const now = new Date().toISOString()
      db.insert(providers).values({ id: pid, name: 'Manual Debt', nameKey: 'manual debt', createdAt: now }).run()

      const handler = getHandler('ipc:record-provider-ledger')
      const result = await (handler(null, {
        providerId: pid,
        storeId: 'store-001',
        type: 'debt',
        amount: 350000,
      }) as Promise<{ ok: boolean; data: { eventId: string } }>)
      expect(result.ok).toBe(true)
      const evt = db.select().from(providerDebtEvents).all()[0]
      expect(evt?.type).toBe('debt')
      expect(evt?.amount).toBe(350000)
      expect(evt?.expenseId).toBeNull()
    })

    it('guarda la nota de ajuste de admin', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const pid = providerIdFromName('ajuste nota')
      const now = new Date().toISOString()
      db.insert(providers).values({ id: pid, name: 'Ajuste Nota', nameKey: 'ajuste nota', createdAt: now }).run()

      const handler = getHandler('ipc:record-provider-ledger')
      const result = await (handler(null, {
        providerId: pid,
        storeId: 'store-001',
        type: 'payment',
        amount: 80000,
        notes: 'Ajuste de admin: dejó la deuda en $ 10.000',
      }) as Promise<{ ok: boolean }>)
      expect(result.ok).toBe(true)
      expect(db.select().from(providerDebtEvents).all()[0]?.notes).toBe(
        'Ajuste de admin (Admin): dejó la deuda en $ 10.000',
      )
    })
  })

  describe('COMPENSATE_PROVIDER_STORES (ipc:compensate-provider-stores)', () => {
    it('cajera sin turno recibe FORBIDDEN', async () => {
      const handler = getHandler('ipc:compensate-provider-stores')
      const result = await (handler(null, { providerId: 'x' }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('FORBIDDEN')
    })

    it('cajera con turno puede compensar', async () => {
      const now = new Date().toISOString()
      db.insert(shifts).values({
        id: 'shift-comp',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 10000,
        source: 'desktop',
      }).run()
      vi.mocked(getActiveSession).mockReturnValue({
        ...CASHIER_SESSION,
        shiftId: 'shift-comp',
      } as ReturnType<typeof getActiveSession>)
      const pid = providerIdFromName('compenso cajera')
      db.insert(providers).values({ id: pid, name: 'Compenso Cajera', nameKey: 'compenso cajera', createdAt: now }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-cred-c',
        storeId: 'store-001',
        providerId: pid,
        provider: 'Compenso Cajera',
        type: 'payment',
        amount: 50000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-debt-c',
        storeId: 'store-002',
        providerId: pid,
        provider: 'Compenso Cajera',
        type: 'debt',
        amount: 50000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:compensate-provider-stores')
      const result = await (handler(null, { providerId: pid }) as Promise<{ ok: boolean; data: { events: number } }>)
      expect(result.ok).toBe(true)
      expect(result.data.events).toBe(2)
    })

    it('aplica crédito de un local contra deuda de otro', async () => {
      vi.mocked(getActiveSession).mockReturnValue(ADMIN_SESSION as ReturnType<typeof getActiveSession>)
      const pid = providerIdFromName('compenso')
      const now = new Date().toISOString()
      db.insert(providers).values({ id: pid, name: 'Compenso', nameKey: 'compenso', createdAt: now }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-cred',
        storeId: 'store-001',
        providerId: pid,
        provider: 'Compenso',
        type: 'payment',
        amount: 50000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()
      db.insert(providerDebtEvents).values({
        id: 'evt-debt',
        storeId: 'store-002',
        providerId: pid,
        provider: 'Compenso',
        type: 'debt',
        amount: 50000,
        createdAt: now,
        createdBy: 'user-001',
      }).run()

      const handler = getHandler('ipc:compensate-provider-stores')
      const result = await (handler(null, { providerId: pid }) as Promise<{ ok: boolean; data: { events: number } }>)
      expect(result.ok).toBe(true)
      expect(result.data.events).toBe(2)

      const debtHandler = getHandler('ipc:get-providers-with-debt')
      const debt = await (debtHandler(null) as Promise<{
        ok: boolean
        data: Array<{ total: number; perStore: Array<{ storeId: string; balance: number }> }>
      }>)
      expect(debt.data[0].total).toBe(0)
      expect(debt.data[0].perStore.every(s => s.balance === 0)).toBe(true)
    })
  })

  describe('PAY_PROVIDER_FROM_SHIFT (ipc:pay-provider-from-shift)', () => {
    it('sin turno retorna NO_SHIFT', async () => {
      vi.mocked(getActiveSession).mockReturnValue(CASHIER_SESSION as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:pay-provider-from-shift')
      const result = await (handler(null, {
        providerId: 'x',
        allocations: [{ storeId: 'store-001', amount: 1000 }],
      }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('NO_SHIFT')
    })

    it('rechaza payload sin allocations', async () => {
      vi.mocked(getActiveSession).mockReturnValue({
        ...CASHIER_SESSION,
        shiftId: 'shift-001',
      } as ReturnType<typeof getActiveSession>)
      const handler = getHandler('ipc:pay-provider-from-shift')
      const result = await (handler(null, { providerId: 'x', allocations: [] }) as Promise<{ ok: boolean; code: string }>)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PAYLOAD')
    })

    it('crea gasto de caja y pagos por local', async () => {
      const now = new Date().toISOString()
      db.insert(shifts).values({
        id: 'shift-pay',
        storeId: 'store-001',
        userId: 'user-001',
        shiftType: 'morning',
        startedAt: now,
        openingCash: 10000,
        source: 'desktop',
      }).run()
      const pid = providerIdFromName('pago turno')
      db.insert(providers).values({ id: pid, name: 'Pago Turno', nameKey: 'pago turno', createdAt: now }).run()
      vi.mocked(getActiveSession).mockReturnValue({
        ...CASHIER_SESSION,
        shiftId: 'shift-pay',
      } as ReturnType<typeof getActiveSession>)

      const handler = getHandler('ipc:pay-provider-from-shift')
      const result = await (handler(null, {
        providerId: pid,
        allocations: [
          { storeId: 'store-001', amount: 50000 },
          { storeId: 'store-002', amount: 300000 },
        ],
      }) as Promise<{ ok: boolean; data: { expenseId: string } }>)
      expect(result.ok).toBe(true)

      const expenseRows = db.select().from(expenses).all()
      expect(expenseRows).toHaveLength(1)
      expect(expenseRows[0]?.amount).toBe(350000)
      expect(expenseRows[0]?.providerId).toBe(pid)

      const payEvents = db.select().from(providerDebtEvents).all()
      expect(payEvents).toHaveLength(2)
      expect(payEvents.every(e => e.type === 'payment')).toBe(true)
      expect(payEvents.reduce((s, e) => s + e.amount, 0)).toBe(350000)
    })
  })
})
