import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { ipcMain } from 'electron'
import { setInitStatus, registerInitStatusHandler } from '../initStatus.handler'
import type { InitStatus } from '../../../src/types/hw-api'

type HandlerFn = (_event: unknown) => unknown

function getHandler(): HandlerFn {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = calls.find(c => c[0] === 'ipc:get-init-status')
  if (!call) throw new Error('Handler ipc:get-init-status no registrado')
  return call[1] as HandlerFn
}

const sandboxStatus: InitStatus = {
  businessName: 'Negocio de Prueba (Sandbox)',
  defaultStoreId: '00000000-0000-0000-0000-000000000001',
  licenseKey: 'SANDBOX-0000-0000-0000',
  licenseValid: true,
  needsActivation: false,
}

describe('initStatus.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerInitStatusHandler()
  })

  it('retorna error si setInitStatus no fue llamado', () => {
    // Importar fresco sin haber llamado setInitStatus
    const handler = getHandler()
    const result = handler({}) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no terminó de inicializarse/)
  })

  it('retorna el status correctamente tras setInitStatus', () => {
    setInitStatus(sandboxStatus)
    const handler = getHandler()
    const result = handler({}) as { ok: boolean; data?: InitStatus }
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(sandboxStatus)
  })

  it('retorna licenseValid: false cuando la licencia es inválida', () => {
    const expiredStatus: InitStatus = {
      ...sandboxStatus,
      licenseValid: false,
      licenseReason: 'expired',
      licenseMessage: 'Licencia vencida.',
    }
    setInitStatus(expiredStatus)
    const handler = getHandler()
    const result = handler({}) as { ok: boolean; data?: InitStatus }
    expect(result.ok).toBe(true)
    expect(result.data?.licenseValid).toBe(false)
    expect(result.data?.licenseReason).toBe('expired')
  })

  it('retorna needsActivation: true cuando la instalación no está activada', () => {
    const notActivated: InitStatus = {
      ...sandboxStatus,
      needsActivation: true,
    }
    setInitStatus(notActivated)
    const handler = getHandler()
    const result = handler({}) as { ok: boolean; data?: InitStatus }
    expect(result.ok).toBe(true)
    expect(result.data?.needsActivation).toBe(true)
  })
})
