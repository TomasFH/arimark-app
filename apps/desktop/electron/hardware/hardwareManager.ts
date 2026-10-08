/**
 * HardwareManager — orquestador de drivers de hardware.
 *
 * Responsabilidades:
 * - Elegir drivers correctos según APP_ENV (mocks en sandbox, reales en producción).
 * - Gestionar el ciclo de vida: connect al arrancar, disconnect al cerrar.
 * - Reconexión automática con backoff exponencial si un driver se desconecta.
 * - Con la app abierta (instalador), notar un COM nuevo o un enlace caído,
 *   sondear R30 y guardar el puerto que responde.
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
   * Lo activa `pnpm dev:hw` (`KRETZ_AUTOPROBE=1`) y el instalador si no hay
   * puerto guardado. No aplica al mock de `pnpm dev`.
   */
  autoprobe?: boolean
  /**
   * Con la app abierta, lista los COM. Si aparece uno nuevo o se pierde el
   * enlace, sondea R30 y adopta el que responde. Producción y dev con driver
   * real. El mock de `pnpm dev` (sin puerto) no lo activa.
   */
  watchHotplug?: boolean
}

const MIN_RECONNECT_MS = 5_000
const MAX_RECONNECT_MS = 30_000
/** Cada cuánto se miran los COM para notar un enchufe con la app abierta. */
export const KRETZ_PORT_WATCH_MS = 2_000
/**
 * Reintentos de un COM nuevo mientras ya hay otra balanza en enlace.
 * Una REPORT NX recién enchufada no contesta los primeros sondeos; con 3
 * (unos 6 s) se la daba por perdida y no se volvía a mirar.
 */
const MAX_NEW_PORT_PROBES = 15

export class HardwareManager {
  private _kretzReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _kretzReconnectDelay = MIN_RECONNECT_MS
  /** Puerto actualmente en uso por el driver real (null si es mock o sin configurar). */
  private _kretzPort: string | null = null
  /** `pnpm dev:hw` sin puerto guardado: sondear en vez de caer al mock. */
  private _autoprobe = false
  /** Instalador (y dev con driver real): notar un COM nuevo con la app abierta. */
  private _watchHotplug = false
  /** Evita sondeos anidados mientras un sondeo ya está en curso. */
  private _probing = false
  /** Se resuelve cuando termina el sondeo en curso. */
  private _probeDone: Promise<void> = Promise.resolve()
  /**
   * El driver real emite `connected` al abrir el COM, antes del test R30.
   * Mientras esto es true, ese evento no marca la balanza como conectada.
   */
  private _suppressConnected = false
  /** True solo después de un enlace R30 OK. Abrir el COM no alcanza. */
  private _linkOk = false
  private _portWatchTimer: ReturnType<typeof setInterval> | null = null
  /** null hasta el primer listado: ese listado no cuenta como enchufe. */
  private _knownPortPaths: Set<string> | null = null
  /** COM nuevos que todavía no respondieron, para no sondearlos para siempre. */
  private _newPortMisses = new Map<string, number>()
  /** El sondeo de un enchufe puede tardar más que el intervalo. */
  private _pollInFlight = false
  private _stopped = false

  constructor(
    private kretz: KretzDriver,
    kretzPort: string | null = null,
    options?: HardwareManagerOptions
  ) {
    this._kretzPort = kretzPort
    this._autoprobe = options?.autoprobe === true
    this._watchHotplug = options?.watchHotplug === true
    this._wireKretzEvents()
  }

  /** Inicia conexión con la balanza. Llamar al arrancar la app. */
  async start(): Promise<void> {
    await this._connectKretz()
    if (!this._watchHotplug || this._stopped) return
    await this._snapshotPorts()
    this._armPortWatch()
  }

  /** Cierra conexión limpiamente. Llamar al cerrar la app. */
  async stop(): Promise<void> {
    this._stopped = true
    this._clearPortWatch()
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
    // Sin COM pedido pero con autodetección: no usar el mock.
    if (this._autoprobe && !this._kretzPort) {
      const found = await this._probeAndAdopt()
      if (found || this._linkOk) return true
      // Otro sondeo sigue en curso: ese se encarga del resultado.
      if (this._probing) return false
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
      this._linkOk = false
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
        if (found || this._linkOk) return true
      }
      if (this._probing) return false

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
    if (this._probing) {
      await this._probeDone
      if (this._stopped) return null
      if (this._linkOk && this._kretzPort) return this._kretzPort
    }
    const port = await this._probeAndAdopt()
    if (port) return port
    if (this._probing) {
      await this._probeDone
      if (this._linkOk && this._kretzPort) return this._kretzPort
    }
    if (this._stopped) return null
    setHardwareStatus({ scale: 'error' })
    this._scheduleReconnect()
    return null
  }

