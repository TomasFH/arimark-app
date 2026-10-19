import { describe, it, expect, vi, beforeEach } from 'vitest'

const close = vi.fn()
const preventDefault = vi.fn()
const send = vi.fn()
const win = {
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false, send },
  on: vi.fn(),
  close,
}

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => [win]) },
}))

import { app, BrowserWindow, ipcMain } from 'electron'
import { attachQuitConfirm, registerAppQuitHandlers } from '../appQuit.handler'

describe('appQuit.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Alt+F4 pide confirmación y no cierra hasta que se acepta', async () => {
    registerAppQuitHandlers()
    attachQuitConfirm(win as unknown as BrowserWindow)

    const onClose = win.on.mock.calls.find(call => call[0] === 'close')?.[1] as (event: { preventDefault: () => void }) => void
    onClose({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('ipc:app-quit-requested')
    expect(close).not.toHaveBeenCalled()

    const confirm = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'ipc:confirm-app-quit')?.[1] as () => Promise<unknown>
    await confirm()
    expect(BrowserWindow.getAllWindows).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()

    preventDefault.mockClear()
    onClose({ preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
  })
})
