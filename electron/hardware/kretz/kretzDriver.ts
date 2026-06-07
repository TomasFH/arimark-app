/**
 * Driver real de la balanza KRETZ RPF US30P2CAR — protocolo R30 sobre RS-232.
 *
 * Configuración serial: 115200 baud, 8N1 (sin paridad, 1 stop bit) — KRETZ REPORT NX via USB.
 * Puerto configurable via SECRET_KEYS.KRETZ_PORT guardado en safeStorage.
 *
 * NOTA: este módulo NUNCA se usa en APP_ENV=sandbox.
 * En sandbox y tests se usa KretzMockDriver.
 */

import { EventEmitter } from 'events'
import { SerialPort } from 'serialport'
import log from 'electron-log'
import type { KretzDriver, ScaleOrderData } from './kretzDriver.interface'
import { parseR30Frame, extractNextR30Frame } from './r30Parser'

const BAUD_RATE = 115200

export class KretzRealDriver extends EventEmitter implements KretzDriver {
  private _port: SerialPort | null = null
  private _buffer: Buffer = Buffer.alloc(0)
  private _connected = false

  constructor(private readonly portPath: string) {
    super()
  }

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
    // LOG DIAGNÓSTICO TEMPORAL — muestra bytes crudos recibidos desde la balanza.
    // Eliminar una vez confirmado el protocolo real.
    log.info('[kretz] Bytes crudos recibidos', {
      hex: chunk.toString('hex').match(/../g)?.join(' '),
      ascii: chunk.toString('ascii').replace(/[^\x20-\x7e]/g, '.'),
      length: chunk.length,
    })

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
      const weightKg = weightGrams / 1000
      const unitPrice = unitPriceCents / 100
      const subtotal = totalCents / 100

      // Interim: cada frame R30 se emite como pedido de un ítem.
      // En Fase 1, cuando se confirme el protocolo de impresión/cierre por canal,
      // este punto acumulará ítems y emitirá un ScaleOrderData completo al imprimir.
      const order: ScaleOrderData = {
        channel: 'A',
        items: [{ productCode, weightKg, unitPrice, subtotal }],
        total: subtotal,
        timestamp: new Date().toISOString(),
      }

      log.info('[kretz] Pedido recibido (frame R30)', order)
      this.emit('order', order)
    }
  }
}
