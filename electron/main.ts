import { app, BrowserWindow } from 'electron'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { eq } from 'drizzle-orm'
import { registerAllHandlers } from './ipc/index'
import { IPC } from './ipc/channels'
import { initHardwareManager, getHardwareManager } from './hardware/hardwareManager'
import { loadBusinessConfig } from './businessConfig'
import { getDbPath, getDb } from './db/client'
import { runMigrations } from './db/migrate'
import { verifyLicense } from './licensing/license'
import { signInAnon, checkInstallationStatus } from './licensing/installation'
import { setInitStatus } from './ipc/initStatus.handler'
import { getActiveSession } from './activeSession'
import { products, scaleTickets } from './db/schema'
import type { InitStatus, ScaleTicketData } from '../src/types/hw-api'

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

  // 1. Inicializar DB con migraciones.
  //    app.getAppPath() apunta al raíz de la app (repo en dev, asar en prod),
  //    donde electron-builder copia la carpeta drizzle/.
  const dbPath = getDbPath()
  const migrationsFolder = path.join(app.getAppPath(), 'drizzle')
  const migrateResult = await runMigrations(dbPath, migrationsFolder)
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

  // Registrar hook para persistir tickets de balanza en DB cuando hay turno activo.
  // El hook corre de forma síncrona — la búsqueda de producto y la escritura son
  // operaciones SQLite síncronas, apropiadas en el proceso main.
  manager.setTicketHook((rawTicket: ScaleTicketData) => {
    const enriched: ScaleTicketData = { ...rawTicket }
    const session = getActiveSession()

    if (session?.shiftId) {
      try {
        const db = getDb()
        const fallbackProductId = '00000000-0000-0000-0001-000000000099'

        // Resolver product por barcode; fallback al producto genérico del seed
        const product = db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.barcode, rawTicket.productCode))
          .limit(1)
          .all()[0]

        const productId = product?.id ?? fallbackProductId
        const productName = product?.name ?? rawTicket.productCode

        const ticketId = uuidv4()
        db.insert(scaleTickets)
          .values({
            id: ticketId,
            storeId: session.storeId,
            shiftId: session.shiftId,
            productId,
            weightKg: rawTicket.weightKg,
            unitPrice: rawTicket.unitPrice,
            subtotal: rawTicket.subtotal,
            status: 'pending',
            manual: false,
            createdAt: rawTicket.timestamp,
            createdBy: session.userId,
          })
          .run()

        enriched.id = ticketId
        enriched.productId = productId
        enriched.productName = productName
      } catch (err) {
        log.error('[main] Error al persistir ticket de balanza', err)
      }
    }

    // Broadcast al renderer (con o sin ID según si había turno activo)
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SCALE_TICKET, enriched)
      }
    })
  })

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
