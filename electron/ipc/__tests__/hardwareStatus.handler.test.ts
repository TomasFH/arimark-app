import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}))

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    initialize: vi.fn(),
    transports: { file: { level: 'info' } },
  },
}))

import { ipcMain, BrowserWindow } from 'electron'
import {
  registerHardwareStatusHandler,
  setHardwareStatus,
  getHardwareStatus,
} from '../hardwareStatus.handler'

describe('hardwareStatus.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna estado inicial disconnected', () => {
    const status = getHardwareStatus()
    expect(status.scale).toBe('disconnected')
    expect(status.fiscal).toBe('disconnected')
  })

  it('actualiza estado y notifica ventanas', () => {
    const mockSend = vi.fn()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: mockSend } } as unknown as InstanceType<typeof BrowserWindow>,
    ])

    setHardwareStatus({ scale: 'connected' })
    const status = getHardwareStatus()

    expect(status.scale).toBe('connected')
    expect(status.fiscal).toBe('disconnected')
    expect(mockSend).toHaveBeenCalledWith(
      'ipc:hardware-status-change',
      expect.objectContaining({ scale: 'connected' })
    )
  })

  it('el handler IPC responde con estado actual', async () => {
    registerHardwareStatusHandler()

    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1] as (
      _event: unknown,
      payload: unknown
    ) => unknown
    const result = await handler({}, undefined)

    expect(result).toMatchObject({ ok: true, data: expect.objectContaining({ scale: expect.any(String) }) })
  })

  it('rechaza payload malformado', async () => {
    registerHardwareStatusHandler()

    const handler = vi.mocked(ipcMain.handle).mock.calls[0][1] as (
      _event: unknown,
      payload: unknown
    ) => unknown
    const result = await handler({}, 'unexpected-string')

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
  })
})
