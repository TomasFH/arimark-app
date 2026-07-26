import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInMemoryDb } from '../../db/__tests__/helpers/inMemoryDb'
import { stores, users, providers, providerDebtEvents, shifts } from '../../db/schema'

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
  getBusinessConfig: vi.fn(() => ({ license_key: 'test-license', default_store_id: 'store-001' })),
}))

vi.mock('../../licensing/providerSync', () => ({
  pushUnsyncedProviders: vi.fn().mockResolvedValue(undefined),
  pushUnsyncedDebtEvents: vi.fn().mockResolvedValue(undefined),
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
})