  /**
   * Cierra el driver actual, sondea todos los COM y, si uno responde al enlace
   * R30, lo adopta y lo guarda. Devuelve null si ninguno responde.
   */
  private async _probeAndAdopt(): Promise<string | null> {
    if (this._probing || this._stopped) return null
    this._probing = true
    let finishProbe: () => void = () => {}
    this._probeDone = new Promise<void>(resolve => {
      finishProbe = resolve
    })
    let released = false
    try {
      this._clearReconnect('kretz')
      log.info('[hardware] Sondeando puertos COM para la balanza KRETZ', {
        configuredPort: this._kretzPort,
      })

      this.kretz.removeAllListeners()
      released = true
      this._linkOk = false
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
      finishProbe()
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
    if (await this._connectKretz()) return true
    if (this._stopped) return false
    // El sondeo acaba de cerrar este mismo COM. Windows a veces rechaza
    // reabrirlo en el acto; un intento más después de soltarlo.
    await new Promise<void>(resolve => {
      setTimeout(resolve, 400)
    })
    if (this._stopped) return false
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
    this._linkOk = true
    log.info('[hardware] KRETZ conectada', { port: this._kretzPort })
    setHardwareStatus({ scale: 'connected' })
    this._clearReconnect('kretz')
  }

  // ---------------------------------------------------------------------------
  // Enchufe en caliente (app abierta, sin DevTools)
  // ---------------------------------------------------------------------------

  private async _snapshotPorts(): Promise<void> {
    try {
      const { listSerialPorts } = await import('./kretz/portDetect')
      const listed = await listSerialPorts()
      this._knownPortPaths = new Set(listed.map(p => p.path))
      log.info('[hardware] Vigilando enchufe de la balanza', {
        ports: [...this._knownPortPaths],
      })
    } catch (err) {
      log.warn('[hardware] No se pudo leer los COM al iniciar la vigilancia', {
        err: err instanceof Error ? err.message : String(err),
      })
      this._knownPortPaths = new Set()
    }
  }

  private _armPortWatch(): void {
    if (this._portWatchTimer) return
    const timer = setInterval(() => {
      void this._pollNewPorts()
    }, KRETZ_PORT_WATCH_MS)
    if (typeof timer.unref === 'function') timer.unref()
    this._portWatchTimer = timer
  }

  private _clearPortWatch(): void {
    if (!this._portWatchTimer) return
    clearInterval(this._portWatchTimer)
    this._portWatchTimer = null
  }

  /** Un COM que no estaba en el listado anterior: puede ser la balanza. */
  private async _pollNewPorts(): Promise<void> {
    if (this._stopped || !this._watchHotplug || this._probing || this._pollInFlight) return
    this._pollInFlight = true
    try {
      await this._pollNewPortsOnce()
    } finally {
      this._pollInFlight = false
    }
  }

  private async _pollNewPortsOnce(): Promise<void> {
    let paths: string[]
    try {
      const { listSerialPorts } = await import('./kretz/portDetect')
      const listed = await listSerialPorts()
      paths = listed.map(p => p.path)
    } catch (err) {
      log.warn('[hardware] No se pudieron listar los COM', {
        err: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (this._stopped) return

    if (this._knownPortPaths === null) {
      this._knownPortPaths = new Set(paths)
      return
    }

    const known = this._knownPortPaths
    for (const path of [...known]) {
      if (!paths.includes(path)) {
        known.delete(path)
        this._newPortMisses.delete(path)
      }
    }

    // El COM guardado se fue (otra balanza, otro número). Hay que soltar el
    // enlace viejo aunque el driver no haya avisado el cierre.
    if (this._kretzPort && !paths.includes(this._kretzPort)) {
      log.info('[hardware] El COM de la balanza ya no está', { port: this._kretzPort })
      this._linkOk = false
      this._knownPortPaths = null
      await this._onLinkLost()
      return
    }

    const appeared = paths.filter(path => !known.has(path))
    if (appeared.length === 0) return

    log.info('[hardware] Apareció un puerto COM', { ports: appeared })

    let adopted = false
    if (this._linkOk) {
      adopted = await this._adoptIfNewPortResponds(appeared)
    } else {
      const found = await this._probeAndAdopt()
      adopted = Boolean(found)
      if (!adopted && !this._probing && !this._linkOk && !this._stopped) {
        log.info('[hardware] Ningún COM respondió al enlace R30')
        setHardwareStatus({ scale: 'error' })
        this._scheduleReconnect()
      }
    }

    if (this._stopped || this._probing) return

    if (adopted) {
      for (const path of paths) known.add(path)
      this._newPortMisses.clear()
      return
    }

    this._noteNewPortMisses(appeared, known)
  }

  /**
   * Sondea solo los COM recién enchufados, sin soltar el enlace actual.
   * Si uno responde R30, ese pasa a ser la balanza y se guarda el puerto.
   */
  private async _adoptIfNewPortResponds(paths: string[]): Promise<boolean> {
    const { probeKretzPort } = await import('./kretz/portDetect')
    for (const path of paths) {
      if (this._stopped || this._probing) return false
      let responds = false
      try {
        responds = await probeKretzPort(path)
      } catch (err) {
        log.warn('[hardware] No se pudo sondear el COM nuevo', {
          port: path,
          err: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      if (!responds) continue
      log.info('[hardware] La balanza respondió en el COM recién enchufado', { port: path })
      const linked = await this._adoptPort(path)
      if (!linked) return false
      this._persistKretzPort(path)
      return true
    }
    log.info('[hardware] Los COM nuevos no respondieron al enlace R30', { ports: paths })
    return false
  }

  private _noteNewPortMisses(appeared: string[], known: Set<string>): void {
    // Sin enlace no se archiva ningún COM: el que acaba de aparecer puede ser
    // la balanza y todavía no contesta. Se sigue sondeando en cada pasada.
    if (!this._linkOk) return
    for (const path of appeared) {
      const misses = (this._newPortMisses.get(path) ?? 0) + 1
      if (misses >= MAX_NEW_PORT_PROBES) {
        this._newPortMisses.delete(path)
        known.add(path)
        log.info('[hardware] El COM nuevo no es una balanza KRETZ', { port: path })
      } else {
        this._newPortMisses.set(path, misses)
      }
    }
  }

  /** El puerto en uso se cerró: buscar de nuevo en todos los COM. */
  private async _onLinkLost(): Promise<void> {
    if (this._stopped || this._probing) return
    const found = await this._probeAndAdopt()
    if (found || this._linkOk || this._probing || this._stopped) return
    log.info('[hardware] Se perdió el enlace y ningún COM respondió')
    setHardwareStatus({ scale: 'error' })
    this._scheduleReconnect()
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
      this._linkOk = false
      log.warn('[hardware] KRETZ desconectada — se busca la balanza')
      setHardwareStatus({ scale: 'disconnected' })
      if (this._probing || this._stopped) return
      // Con la app abierta, no quedarse solo en el COM viejo.
      if (this._watchHotplug || this._autoprobe) {
        void this._onLinkLost()
        return
      }
      this._scheduleReconnect()
    })

    this.kretz.on('error', (err: Error) => {
      log.error('[hardware] Error en KRETZ', err)
      setHardwareStatus({ scale: 'error' })
      if (this._probing || this._stopped) return
      // En Windows, desenchufar a veces avisa error y no cierre. Sin esto el
      // enlace queda "ok" y un COM nuevo se ignora después de unos sondeos.
      if (this._watchHotplug || this._autoprobe) {
        this._linkOk = false
        void this._onLinkLost()
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
    // Puerto explícito (env o secreto) → driver real. Si ese COM no responde,
    // _connectKretz sondea el resto. Sin puerto ni KRETZ_AUTOPROBE → mock.
    const kretzPort =
      process.env['KRETZ_PORT'] ?? getSecret(SECRET_KEYS.KRETZ_PORT) ?? ''

    if (kretzPort) {
      const { KretzRealDriver } = await import('./kretz/kretzDriver')
      log.info('[hardware] Modo dev — usando driver KRETZ real', { kretzPort })
      return new HardwareManager(new KretzRealDriver(kretzPort), kretzPort, {
        watchHotplug: true,
      })
    }

    if (process.env['KRETZ_AUTOPROBE'] === '1') {
      const { KretzRealDriver } = await import('./kretz/kretzDriver')
      log.info('[hardware] Modo dev — sin puerto guardado, se detecta la balanza')
      return new HardwareManager(new KretzRealDriver(''), null, {
        autoprobe: true,
        watchHotplug: true,
      })
    }

    const { KretzMockDriver } = await import('./kretz/__mocks__/kretzDriver')
    log.info('[hardware] Modo dev — usando mock KRETZ (sin KRETZ_PORT)')
    return new HardwareManager(new KretzMockDriver())
  }

  // Producción: el COM guardado se prueba al arrancar. Con la app abierta,
  // un enchufe nuevo o un enlace caído dispara otro sondeo R30.
  const saved = (getSecret(SECRET_KEYS.KRETZ_PORT) ?? '').trim()
  const port = saved || null
  const { KretzRealDriver } = await import('./kretz/kretzDriver')
  log.info('[hardware] Modo producción — balanza KRETZ', {
    port: port ?? 'sin puerto guardado',
  })
  return new HardwareManager(new KretzRealDriver(port ?? ''), port, {
    watchHotplug: true,
    autoprobe: port === null,
  })
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
