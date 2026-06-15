/**
 * Driver real de la balanza KRETZ REPORT NX — protocolo R30 sobre USB/Serial.
 *
 * Comunicación: COM8 (u otro) a 115200 baud, 8N1.
 * El protocolo R30 es maestro–esclavo: la PC envía un comando y la balanza responde.
 * No hay tráfico espontáneo — el driver debe preguntar explícitamente.
 *
 * Modos de uso:
 *  1. Peso en vivo: polling con comando 1524 cada N ms.
 *  2. Gestión de PLUs: comandos 2005 (crear/actualizar), 5005 (leer), 5001 (contar).
 *
 * NOTA: este módulo NUNCA se usa en APP_ENV=sandbox.
 * En sandbox y tests se usa KretzMockDriver.
 */

import { EventEmitter } from 'events'
import { SerialPort } from 'serialport'
import log from 'electron-log'
import type { KretzDriver } from './kretzDriver.interface'
import {
  encodeFrame,
  takeResponseFrame,
  parseResponse,
  explainResponseCode,
  parseState1524,
  buildPlu2005Data,
  parsePlu5005,
  type SendPluArgs,
  type PluRow,
  formatRxHex,
} from './r30Protocol'

const BAUD_RATE = 115200
const DEFAULT_TIMEOUT_MS = 5_000

