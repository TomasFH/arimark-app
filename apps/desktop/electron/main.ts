import './bootEnv'
import { app, BrowserWindow, Menu } from 'electron'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { registerAllHandlers } from './ipc/index'
import { applyInitialZoom, applyWindowChrome, hookZoomShortcuts, readSettings, windowBackgroundForScheme } from './ipc/uiSettings.handler'
import { initHardwareManager, getHardwareManager } from './hardware/hardwareManager'
import { loadBusinessConfig } from './businessConfig'
import { getDbPath, getDb } from './db/client'
import { stores } from './db/schema'
import { eq } from 'drizzle-orm'
import { runMigrations } from './db/migrate'
import {
  ensureCatalogSeedUser,
  ensureMasterCatalogProducts,
  seedCatalogOntoStore,
} from './db/seedStoreCatalog'
import { signInAnon } from './licensing/installation'
import { publishCatalog } from './licensing/catalogPublish'
import { STORE_SYNC_BOOTSTRAP } from './licensing/storeSyncMarkers'
import { setInitStatus } from './ipc/initStatus.handler'
import type { InitStatus } from '../src/types/hw-api'

log.initialize({ preload: true })
log.transports.file.level = 'info'
// En desarrollo mostramos info+ en consola; debug queda solo para archivos de log.
log.transports.console.level = 'info'
log.info('[main] Iniciando app', { version: app.getVersion(), env: process.env['APP_ENV'] })

const isDev = process.env['NODE_ENV'] === 'development'

function windowIconPath(): string | undefined {
  // El .ico trae 16, 24 y 32 px ya armados. Si se pasa el PNG de 1024,
  // Windows muestrea píxeles sueltos para la barra de título y el logo se desarma.
  // En el instalador el archivo viaja como resources/icon.ico. En dev sigue al lado del repo.
  const packaged = path.join(process.resourcesPath, 'icon.ico')
  const dev = path.join(__dirname, '../../build-resources/icon.ico')
  const iconPath = fs.existsSync(packaged) ? packaged : dev
  return fs.existsSync(iconPath) ? iconPath : undefined
}

function createWindow(): BrowserWindow {
  const scheme = readSettings().colorScheme
  applyWindowChrome(scheme)
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    icon: windowIconPath(),
    backgroundColor: windowBackgroundForScheme(scheme),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    titleBarStyle: 'default',
  })
  win.maximize()

  win.once('ready-to-show', () => {
    if (!win.isMaximized()) win.maximize()
    win.show()
    applyInitialZoom()
  })
  hookZoomShortcuts(win.webContents)

  const devServerUrl = process.env['VITE_DEV_SERVER_URL']
  if (isDev && devServerUrl) {
    win.loadURL(devServerUrl)
  } else if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  return win
}

/**
 * Calcula el InitStatus al arrancar.
 * En sandbox: siempre válido, sin Firebase.
 * En producción: autentica anónimo para Firestore; no hay gate de licencia
 * (el tenant_id de business.json es solo namespace de datos — ver TASKS_V1 A1/A2).
 * InitStatus.licenseKey se mantiene por compat UI; su valor es config.tenant_id.
 */
async function computeInitStatus(): Promise<InitStatus> {
  const config = loadBusinessConfig()
  const APP_ENV = process.env['APP_ENV'] ?? 'dev'

  if (APP_ENV === 'dev') {
    return {
      businessName: config.business_name,
      defaultStoreId: config.default_store_id,
      licenseKey: config.tenant_id,
      licenseValid: true,
      needsActivation: false,
    }
  }

  // Producción: autenticarse anónimamente para que Firestore acepte lecturas
  // posteriores (catálogo, sync). No se bloquea el arranque si falla.
  let anonUid: string | null = null
  try {
    anonUid = await signInAnon()
  } catch (err) {
    log.warn('[main] signInAnon falló — Firebase puede no estar disponible hasta el login', err)
  }

  if (anonUid) {
    log.info('[main] Sesión anónima lista (sin gate de licencia)', { anonUid })
  }

  return {
    businessName: config.business_name,
    defaultStoreId: config.default_store_id,
    licenseKey: config.tenant_id,
    licenseValid: true,
    needsActivation: false,
  }
}

/**
 * Crea el local por defecto en SQLite si no existe. Idempotente.
 * syncedAt = bootstrap: no es una edición del usuario. Si Firestore ya tiene
 * ese local (aunque esté eliminado), el pull lo pisa y no se vuelve a publicar.
 */
function ensureDefaultStore(storeId: string, businessName: string, tenantId: string): void {
  try {
    const db = getDb()
    const existing = db.select().from(stores).where(eq(stores.id, storeId)).limit(1).all()[0]
    if (existing) return

    const now = new Date().toISOString()
    db.insert(stores)
      .values({
        id: storeId,
        name: businessName,
        address: null,
        createdAt: now,
        syncedAt: STORE_SYNC_BOOTSTRAP,
      })
      .run()
    log.info('[main] Local por defecto creado en SQLite', { storeId })

    const seedUserId = ensureCatalogSeedUser(now)
    const seeded = seedCatalogOntoStore({ storeId, createdByUserId: seedUserId, now })
    log.info('[main] Catálogo maestro copiado al local por defecto', { storeId, seeded })
    if (seeded > 0) {
      publishCatalog(tenantId, storeId, { archive: false }).catch(err =>
        log.warn('[main] publishCatalog del local por defecto falló (no bloqueante)', err),
      )
    }
  } catch (err) {
    log.error('[main] No se pudo garantizar el local por defecto', err)
  }
}

app.whenReady().then(async () => {
  log.info('[main] app ready')

  // Sin menú nativo File/Edit/View: en Windows Alt lo mostraba (autoHideMenuBar).
  Menu.setApplicationMenu(null)

  // 1. Inicializar DB con migraciones.
  //    app.getAppPath() apunta al raíz de la app (repo en dev, asar en prod),
  //    donde electron-builder copia la carpeta drizzle/.
  const dbPath = getDbPath()
  const migrationsFolder = path.join(app.getAppPath(), 'drizzle')
  const migrateResult = await runMigrations(dbPath, migrationsFolder)
  if (!migrateResult.ok) {
    log.error('[main] Falló la migración de DB — la app puede no funcionar correctamente', migrateResult.error)
    // runMigrations llama closeDb() al fallar y restaura el backup.
    // Re-inicializamos la DB desde el backup restaurado para que los handlers
    // IPC puedan seguir funcionando (sin la migración fallida, pero funcionales).
    const { initDb } = await import('./db/client')
    initDb(dbPath)
    log.warn('[main] DB re-inicializada desde backup — la migración fallida no fue aplicada')
  }

  // 2. Calcular estado de inicialización (licencia, activación, config)
  const initStatus = await computeInitStatus()
  setInitStatus(initStatus)
  log.info('[main] InitStatus calculado', {
    licenseValid: initStatus.licenseValid,
    needsActivation: initStatus.needsActivation,
  })

  // 2b. Catálogo maestro (JSON embebido) + local por defecto de business.json.
  //     Idempotente: no pisa productos ni un local ya existente.
  ensureMasterCatalogProducts()
  ensureDefaultStore(initStatus.defaultStoreId, initStatus.businessName, initStatus.licenseKey)

  // 3. Inicializar hardware y registrar handlers IPC.
  //    La balanza KRETZ se usa exclusivamente para gestión de PLUs (admins).
  //    No emite pedidos a la PC: las ventas se arman en el renderer escaneando
  //    los códigos de barras del ticket físico (ver PLAN.md → Modelo de flujo de datos).
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
