/**
 * HardwareManager — orquestador de drivers de hardware.
 *
 * Responsabilidades:
 * - Elegir drivers correctos según APP_ENV (mocks en sandbox, reales en producción).
 * - Gestionar el ciclo de vida: connect al arrancar, disconnect al cerrar.
 * - Reconexión automática con backoff exponencial si un driver se desconecta.
 * - Actualizar el estado visible (setHardwareStatus) en cada cambio.
 * - Broadcast de tickets de balanza a todas las ventanas abiertas.
 */

import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { IPC } from '../ipc/channels'
import { setHardwareStatus } from '../ipc/hardwareStatus.handler'
import { getSecret, getCredential, SECRET_KEYS, CREDENTIAL_ACCOUNTS } from '../secureStorage'
import type { KretzDriver, ScaleTicketData } from './kretz/kretzDriver.interface'
import type { FiscalDriver, FiscalPaymentRequest, FiscalPaymentResult } from './fiscal/fiscalDriver.interface'

const MIN_RECONNECT_MS = 5_000
const MAX_RECONNECT_MS = 30_000

export class HardwareManager {
  private _kretzReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _fiscalReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _kretzReconnectDelay = MIN_RECONNECT_MS
  private _fiscalReconnectDelay = MIN_RECONNECT_MS

  constructor(
    private readonly kretz: KretzDriver,
    private readonly fiscal: FiscalDriver
  ) {
    this._wireKretzEvents()
    this._wireFiscalEvents()
  }

  /** Inicia conexión con ambos periféricos. Llamar al arrancar la app. */
  async start(): Promise<void> {
    await Promise.allSettled([this._connectKretz(), this._connectFiscal()])
  }

  /** Cierra conexión limpiamente. Llamar al cerrar la app. */
  async stop(): Promise<void> {
    this._clearReconnect('kretz')
    this._clearReconnect('fiscal')
    await Promise.allSettled([this.kretz.disconnect(), this.fiscal.disconnect()])
  }

  async processPayment(req: FiscalPaymentRequest): Promise<FiscalPaymentResult> {
    return this.fiscal.processPayment(req)
  }

  async issueCashReceipt(amount: number, referenceId: string): Promise<FiscalPaymentResult> {
    return this.fiscal.issueCashReceipt(amount, referenceId)
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
      this._scheduleReconnect('kretz')
    }
  }

  private async _connectFiscal(): Promise<void> {
    try {
      await this.fiscal.connect()
      this._fiscalReconnectDelay = MIN_RECONNECT_MS
      setHardwareStatus({ fiscal: 'connected' })
      log.info('[hardware] SAM4S conectada')
    } catch (err) {
      log.error('[hardware] Fallo al conectar SAM4S', err)
      setHardwareStatus({ fiscal: 'error' })
      this._scheduleReconnect('fiscal')
    }
  }

  private _scheduleReconnect(device: 'kretz' | 'fiscal'): void {
    this._clearReconnect(device)
    const delay = device === 'kretz' ? this._kretzReconnectDelay : this._fiscalReconnectDelay

    log.info(`[hardware] Reconexión ${device} en ${delay}ms`)
    const timer = setTimeout(() => {
      if (device === 'kretz') {
        this._kretzReconnectDelay = Math.min(this._kretzReconnectDelay * 2, MAX_RECONNECT_MS)
        void this._connectKretz()
      } else {
        this._fiscalReconnectDelay = Math.min(this._fiscalReconnectDelay * 2, MAX_RECONNECT_MS)
        void this._connectFiscal()
      }
    }, delay)

    if (device === 'kretz') this._kretzReconnectTimer = timer
    else this._fiscalReconnectTimer = timer
  }

  private _clearReconnect(device: 'kretz' | 'fiscal'): void {
    if (device === 'kretz' && this._kretzReconnectTimer) {
      clearTimeout(this._kretzReconnectTimer)
      this._kretzReconnectTimer = null
    }
    if (device === 'fiscal' && this._fiscalReconnectTimer) {
      clearTimeout(this._fiscalReconnectTimer)
      this._fiscalReconnectTimer = null
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
      this._scheduleReconnect('kretz')
    })

    this.kretz.on('error', (err: Error) => {
      log.error('[hardware] Error en KRETZ', err)
      setHardwareStatus({ scale: 'error' })
    })

    this.kretz.on('ticket', (ticket: ScaleTicketData) => {
      this._broadcastTicket(ticket)
    })
  }

  private _wireFiscalEvents(): void {
    // El FiscalDriver no es EventEmitter; los errores llegan como valores de retorno.
    // Si en el futuro se necesita, se puede extender FiscalDriver con EventEmitter.
  }

  private _broadcastTicket(ticket: ScaleTicketData): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SCALE_TICKET, ticket)
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Factory — crea el manager con los drivers correctos según APP_ENV
// ---------------------------------------------------------------------------

export async function createHardwareManager(): Promise<HardwareManager> {
  const env = process.env['APP_ENV'] ?? 'sandbox'

  if (env === 'sandbox') {
    const { KretzMockDriver } = await import('./kretz/__mocks__/kretzDriver')
    const { FiscalMockDriver } = await import('./fiscal/__mocks__/fiscalDriver')
    log.info('[hardware] Modo sandbox — usando mocks de hardware')
    return new HardwareManager(new KretzMockDriver(), new FiscalMockDriver())
  }

  // Producción: leer config de secureStorage
  const kretzPort = getSecret(SECRET_KEYS.KRETZ_PORT) ?? ''
  const sam4sIp = getSecret(SECRET_KEYS.SAM4S_IP) ?? ''
  const sam4sUser = getCredential(CREDENTIAL_ACCOUNTS.SAM4S_USER) ?? ''
  const sam4sPassword = getCredential(CREDENTIAL_ACCOUNTS.SAM4S_PASSWORD) ?? ''

  const { KretzRealDriver } = await import('./kretz/kretzDriver')
  const { FiscalRealDriver } = await import('./fiscal/fiscalDriver')

  return new HardwareManager(
    new KretzRealDriver(kretzPort),
    new FiscalRealDriver(sam4sIp, sam4sUser, sam4sPassword)
  )
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
