import { app, BrowserWindow, ipcMain, type BrowserWindow as BrowserWindowType } from 'electron'
import { IPC } from './channels'

let allowQuit = false

/** Alt+F4 y la X piden confirmación en la ventana. app.quit() (actualización) cierra directo. */
export function attachQuitConfirm(win: BrowserWindowType): void {
  win.on('close', event => {
    if (allowQuit) return
    event.preventDefault()
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(IPC.APP_QUIT_REQUESTED)
  })
}

export function registerAppQuitHandlers(): void {
  app.on('before-quit', () => {
    allowQuit = true
  })
  ipcMain.handle(IPC.CONFIRM_APP_QUIT, () => {
    allowQuit = true
    for (const win of BrowserWindow.getAllWindows()) win.close()
    return { ok: true as const, data: undefined }
  })
}
