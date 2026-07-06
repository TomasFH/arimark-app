import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('../../licensing/firebase', () => ({
  isFirebaseAvailable: vi.fn().mockReturnValue(false),
  getFirebaseApp: vi.fn(),
}))
vi.mock('../../businessConfig', () => ({ getBusinessConfig: vi.fn().mockReturnValue({ license_key: 'test-key' }) }))

import { ipcMain } from 'electron'
import { registerCashiersHandlers } from '../cashiers.handler'

type HandlerFn = (event: unknown, payload?: unknown) => unknown
function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

describe('cashiers.handler (dev mode — mocks en memoria)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerCashiersHandlers()
  })

  it('LIST_CASHIERS devuelve las cajeras dev por defecto', async () => {
    const result = await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data.length).toBeGreaterThan(0)
  })

  it('CREATE_CASHIER rechaza payload inválido (email mal formado)', async () => {
    const result = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Test',
      email: 'no-es-email',
      password: '123456',
      authorizedStores: ['local1'],
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VALIDATION_ERROR')
  })

  it('CREATE_CASHIER rechaza contraseña menor a 6 caracteres', async () => {
    const result = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Test',
      email: 'nueva@test.com',
      password: '12345',
      authorizedStores: ['local1'],
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VALIDATION_ERROR')
  })

  it('CREATE_CASHIER crea una cajera en dev y la lista devuelve una más', async () => {
    const before = (await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: unknown[] }).data.length

    const uniqueEmail = `nueva_unica_${Date.now()}@test.com`
    const create = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Nueva Cajera',
      email: uniqueEmail,
      password: 'segura123',
      authorizedStores: ['local1'],
    }) as { ok: boolean; data: { uid: string } }
    expect(create.ok).toBe(true)
    expect(create.data.uid).toBeTruthy()

    const after = (await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: unknown[] }).data.length
    expect(after).toBe(before + 1)
  })

  it('TOGGLE_CASHIER desactiva una cajera activa', async () => {
    // Crear una cajera conocida para evitar depender del estado global del módulo
    const email = `toggle_test_${Date.now()}@test.com`
    const created = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Cajera Toggle',
      email,
      password: 'pass123',
      authorizedStores: ['local1'],
    }) as { ok: boolean; data: { uid: string } }
    expect(created.ok).toBe(true)
    const uid = created.data.uid

    const toggle = await getHandler('ipc:toggle-cashier')({}, { uid, active: false }) as { ok: boolean }
    expect(toggle.ok).toBe(true)

    const list = await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: { uid: string; active: boolean }[] }
    const updated = list.data.find(c => c.uid === uid)
    expect(updated?.active).toBe(false)
  })

  it('TOGGLE_CASHIER reactiva una cajera inactiva', async () => {
    const email = `reactivate_test_${Date.now()}@test.com`
    const created = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Cajera Reactiva',
      email,
      password: 'pass123',
      authorizedStores: ['local1'],
    }) as { ok: boolean; data: { uid: string } }
    expect(created.ok).toBe(true)
    const uid = created.data.uid

    // Desactivar primero
    await getHandler('ipc:toggle-cashier')({}, { uid, active: false })
    // Luego reactivar
    const toggle = await getHandler('ipc:toggle-cashier')({}, { uid, active: true }) as { ok: boolean }
    expect(toggle.ok).toBe(true)

    const list = await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: { uid: string; active: boolean }[] }
    const updated = list.data.find(c => c.uid === uid)
    expect(updated?.active).toBe(true)
  })

  it('TOGGLE_CASHIER con UID inexistente retorna NOT_FOUND', async () => {
    const result = await getHandler('ipc:toggle-cashier')({}, {
      uid: 'uid-que-no-existe',
      active: false,
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_FOUND')
  })

  it('TOGGLE_CASHIER rechaza payload inválido', async () => {
    const result = await getHandler('ipc:toggle-cashier')({}, { uid: '' }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VALIDATION_ERROR')
  })
})

