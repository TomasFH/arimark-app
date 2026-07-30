import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('../../licensing/firebase', () => ({
  isFirebaseAvailable: vi.fn().mockReturnValue(false),
  getFirebaseApp: vi.fn(),
}))
vi.mock('../../businessConfig', () => ({ getBusinessConfig: vi.fn().mockReturnValue({ tenant_id: 'test-key' }) }))

import { ipcMain } from 'electron'
import { registerCashiersHandlers } from '../cashiers.handler'

type HandlerFn = (event: unknown, payload?: unknown) => unknown
function getHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler no registrado: ${channel}`)
  return call[1] as HandlerFn
}

// Contador para generar emails únicos sin depender de Date.now() (puede repetirse en tests rápidos)
let _seq = 0
function uniqueEmail(prefix: string) { return `${prefix}_${++_seq}@test.com` }

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
    }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VALIDATION_ERROR')
  })

  it('CREATE_CASHIER crea una cajera en dev y la lista devuelve una más', async () => {
    const before = (await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: unknown[] }).data.length
    const create = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Nueva Cajera',
      email: uniqueEmail('nueva'),
    }) as { ok: boolean; data: { uid: string } }
    expect(create.ok).toBe(true)
    expect(create.data.uid).toBeTruthy()
    const after = (await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: unknown[] }).data.length
    expect(after).toBe(before + 1)
  })

  it('TOGGLE_CASHIER desactiva una cajera creada', async () => {
    const c = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Cajera Toggle', email: uniqueEmail('toggle_off'),
    }) as { ok: boolean; data: { uid: string } }
    expect(c.ok).toBe(true)
    const toggle = await getHandler('ipc:toggle-cashier')({}, { uid: c.data.uid, active: false }) as { ok: boolean }
    expect(toggle.ok).toBe(true)
    const list = await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: { uid: string; active: boolean }[] }
    expect(list.data.find(x => x.uid === c.data.uid)?.active).toBe(false)
  })

  it('TOGGLE_CASHIER reactiva una cajera inactiva', async () => {
    const c = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Cajera Toggle', email: uniqueEmail('toggle_on'),
    }) as { ok: boolean; data: { uid: string } }
    expect(c.ok).toBe(true)
    await getHandler('ipc:toggle-cashier')({}, { uid: c.data.uid, active: false })
    const toggle = await getHandler('ipc:toggle-cashier')({}, { uid: c.data.uid, active: true }) as { ok: boolean }
    expect(toggle.ok).toBe(true)
    const list = await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: { uid: string; active: boolean }[] }
    expect(list.data.find(x => x.uid === c.data.uid)?.active).toBe(true)
  })

  it('TOGGLE_CASHIER con UID inexistente retorna NOT_FOUND', async () => {
    const result = await getHandler('ipc:toggle-cashier')({}, { uid: 'no-existe', active: false }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_FOUND')
  })

  it('TOGGLE_CASHIER rechaza payload inválido', async () => {
    const result = await getHandler('ipc:toggle-cashier')({}, { uid: '' }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VALIDATION_ERROR')
  })

  it('DELETE_CASHIER elimina una cajera y desaparece de la lista', async () => {
    const c = await getHandler('ipc:create-cashier')({}, {
      displayName: 'Borrar Test', email: uniqueEmail('delete'),
    }) as { ok: boolean; data: { uid: string } }
    expect(c.ok).toBe(true)
    const del = await getHandler('ipc:delete-cashier')({}, { uid: c.data.uid }) as { ok: boolean }
    expect(del.ok).toBe(true)
    const list = await getHandler('ipc:list-cashiers')({}) as { ok: boolean; data: { uid: string }[] }
    expect(list.data.find(x => x.uid === c.data.uid)).toBeUndefined()
  })

  it('DELETE_CASHIER con UID inexistente retorna NOT_FOUND', async () => {
    const result = await getHandler('ipc:delete-cashier')({}, { uid: 'no-existe' }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_FOUND')
  })

  it('DELETE_CASHIER rechaza payload inválido', async () => {
    const result = await getHandler('ipc:delete-cashier')({}, { uid: '' }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VALIDATION_ERROR')
  })
})
