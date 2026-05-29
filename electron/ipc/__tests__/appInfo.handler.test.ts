import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    getVersion: vi.fn().mockReturnValue('0.1.0'),
  },
}))

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    initialize: vi.fn(),
    transports: { file: { level: 'info' } },
  },
}))

import { ipcMain, app } from 'electron'
import { registerAppInfoHandler } from '../appInfo.handler'

describe('appInfo.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registra el handler en el canal correcto', () => {
    registerAppInfoHandler()
    expect(ipcMain.handle).toHaveBeenCalledWith('ipc:get-app-info', expect.any(Function))
  })

  it('retorna version y env correctos con payload undefined', async () => {
    process.env['APP_ENV'] = 'sandbox'
    registerAppInfoHandler()

    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1] as (
      _event: unknown,
      payload: unknown
    ) => unknown
    const result = await handler({}, undefined)

    expect(result).toEqual({
      ok: true,
      data: { version: '0.1.0', env: 'sandbox' },
    })
    expect(app.getVersion).toHaveBeenCalled()
  })

  it('retorna error si el payload es inesperadamente no-undefined', async () => {
    registerAppInfoHandler()

    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1] as (
      _event: unknown,
      payload: unknown
    ) => unknown
    const result = await handler({}, { unexpected: 'data' })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })
})
