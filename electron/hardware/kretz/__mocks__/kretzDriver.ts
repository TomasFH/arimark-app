/**
 * Mock del driver KRETZ para tests y modo dev sin hardware.
 * NUNCA se incluye en el bundle de producción.
 *
 * Modos inyectables via KRETZ_MOCK_MODE:
 *   manual             — sin actividad automática (default)
 *   timeout            — no responde (simula balanza sin señal)
 *   garbage            — emite errores de datos corruptos periódicamente
 *   disconnect         — se desconecta automáticamente tras N intervalos
 *   malformed_response — emite errores de frame inválido periódicamente
 */

import { EventEmitter } from 'events'
import type { KretzDriver, SendPluArgs, PluRow } from '../kretzDriver.interface'

export class KretzMockDriver extends EventEmitter implements KretzDriver {
  private _connected = false
  private _timer: NodeJS.Timeout | null = null
  private _intervalCount = 0

  private get mode(): string {
    return process.env['KRETZ_MOCK_MODE'] ?? 'manual'
  }

  private get intervalMs(): number {
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

    if (
      this.mode === 'disconnect' ||
      this.mode === 'garbage' ||
      this.mode === 'malformed_response'
    ) {
      this._startFaultTimer()
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

  // ---- PLU (mock — siempre OK en dev) ----

  async testLink(): Promise<boolean> {
    return this._connected
  }

  async sendPlu(_args: SendPluArgs): Promise<void> {
    // No-op en mock
  }

  async deletePlu(_pluNumber: string): Promise<void> {
    // No-op en mock
  }

  async readPlu(_pluNumber: string, _priceDigits?: 6 | 7): Promise<PluRow | null> {
    return null
  }

  async readPluCount(): Promise<number> {
    return 0
  }

  private _startFaultTimer(): void {
    this._intervalCount = 0
    this._timer = setInterval(() => {
      if (this.mode === 'garbage') {
        this.emit('error', new Error('Datos corruptos recibidos del puerto serial'))
        return
      }

      if (this.mode === 'malformed_response') {
        this.emit('error', new Error('Frame recibido con campos inválidos (peso o precio fuera de rango)'))
        return
      }

      if (this.mode === 'disconnect') {
        this._intervalCount++
        if (this._intervalCount >= this.disconnectAfter) {
          this.disconnect()
        }
      }
    }, this.intervalMs)
  }
}
