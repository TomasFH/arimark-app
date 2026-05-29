/**
 * Mock del driver KRETZ para sandbox y tests.
 * NUNCA se incluye en el bundle de producción.
 *
 * Modos inyectables via KRETZ_MOCK_MODE:
 *   normal      — genera tickets sintéticos cada N ms (default)
 *   timeout     — no responde (simula balanza sin señal)
 *   garbage     — emite datos corruptos (corrupción de protocolo)
 *   disconnect  — emite 'disconnected' después de N tickets
 */

import { EventEmitter } from 'events'
import type { KretzDriver, ScaleTicketData } from '../kretzDriver.interface'

const SAMPLE_PRODUCTS = [
  { code: 'ASADO', price: 8500 },
  { code: 'VACIO', price: 9200 },
  { code: 'PALETA', price: 7800 },
  { code: 'POLLO', price: 5500 },
]

export class KretzMockDriver extends EventEmitter implements KretzDriver {
  private _connected = false
  private _timer: NodeJS.Timeout | null = null
  private _ticketCount = 0

  private get mode(): string {
    return process.env['KRETZ_MOCK_MODE'] ?? 'normal'
  }

  private get ticketIntervalMs(): number {
    return parseInt(process.env['KRETZ_MOCK_INTERVAL_MS'] ?? '3000', 10)
  }

  private get disconnectAfter(): number {
    return parseInt(process.env['KRETZ_MOCK_DISCONNECT_AFTER'] ?? '5', 10)
  }

  async connect(): Promise<void> {
    if (this.mode === 'timeout') {
      return
    }

    this._connected = true
    this.emit('connected')

    if (this.mode === 'normal' || this.mode === 'disconnect' || this.mode === 'garbage') {
      this._startGenerating()
    }
  }

  async disconnect(): Promise<void> {
    this._connected = false
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this.emit('disconnected')
  }

  isConnected(): boolean {
    return this._connected
  }

  private _startGenerating(): void {
    this._timer = setInterval(() => {
      if (this.mode === 'garbage') {
        this.emit('error', new Error('Datos corruptos recibidos del puerto serial'))
        return
      }

      if (this.mode === 'disconnect' && this._ticketCount >= this.disconnectAfter) {
        this.disconnect()
        return
      }

      const product = SAMPLE_PRODUCTS[Math.floor(Math.random() * SAMPLE_PRODUCTS.length)]
      const weightKg = parseFloat((Math.random() * 2 + 0.2).toFixed(3))
      const ticket: ScaleTicketData = {
        weightKg,
        productCode: product.code,
        unitPrice: product.price,
        subtotal: parseFloat((weightKg * product.price).toFixed(2)),
        timestamp: new Date().toISOString(),
      }

      this._ticketCount++
      this.emit('ticket', ticket)
    }, this.ticketIntervalMs)
  }
}