type Pending = {
  resolve: (frame: Buffer) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class KretzRealDriver extends EventEmitter implements KretzDriver {
  private _port: SerialPort | null = null
  private _rx: Buffer = Buffer.alloc(0)
  private _pending: Pending | null = null
  /** Serializa operaciones: una transacción a la vez. */
  private _queue: Promise<unknown> = Promise.resolve()
  private _connected = false

  constructor(private readonly portPath: string) {
    super()
  }

  // ---------------------------------------------------------------------------
  // Ciclo de vida
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this._connected) return

    if (!this.portPath || this.portPath.trim() === '') {
      throw new Error('[kretz] Puerto serial no configurado. Configurarlo desde el panel admin.')
    }

    return new Promise((resolve, reject) => {
      const port = new SerialPort(
        { path: this.portPath, baudRate: BAUD_RATE, autoOpen: false },
        undefined
      )

      port.open(err => {
        if (err) {
          log.error('[kretz] Error al abrir puerto serial', { port: this.portPath, err: err.message })
          reject(new Error(`No se pudo abrir el puerto ${this.portPath}: ${err.message}`))
          return
        }

        this._port = port
        this._connected = true
        this._rx = Buffer.alloc(0)
        log.info('[kretz] Puerto serial abierto', { port: this.portPath })
        this.emit('connected')
        resolve()
      })

      port.on('data', (chunk: Buffer) => this._onData(chunk))

      port.on('close', () => {
        this._connected = false
        this._port = null
        this._rejectPending(new Error('Puerto serial cerrado'))
        log.warn('[kretz] Puerto serial cerrado')
        this.emit('disconnected')
      })

      port.on('error', (err: Error) => {
        log.error('[kretz] Error en puerto serial', err.message)
        this._rejectPending(err)
        this.emit('error', err)
      })
    })
  }

  async disconnect(): Promise<void> {
    if (!this._port) return
    return new Promise(resolve => {
      this._rejectPending(new Error('Desconexión solicitada'))
      this._port!.close(() => {
        this._connected = false
        this._port = null
        resolve()
      })
    })
  }

  isConnected(): boolean {
    return this._connected
  }

  // ---------------------------------------------------------------------------
  // Transacción base (toda operación pasa por acá)
  // ---------------------------------------------------------------------------

  /**
   * Envía un comando R30 y espera la respuesta de la balanza.
   * Las transacciones se encolan: nunca se ejecutan en paralelo.
   */
  transact(
    command: string,
    data = '',
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<ReturnType<typeof parseResponse>> {
    const run = this._queue.then(async () => {
      if (!this._port || !this._connected) {
        throw new Error('[kretz] Puerto no conectado')
      }

      const frame = encodeFrame(command, data)
      log.debug('[kretz] →', { cmd: command, data: data.slice(0, 80) })

      const respBuf = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this._pending?.timer === timer) this._pending = null
          reject(new Error(`[kretz] Sin respuesta al comando ${command} (${timeoutMs}ms)`))
        }, timeoutMs)
        this._pending = { resolve, reject, timer }
        this._port!.write(frame)
      })

      let parsed: ReturnType<typeof parseResponse>
      try {
        parsed = parseResponse(respBuf)
      } catch (e) {
        log.warn('[kretz] Trama inválida', {
          error: (e as Error).message,
          frameHex: formatRxHex(respBuf),
          rxPendingHex: formatRxHex(this._rx),
        })
        throw e
      }

      log.debug('[kretz] ←', {
        code: parsed.responseCode,
        meaning: explainResponseCode(parsed.responseCode),
        data: parsed.data.slice(0, 80),
      })

      return parsed
    })

    this._queue = run.then(() => undefined).catch(() => undefined)
    return run
  }

  // ---------------------------------------------------------------------------
  // Comandos de alto nivel
  // ---------------------------------------------------------------------------

  /** Prueba de enlace (0002). Devuelve true si la balanza responde OK. */
  async testLink(): Promise<boolean> {
    try {
      const r = await this.transact('0002', '')
      const ok = r.responseCode === '01'
      if (!ok) {
        log.warn('[kretz] testLink: balanza respondió pero no OK', {
          code: r.responseCode,
          meaning: explainResponseCode(r.responseCode),
        })
      }
      return ok
    } catch (err) {
      log.warn('[kretz] testLink falló', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  /**
   * Lee el estado actual de la balanza (1524): peso, precio e importe en pantalla.
   * Útil para peso en vivo (llamar periódicamente).
   */
  async readState(): Promise<ReturnType<typeof parseState1524>> {
    const r = await this.transact('1524', '')
    if (r.responseCode !== '01') {
      throw new Error(`[kretz] Estado no disponible: ${explainResponseCode(r.responseCode)}`)
    }
    return parseState1524(r.data)
  }

  // --- PLU ---

  /**
   * Crea o actualiza un PLU en la balanza (2005).
   * Si el PLU ya existe con ese número, lo sobreescribe.
   */
  async sendPlu(args: SendPluArgs): Promise<void> {
    const payload = buildPlu2005Data(args)
    const r = await this.transact('2005', payload)
    if (r.responseCode !== '01') {
      throw new Error(
        `[kretz] Error al enviar PLU ${args.pluNumber}: ${explainResponseCode(r.responseCode)}`
      )
    }
    log.info('[kretz] PLU enviado', { plu: args.pluNumber, name: args.name })
  }

  /**
   * Lee un PLU por número (5005).
   * Devuelve null si no existe (código 20).
   */
  async readPlu(pluNumber: string, priceDigits: 6 | 7 = 6): Promise<PluRow | null> {
    // El comando 5005 usa índice 0-based (posición en memoria).
    // PLU #1 está en posición 0, PLU #2 en posición 1, etc.
    const userNum = parseInt(pluNumber.replace(/\D/g, ''), 10) || 1
    const idx = Math.max(0, userNum - 1)
    const id = String(idx).padStart(6, '0')
    const r = await this.transact('5005', id)
    if (r.responseCode === '20') return null
    if (r.responseCode !== '01') {
      throw new Error(`[kretz] Error al leer PLU ${pluNumber}: ${explainResponseCode(r.responseCode)}`)
    }
    return parsePlu5005(r.data, priceDigits)
  }

  /**
   * Devuelve la cantidad de PLUs almacenados (5001).
   */
  async readPluCount(): Promise<number> {
    const r = await this.transact('5001', '05')
    if (r.responseCode === '40') return 0
    if (r.responseCode !== '01') {
      throw new Error(`[kretz] Error al leer conteo de PLUs: ${explainResponseCode(r.responseCode)}`)
    }
    const tail = r.data.length > 2 ? r.data.slice(2) : r.data
    const n = parseInt(tail, 10)
    return Number.isFinite(n) ? n : 0
  }

  // ---------------------------------------------------------------------------
  // Manejo de datos entrantes
  // ---------------------------------------------------------------------------

  private _onData(chunk: Buffer): void {
    this._rx = Buffer.concat([this._rx, chunk])
    if (!this._pending) return
    const taken = takeResponseFrame(this._rx)
    if (!taken) return
    const [frame, rest] = taken
    this._rx = rest
    clearTimeout(this._pending.timer)
    const p = this._pending
    this._pending = null
    p.resolve(frame)
  }

  private _rejectPending(err: Error): void {
    if (this._pending) {
      clearTimeout(this._pending.timer)
      this._pending.reject(err)
      this._pending = null
    }
  }
}

// ---------------------------------------------------------------------------
// Re-exportar tipos útiles para los handlers IPC
// ---------------------------------------------------------------------------
export type { SendPluArgs, PluRow }
