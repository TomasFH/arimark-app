/**
 * Sistema de actualizaciones automáticas via electron-updater.
 *
 * Reglas:
 * - Solo activo en producción. En sandbox: no-op.
 * - Auto-check al iniciar y cada CHECK_INTERVAL_HOURS horas.
 * - La instalación ocurre SOLO cuando la app se cierra, nunca durante un turno activo.
 * - Un turno activo bloquea la instalación hasta que se cierre el turno.
 */

import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import log from 'electron-log'

const CHECK_INTERVAL_HOURS = 4
const CHECK_INTERVAL_MS = CHECK_INTERVAL_HOURS * 60 * 60 * 1000

let _updateAvailable = false
let _isShiftActive = false
let _updateCheckTimer: NodeJS.Timeout | null = null

/**
 * Notifica al updater si hay un turno activo.
 * Un turno activo bloquea la instalación de la actualización al cierre.
 */
export function setShiftActive(active: boolean): void {
  _isShiftActive = active
  if (!active && _updateAvailable) {
    log.info('[updater] Turno cerrado y hay actualización pendiente — instalando al salir')
    app.once('before-quit', () => {
      autoUpdater.quitAndInstall(false, true)
    })
  }
}

export function isUpdateAvailable(): boolean {
  return _updateAvailable
}

/**
 * Inicializa el sistema de actualizaciones.
 * Llamar desde main.ts en app.whenReady(), después de verificar la licencia.
 */
export function initUpdater(): void {
  const APP_ENV = process.env['APP_ENV'] ?? 'sandbox'
  if (APP_ENV !== 'production') {
    log.info('[updater] Modo sandbox — actualizaciones desactivadas')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] Verificando actualizaciones...')
  })

  autoUpdater.on('update-available', info => {
    log.info('[updater] Actualización disponible', info.version)
    _updateAvailable = true
  })

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] Sin actualizaciones disponibles')
    _updateAvailable = false
  })

  autoUpdater.on('error', err => {
    log.error('[updater] Error al verificar/descargar actualización', err.message)
  })

  autoUpdater.on('update-downloaded', info => {
    log.info('[updater] Actualización descargada', info.version)

    if (!_isShiftActive) {
      log.info('[updater] Sin turno activo — instalará al cerrar la app')
      app.once('before-quit', () => {
        autoUpdater.quitAndInstall(false, true)
      })
    } else {
      log.info('[updater] Turno activo — actualización en espera hasta el cierre del turno')
    }
  })

  autoUpdater.checkForUpdatesAndNotify()

  _updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, CHECK_INTERVAL_MS)

  app.on('before-quit', () => {
    if (_updateCheckTimer) {
      clearInterval(_updateCheckTimer)
      _updateCheckTimer = null
    }
  })

  log.info('[updater] Inicializado — check cada', CHECK_INTERVAL_HOURS, 'horas')
}
