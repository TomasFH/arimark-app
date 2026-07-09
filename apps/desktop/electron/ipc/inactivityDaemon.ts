/**
 * Daemon de cierre automático de turno por inactividad.
 *
 * Lógica:
 *  - La señal de "actividad" es una venta confirmada (CREATE_SALE exitoso).
 *  - Si no hubo ninguna venta en `thresholdHours` horas, se envía
 *    SHIFT_INACTIVITY_WARNING a todos los renderers.
 *  - El renderer muestra un countdown de 5 minutos. Si no hay respuesta,
 *    cierra el turno automáticamente (sin datos de caja).
 *  - El timer se reinicia al inicio del daemon (al abrir o reanudar turno),
 *    no desde la última venta histórica en DB, para evitar falsos positivos
 *    al reanudar un turno de otro día.
 */

import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { IPC } from './channels'

let _lastSaleAt = 0
let _timer: ReturnType<typeof setInterval> | null = null
let _warningActive = false

const CHECK_INTERVAL_MS = 60_000 // revisar cada 1 minuto

/**
 * Notifica al daemon que se registró una venta.
 * Llamar desde sale.handler.ts tras CREATE_SALE exitoso.
 */
export function notifySaleOccurred(): void {
  _lastSaleAt = Date.now()
  // Si el aviso estaba activo, la venta nueva lo cancela.
  if (_warningActive) {
    _warningActive = false
    log.debug('[inactivityDaemon] Venta registrada — aviso de inactividad cancelado')
  }
}

/**
 * Descarta el aviso activo y reinicia el reloj desde ahora.
 * Llamar cuando el usuario hace clic en "Seguir trabajando" en el modal.
 */
export function dismissWarning(): void {
  _lastSaleAt = Date.now()
  _warningActive = false
  log.debug('[inactivityDaemon] Aviso descartado por el usuario')
}

/**
 * Inicia el daemon para el turno activo.
 * Llamar al abrir turno (OPEN_SHIFT) o al reanudar uno existente (GET_ACTIVE_SHIFT).
 * Reinicia el reloj desde ahora independientemente del historial.
 */
export function startDaemon(thresholdHours: number): void {
  stopDaemon()
  _lastSaleAt = Date.now()
  _warningActive = false

  _timer = setInterval(() => {
    if (_warningActive) return

    const idleMs = Date.now() - _lastSaleAt
    if (idleMs >= thresholdHours * 3_600_000) {
      _warningActive = true
      log.info('[inactivityDaemon] Umbral de inactividad alcanzado — enviando aviso', {
        idleHours: Math.round(idleMs / 3_600_000 * 10) / 10,
        thresholdHours,
      })
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send(IPC.SHIFT_INACTIVITY_WARNING)
      })
    }
  }, CHECK_INTERVAL_MS)

  log.debug(`[inactivityDaemon] Iniciado (umbral: ${thresholdHours}h)`)
}

/**
 * Detiene el daemon.
 * Llamar al cerrar el turno (CLOSE_SHIFT).
 */
export function stopDaemon(): void {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  _warningActive = false
  log.debug('[inactivityDaemon] Detenido')
}
