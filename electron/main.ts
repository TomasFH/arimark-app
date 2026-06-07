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
import { products, scaleOrders, scaleOrderItems } from './db/schema'
import type { InitStatus } from '../src/types/hw-api'
import type { ScaleOrderData } from './hardware/kretz/kretzDriver.interface'

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

  if (APP_ENV === 'sandbox' || APP_ENV === 'fieldtest') {
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

  // Registrar hook para persistir pedidos de balanza en DB cuando hay turno activo.
  // El hook corre de forma síncrona — las búsquedas de producto y las escrituras son
  // operaciones SQLite síncronas, apropiadas en el proceso main.
  manager.setOrderHook((rawOrder: ScaleOrderData) => {
    const session = getActiveSession()
    const fallbackProductId = '00000000-0000-0000-0001-000000000099'

    // Enriquecer items con productId/productName resueltos por barcode
    type EnrichedItem = ScaleOrderData['items'][number] & { productId: string; productName: string }
    const enrichedItems: EnrichedItem[] = rawOrder.items.map(item => ({
      ...item,
      productId: fallbackProductId,
      productName: item.productCode,
    }))

    let orderId: string | undefined

    if (session?.shiftId) {
      try {
        const db = getDb()
        orderId = uuidv4()

        // Resolver productId por barcode para cada ítem; fallback al producto genérico
        for (const item of enrichedItems) {
          const found = db
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(eq(products.barcode, item.productCode))
            .limit(1)
            .all()[0]
          if (found) {
            item.productId = found.id
            item.productName = found.name
          }
        }

        db.transaction(tx => {
          tx.insert(scaleOrders)
            .values({
              id: orderId!,
              storeId: session.storeId,
              shiftId: session.shiftId!,
              channel: rawOrder.channel,
              total: rawOrder.total,
              status: 'pending',
              createdAt: rawOrder.timestamp,
              createdBy: session.userId,
            })
            .run()

          for (const item of enrichedItems) {
            tx.insert(scaleOrderItems)
              .values({
                id: uuidv4(),
                orderId: orderId!,
                productCode: item.productCode,
                productId: item.productId !== fallbackProductId ? item.productId : null,
                weightKg: item.weightKg,
                unitPrice: item.unitPrice,
                subtotal: item.subtotal,
              })
              .run()
          }
        })
      } catch (err) {
        log.error('[main] Error al persistir pedido de balanza', err)
        orderId = undefined
      }
    }

    // Construir el ScaleOrder enriquecido y hacer broadcast al renderer
    const enrichedOrder = {
      id: orderId,
      channel: rawOrder.channel,
      items: enrichedItems.map(item => ({
        productCode: item.productCode,
        productId: item.productId !== fallbackProductId ? item.productId : undefined,
        productName: item.productName,
        weightKg: item.weightKg,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      })),
      total: rawOrder.total,
      timestamp: rawOrder.timestamp,
    }

    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SCALE_ORDER, enrichedOrder)
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
