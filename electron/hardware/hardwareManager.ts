/**
 * HardwareManager — orquestador de drivers de hardware.
 *
 * Responsabilidades:
 * - Elegir drivers correctos según APP_ENV (mocks en sandbox, reales en producción).
 * - Gestionar el ciclo de vida: connect al arrancar, disconnect al cerrar.
 * - Reconexión automática con backoff exponencial si un driver se desconecta.
 * - Actualizar el estado visible (setHardwareStatus) en cada cambio.
 * - Broadcast de pedidos de balanza a todas las ventanas abiertas.
 */

import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { IPC } from '../ipc/channels'
import { setHardwareStatus } from '../ipc/hardwareStatus.handler'
import { getSecret, SECRET_KEYS } from '../secureStorage'
import type { KretzDriver, ScaleOrderData, SendPluArgs, PluRow } from './kretz/kretzDriver.interface'

const MIN_RECONNECT_MS = 5_000
const MAX_RECONNECT_MS = 30_000

export class HardwareManager {
  private _kretzReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _kretzReconnectDelay = MIN_RECONNECT_MS

  constructor(private readonly kretz: KretzDriver) {
    this._wireKretzEvents()
  }

  /** Inicia conexión con la balanza. Llamar al arrancar la app. */
  async start(): Promise<void> {
    await Promise.allSettled([this._connectKretz()])
  }

  /** Cierra conexión limpiamente. Llamar al cerrar la app. */
  async stop(): Promise<void> {
    this._clearReconnect('kretz')
    await Promise.allSettled([this.kretz.disconnect()])
  }

  // ---------------------------------------------------------------------------
  // Gestión de PLUs
  // ---------------------------------------------------------------------------

  async kretzTestLink(): Promise<boolean> {
    return this.kretz.testLink()
  }

  async kretzSendPlu(args: SendPluArgs): Promise<void> {
    return this.kretz.sendPlu(args)
  }

  async kretzDeletePlu(pluNumber: string): Promise<void> {
    return this.kretz.deletePlu(pluNumber)
  }

  async kretzReadPlu(pluNumber: string, priceDigits?: 6 | 7): Promise<PluRow | null> {
    return this.kretz.readPlu(pluNumber, priceDigits)
  }

  async kretzReadPluCount(): Promise<number> {
    return this.kretz.readPluCount()
  }

  /**
   * Inyecta un pedido completo de balanza (solo mock KRETZ en sandbox).
   * El pedido recorre el mismo flujo que uno real: evento → hook → renderer.
   */
  injectMockOrder(params: {
    channel: import('./kretz/kretzDriver.interface').ScaleChannel
    items: Array<{ productCode: string; weightKg: number; unitPrice: number }>
  }): void {
    const driver = this.kretz as KretzDriver & {
      emitMockOrder?: (p: typeof params) => void
    }

    if (typeof driver.emitMockOrder !== 'function') {
      throw new Error('[hardware] injectMockOrder solo disponible con mock KRETZ')
    }

    driver.emitMockOrder(params)
  }

  // ---------------------------------------------------------------------------
  // Conexión y reconexión
  // ---------------------------------------------------------------------------

  private async _connectKretz(): Promise<void> {
    try {
      await this.kretz.connect()
      this._kretzReconnectDelay = MIN_RECONNECT_MS
      // Estado actualizado via evento 'connected' en _wireKretzEvents
    } catch (err) {
      log.error('[hardware] Fallo al conectar KRETZ', err)
      setHardwareStatus({ scale: 'error' })
      this._scheduleReconnect()
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnect('kretz')
    const delay = this._kretzReconnectDelay

    log.info(`[hardware] Reconexión kretz en ${delay}ms`)
    const timer = setTimeout(() => {
      this._kretzReconnectDelay = Math.min(this._kretzReconnectDelay * 2, MAX_RECONNECT_MS)
      void this._connectKretz()
    }, delay)

    this._kretzReconnectTimer = timer
  }

  private _clearReconnect(device: 'kretz'): void {
    if (device === 'kretz' && this._kretzReconnectTimer) {
      clearTimeout(this._kretzReconnectTimer)
      this._kretzReconnectTimer = null
    }
  }

  // ---------------------------------------------------------------------------
  // Eventos de los drivers
  // ---------------------------------------------------------------------------

  private _wireKretzEvents(): void {
    this.kretz.on('connected', () => {
      log.info('[hardware] KRETZ conectada')
      setHardwareStatus({ scale: 'connected' })
      this._clearReconnect('kretz')
    })

    this.kretz.on('disconnected', () => {
      log.warn('[hardware] KRETZ desconectada — reconectando...')
      setHardwareStatus({ scale: 'disconnected' })
      this._scheduleReconnect()
    })

    this.kretz.on('error', (err: Error) => {
      log.error('[hardware] Error en KRETZ', err)
      setHardwareStatus({ scale: 'error' })
    })

    this.kretz.on('order', (order: ScaleOrderData) => {
      this._broadcastOrder(order)
    })
  }

  /**
   * Hook inyectable: si está registrado, reemplaza el broadcast directo.
   * Permite que main.ts persista el pedido en DB antes de enviarlo al renderer.
   * Si el hook no está registrado, se hace broadcast del pedido crudo.
   */
  private _orderHook: ((order: ScaleOrderData) => void) | null = null

  setOrderHook(fn: (order: ScaleOrderData) => void): void {
    this._orderHook = fn
  }

  private _broadcastOrder(order: ScaleOrderData): void {
    if (this._orderHook) {
      this._orderHook(order)
      return
    }
    // Fallback sin hook: broadcast crudo
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SCALE_ORDER, order)
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Factory — crea el manager con los drivers correctos según APP_ENV
// ---------------------------------------------------------------------------

export async function createHardwareManager(): Promise<HardwareManager> {
  const env = process.env['APP_ENV'] ?? 'dev'

  if (env === 'dev') {
    // En dev: usar hardware real si KRETZ_PORT está definido, mock en caso contrario.
    const kretzPort =
      process.env['KRETZ_PORT'] ?? getSecret(SECRET_KEYS.KRETZ_PORT) ?? ''

    if (kretzPort) {
      const { KretzRealDriver } = await import('./kretz/kretzDriver')
      log.info('[hardware] Modo dev — usando driver KRETZ real', { kretzPort })
      return new HardwareManager(new KretzRealDriver(kretzPort))
    }

    const { KretzMockDriver } = await import('./kretz/__mocks__/kretzDriver')
    log.info('[hardware] Modo dev — usando mock KRETZ (sin KRETZ_PORT)')
    return new HardwareManager(new KretzMockDriver())
  }

  // Producción: leer config de secureStorage
  const kretzPort = getSecret(SECRET_KEYS.KRETZ_PORT) ?? ''
  const { KretzRealDriver } = await import('./kretz/kretzDriver')
  return new HardwareManager(new KretzRealDriver(kretzPort))
}

// ---------------------------------------------------------------------------
// Singleton — una única instancia durante la vida de la app
// ---------------------------------------------------------------------------

let _instance: HardwareManager | null = null

export function getHardwareManager(): HardwareManager {
  if (!_instance) {
    throw new Error('[hardware] HardwareManager no inicializado. Llamar a initHardwareManager() primero.')
  }
  return _instance
}

export async function initHardwareManager(): Promise<HardwareManager> {
  _instance = await createHardwareManager()
  return _instance
}

/** Solo para tests — permite reemplazar la instancia singleton con un mock. */
export function _setHardwareManagerForTesting(manager: HardwareManager): void {
  _instance = manager
}
