import { app, BrowserWindow } from 'electron'
import path from 'path'
import log from 'electron-log'
import { registerAllHandlers } from './ipc/index'
import { initHardwareManager, getHardwareManager } from './hardware/hardwareManager'

log.initialize({ preload: true })
log.transports.file.level = 'info'
log.info('[main] Iniciando app', { version: app.getVersion(), env: process.env['APP_ENV'] })

const isDev = process.env['NODE_ENV'] === 'development'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    titleBarStyle: 'default',
  })

  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  log.info('[main] app ready')

  const manager = await initHardwareManager()
  registerAllHandlers(manager)
  await manager.start()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  try {
    await getHardwareManager().stop()
  } catch {
    // El manager puede no estar inicializado si la app cerró antes del ready
  }
  if (process.platform !== 'darwin') app.quit()
})
