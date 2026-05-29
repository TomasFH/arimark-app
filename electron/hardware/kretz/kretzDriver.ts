/**
 * Driver real de la balanza KRETZ RPF US30P2CAR — protocolo R30 sobre RS-232.
 *
 * Configuración serial: 9600 baud, 8N1 (sin paridad, 1 stop bit).
 * Puerto configurable via SECRET_KEYS.KRETZ_PORT guardado en safeStorage.
 *
 * NOTA: este módulo NUNCA se usa en APP_ENV=sandbox.
 * En sandbox y tests se usa KretzMockDriver.
 */

import { EventEmitter } from 'events'
import { SerialPort } from 'serialport'
import log from 'electron-log'
import type { KretzDriver, ScaleTicketData } from './kretzDriver.interface'
import { parseR30Frame, extractNextR30Frame } from './r30Parser'

const BAUD_RATE = 9600

export class KretzRealDriver extends EventEmitter implements KretzDriver {
  private _port: SerialPort | null = null
  private _buffer: Buffer = Buffer.alloc(0)
  private _connected = false

  constructor(private readonly portPath: string) {
    super()
    if (!portPath || portPath.trim() === '') {
      throw new Error('[kretz] Puerto serial no configurado. Configurarlo desde el panel admin.')
    }
  }

  async connect(): Promise<void> {
    if (this._connected) return

    return new Promise((resolve, reject) => {
      const port = new SerialPort(
        { path: this.portPath, baudRate: BAUD_RATE, autoOpen: false },
        undefined
      )

      port.open(err => {
        if (err) {
          log.error('[kretz] Error al abrir puerto serial', { port: this.portPath, err })
          reject(new Error(`No se pudo abrir el puerto ${this.portPath}: ${err.message}`))
          return
        }

        this._port = port
        this._connected = true
        this._buffer = Buffer.alloc(0)
        log.info('[kretz] Puerto serial abierto', { port: this.portPath })
        this.emit('connected')
        resolve()
      })

      port.on('data', (chunk: Buffer) => this._handleData(chunk))

      port.on('close', () => {
        this._connected = false
        this._port = null
        log.warn('[kretz] Puerto serial cerrado')
        this.emit('disconnected')
      })

      port.on('error', (err: Error) => {
        log.error('[kretz] Error en puerto serial', err)
        this.emit('error', err)
      })
    })
  }

  async disconnect(): Promise<void> {
    if (!this._port) return
    return new Promise(resolve => {
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

  private _handleData(chunk: Buffer): void {
    this._buffer = Buffer.concat([this._buffer, chunk])

    // Extraer todos los frames completos del buffer acumulado
    while (this._buffer.length > 0) {
      const { frame, consumed } = extractNextR30Frame(this._buffer)
      this._buffer = this._buffer.subarray(consumed)

      if (frame === null) break

      const result = parseR30Frame(frame)
      if (!result.ok) {
        log.warn('[kretz] Frame R30 inválido descartado', { error: result.error })
        this.emit('error', new Error(`Frame R30 inválido: ${result.error}`))
        continue
      }

      const { productCode, weightGrams, unitPriceCents, totalCents } = result.data
      const ticket: ScaleTicketData = {
        weightKg: weightGrams / 1000,
        productCode,
        unitPrice: unitPriceCents / 100,
        subtotal: totalCents / 100,
        timestamp: new Date().toISOString(),
      }

      log.info('[kretz] Ticket recibido', ticket)
      this.emit('ticket', ticket)
    }
  }
}
