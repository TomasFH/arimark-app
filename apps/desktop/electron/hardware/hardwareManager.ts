/**
 * HardwareManager — orquestador de drivers de hardware.
 *
 * Responsabilidades:
 * - Elegir drivers correctos según APP_ENV (mocks en sandbox, reales en producción).
 * - Gestionar el ciclo de vida: connect al arrancar, disconnect al cerrar.
 * - Reconexión automática con backoff exponencial si un driver se desconecta.
 * - Actualizar el estado visible (setHardwareStatus) en cada cambio.
 *
 * La balanza KRETZ se usa exclusivamente para gestión de PLUs (admins). No emite
 * pedidos a la PC: las ventas se arman en el renderer escaneando los códigos de
 * barras del ticket físico (ver PLAN.md → Modelo de flujo de datos).
 */

import log from 'electron-log'
import { setHardwareStatus } from '../ipc/hardwareStatus.handler'
import { getSecret, setSecret, SECRET_KEYS } from '../secureStorage'
import type { KretzDriver, SendPluArgs, PluRow } from './kretz/kretzDriver.interface'

export interface HardwareManagerOptions {
  /**
   * Sin puerto configurado, sondear los COM al arrancar.
   * Lo activa `pnpm dev:hw` (`KRETZ_AUTOPROBE=1`). No aplica al mock de `pnpm dev`.
   */
  autoprobe?: boolean
}

const MIN_RECONNECT_MS = 5_000
const MAX_RECONNECT_MS = 30_000

export class HardwareManager {
  private _kretzReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _kretzReconnectDelay = MIN_RECONNECT_MS
  /** Puerto actualmente en uso por el driver real (null si es mock o sin configurar). */
  private _kretzPort: string | null = null
  /** `pnpm dev:hw` sin puerto guardado: sondear en vez de caer al mock. */
  private _autoprobe = false
  /** Evita sondeos anidados mientras un sondeo ya está en curso. */
  private _probing = false
  /**
   * El driver real emite `connected` al abrir el COM, antes del test R30.
   * Mientras esto es true, ese evento no marca la balanza como conectada.
   */
  private _suppressConnected = false

  constructor(
    private kretz: KretzDriver,
    kretzPort: string | null = null,
    options?: HardwareManagerOptions
  ) {
    this._kretzPort = kretzPort
    this._autoprobe = options?.autoprobe === true
    this._wireKretzEvents()
  }

  /** Inicia conexión con la balanza. Llamar al arrancar la app. */
  async start(): Promise<void> {
    await this._connectKretz()
  }

