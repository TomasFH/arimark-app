/**
 * Aviso main → renderer sin romper tests (electron puede no estar mockeado).
 */
export function notifyRenderer(channel: string, payload?: unknown): void {
  try {
    // require dinámico: en vitest no siempre hay BrowserWindow.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      BrowserWindow?: {
        getAllWindows: () => Array<{
          isDestroyed: () => boolean
          webContents: { send: (ch: string, data?: unknown) => void }
        }>
      }
    }
    const windows = electron.BrowserWindow?.getAllWindows?.() ?? []
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  } catch {
    // sin electron (tests)
  }
}
