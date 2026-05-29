import { app, BrowserWindow } from 'electron'
import path from 'path'
import log from 'electron-log'
import { registerAllHandlers } from './ipc/index'
import { initHardwareManager, getHardwareManager } from './hardware/hardwareManager'
import { loadBusinessConfig } from './businessConfig'
import { getDbPath } from './db/client'
import { runMigrations } from './db/migrate'
import { verifyLicense } from './licensing/license'
import { signInAnon, checkInstallationStatus } from './licensing/installation'
import { setInitStatus } from './ipc/initStatus.handler'
import type { InitStatus } from '../src/types/hw-api'

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
    autoHideMenuBar: true,
  })

  win.once('ready-to-show', () => win.show())

  const devServerUrl = process.env['VITE_DEV_SERVER_URL']
  if (isDev && devServerUrl) {
    win.loadURL(devServerUrl)
    win.webContents.openDevTools()
  } else if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  return win
}

/**
 * Calcula el InitStatus al arrancar.
 * En sandbox: siempre válido, sin Firebase.
 * En producción: verifica licencia y estado de activación contra Firebase.
 */
async function computeInitStatus(): Promise<InitStatus> {
  const config = loadBusinessConfig()
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'

  if (APP_ENV === 'sandbox') {
    return {
      businessName: config.business_name,
      defaultStoreId: config.default_store_id,
      licenseKey: config.license_key,
      licenseValid: true,
      needsActivation: false,
    }
  }

  // Producción: verificar licencia y activación contra Firebase
  const licenseStatus = await verifyLicense(config.license_key)

  if (!licenseStatus.valid) {
    return {
      businessName: config.business_name,
      defaultStoreId: config.default_store_id,
      licenseKey: config.license_key,
      licenseValid: false,
      licenseReason: licenseStatus.reason,
      licenseMessage: licenseStatus.message,
      needsActivation: false,
    }
  }

  try {
    const uid = await signInAnon()
    const installation = await checkInstallationStatus(config.license_key, uid)
    return {
      businessName: config.business_name,
      defaultStoreId: config.default_store_id,
      licenseKey: config.license_key,
      licenseValid: true,
      needsActivation: !installation.activated,
    }
  } catch (err) {
    log.error('[main] Error al verificar instalación', err)
    // Si Firebase falla pero la licencia fue válida, permitir acceso sin activación check
    return {
      businessName: config.business_name,
      defaultStoreId: config.default_store_id,
      licenseKey: config.license_key,
      licenseValid: true,
      needsActivation: false,
    }
  }
}

app.whenReady().then(async () => {
  log.info('[main] app ready')

  // 1. Inicializar DB con migraciones
  const dbPath = getDbPath()
  const migrateResult = await runMigrations(dbPath)
  if (!migrateResult.ok) {
    log.error('[main] Falló la migración de DB — la app puede no funcionar correctamente', migrateResult.error)
  }

  // 2. Calcular estado de inicialización (licencia, activación, config)
  const initStatus = await computeInitStatus()
  setInitStatus(initStatus)
  log.info('[main] InitStatus calculado', {
    licenseValid: initStatus.licenseValid,
    needsActivation: initStatus.needsActivation,
  })

  // 3. Inicializar hardware y registrar handlers IPC
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