  /** Cierra conexión limpiamente. Llamar al cerrar la app. */
  async stop(): Promise<void> {
    this._clearReconnect('kretz')
    // Sin listeners, el 'disconnected' del cierre no programa otra reconexión.
    this.kretz.removeAllListeners()
    await Promise.allSettled([this.kretz.disconnect()])
    this._clearReconnect('kretz')
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

  // ---------------------------------------------------------------------------
  // Conexión y reconexión
  // ---------------------------------------------------------------------------

  private async _connectKretz(): Promise<boolean> {
    // Sin COM pedido pero con autodetección (`pnpm dev:hw`): no usar el mock.
    if (this._autoprobe && !this._kretzPort) {
      const found = await this._probeAndAdopt()
      if (found) return true
      log.info('[hardware] No se encontró la balanza en ningún COM')
      setHardwareStatus({ scale: 'error' })
      this._scheduleReconnect()
      return false
    }

    const verifyLink = Boolean(this._kretzPort?.trim())
    this._suppressConnected = verifyLink
    try {
      await this.kretz.connect()
      if (verifyLink) {
        const linked = await this.kretz.testLink()
        if (!linked) {
          throw new Error(
            `[kretz] El puerto ${this._kretzPort} no respondió al test de enlace R30`
          )
        }
        this._markKretzLinked()
      }
      this._kretzReconnectDelay = MIN_RECONNECT_MS
      return true
    } catch (err) {
      this._suppressConnected = false
      const msg = err instanceof Error ? err.message : String(err)
      // "Puerto serial no configurado" es el estado normal cuando la balanza
      // todavía no está enchufada o no fue configurada. No es un error crítico.
      const isUnconfigured =
        msg.toLowerCase().includes('no configurado') ||
        msg.toLowerCase().includes('not configured')
      if (isUnconfigured) {
        log.debug('[hardware] KRETZ: puerto no configurado, reintentando en background')
      } else {
        log.warn('[hardware] Fallo al conectar KRETZ', msg)
      }

      // Puerto pedido (env o secreto) que no abre o no habla R30: buscar otro COM.
      // No aplica al mock (`pnpm dev` sin puerto) ni a un sondeo ya en curso.
      if (!this._probing && this._kretzPort) {
        const found = await this._probeAndAdopt()
        if (found) return true
      }

      setHardwareStatus({ scale: 'error' })
      this._scheduleReconnect()
      return false
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnect('kretz')
    const delay = this._kretzReconnectDelay

    log.debug(`[hardware] Reconexión kretz en ${delay}ms`)
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
  // Detección automática y cambio de puerto en caliente
  // ---------------------------------------------------------------------------

  /** Puerto serial en uso por la balanza (null si mock o sin configurar). */
  getKretzPort(): string | null {
    return this._kretzPort
  }

  /**
   * Reemplaza el driver KRETZ por uno real apuntando a `portPath` y reconecta,
   * sin reiniciar la app. Cierra y descarta el driver anterior (incluido el mock).
   */
  async setKretzPort(portPath: string): Promise<void> {
    await this._adoptPort(portPath)
  }

  /**
   * Detecta automáticamente el puerto de la balanza sondeando el protocolo R30
   * en todos los puertos serie disponibles. Para poder sondear libremente, primero
   * libera el puerto que estuviera en uso. Si encuentra una balanza, la conecta,
   * persiste el puerto y lo devuelve; si no, reanuda la reconexión y devuelve null.
   */
  async detectAndConnectKretz(): Promise<string | null> {
    const port = await this._probeAndAdopt()
    if (!port) {
      setHardwareStatus({ scale: 'error' })
      this._scheduleReconnect()
      return null
    }
    return port
  }

  /**
   * Cierra el driver actual, sondea todos los COM y, si uno responde al enlace
   * R30, lo adopta y lo guarda. Devuelve null si ninguno responde.
   */
  private async _probeAndAdopt(): Promise<string | null> {
    if (this._probing) return null
    this._probing = true
    let released = false
    try {
      this._clearReconnect('kretz')
      log.info('[hardware] Sondeando puertos COM para la balanza KRETZ', {
        configuredPort: this._kretzPort,
      })

      this.kretz.removeAllListeners()
      released = true
      try {
        await this.kretz.disconnect()
      } catch (err) {
        log.debug(
          '[hardware] El driver previo no estaba conectado',
          err instanceof Error ? err.message : String(err)
        )
      }

      const { detectKretzPort } = await import('./kretz/portDetect')
      const found = await detectKretzPort()
      if (!found) {
        log.info('[hardware] Ningún COM respondió al protocolo R30')
        return null
      }

      const previous = this._kretzPort
      const linked = await this._adoptPort(found)
      if (!linked) return null

      this._persistKretzPort(found)
      if (previous !== found) {
        log.info('[hardware] Se reemplazó el puerto KRETZ que no respondía', {
          previous,
          port: found,
        })
      }
      return found
    } catch (err) {
      log.error('[hardware] Error al sondear puertos COM', err)
      return null
    } finally {
      this._probing = false
      if (released && this.kretz.listenerCount('connected') === 0) {
        this._wireKretzEvents()
      }
    }
  }

  /** Instala un driver real en `portPath` y verifica el enlace R30. */
  private async _adoptPort(portPath: string): Promise<boolean> {
    this._clearReconnect('kretz')

    const previous = this.kretz
    previous.removeAllListeners()
    try {
      await previous.disconnect()
    } catch (err) {
      log.debug(
        '[hardware] No se pudo cerrar el driver anterior',
        err instanceof Error ? err.message : String(err)
      )
    }

    const { KretzRealDriver } = await import('./kretz/kretzDriver')
    this.kretz = new KretzRealDriver(portPath)
    this._kretzPort = portPath
    this._kretzReconnectDelay = MIN_RECONNECT_MS
    this._wireKretzEvents()
    return this._connectKretz()
  }

  private _persistKretzPort(port: string): void {
    try {
      setSecret(SECRET_KEYS.KRETZ_PORT, port)
      log.info('[hardware] Puerto KRETZ guardado', { port })
    } catch (err) {
      // safeStorage puede no estar disponible (tests, Linux sin keyring).
      // La conexión ya quedó hecha; el próximo arranque volverá a detectar.
      log.warn('[hardware] No se pudo guardar el puerto KRETZ', {
        port,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private _markKretzLinked(): void {
    this._suppressConnected = false
    log.info('[hardware] KRETZ conectada', { port: this._kretzPort })
    setHardwareStatus({ scale: 'connected' })
    this._clearReconnect('kretz')
  }

  // ---------------------------------------------------------------------------
  // Eventos de los drivers
  // ---------------------------------------------------------------------------

  private _wireKretzEvents(): void {
    this.kretz.on('connected', () => {
      if (this._suppressConnected) return
      this._markKretzLinked()
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
  }
}

// ---------------------------------------------------------------------------
// Factory — crea el manager con los drivers correctos según APP_ENV
// ---------------------------------------------------------------------------

export async function createHardwareManager(): Promise<HardwareManager> {
  const env = process.env['APP_ENV'] ?? 'dev'

  if (env === 'dev') {
    // Puerto explícito (env o secreto) → driver real. Si ese COM no responde,
    // _connectKretz sondea el resto. Sin puerto ni KRETZ_AUTOPROBE → mock.
    const kretzPort =
      process.env['KRETZ_PORT'] ?? getSecret(SECRET_KEYS.KRETZ_PORT) ?? ''

    if (kretzPort) {
      const { KretzRealDriver } = await import('./kretz/kretzDriver')
      log.info('[hardware] Modo dev — usando driver KRETZ real', { kretzPort })
      return new HardwareManager(new KretzRealDriver(kretzPort), kretzPort)
    }

    if (process.env['KRETZ_AUTOPROBE'] === '1') {
      const { KretzRealDriver } = await import('./kretz/kretzDriver')
      log.info('[hardware] Modo dev — sin puerto guardado, se detecta la balanza')
      return new HardwareManager(new KretzRealDriver(''), null, { autoprobe: true })
    }

    const { KretzMockDriver } = await import('./kretz/__mocks__/kretzDriver')
    log.info('[hardware] Modo dev — usando mock KRETZ (sin KRETZ_PORT)')
    return new HardwareManager(new KretzMockDriver())
  }

  // Producción: leer config de secureStorage. Si el COM guardado no responde,
  // el arranque sondea los demás (el número de COM cambia con el disco/USB).
  const kretzPort = getSecret(SECRET_KEYS.KRETZ_PORT) ?? ''
  const { KretzRealDriver } = await import('./kretz/kretzDriver')
  return new HardwareManager(new KretzRealDriver(kretzPort), kretzPort || null)
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
