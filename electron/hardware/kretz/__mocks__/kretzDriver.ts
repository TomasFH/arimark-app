/**
 * Mock del driver KRETZ para sandbox y tests.
 * NUNCA se incluye en el bundle de producción.
 *
 * Modos inyectables via KRETZ_MOCK_MODE:
 *   manual             — sin pedidos automáticos; usar emitMockOrder() o IPC dev (default)
 *   normal             — genera pedidos sintéticos cada N ms
 *   timeout            — no responde (simula balanza sin señal)
 *   garbage            — emite bytes aleatorios (corrupción de protocolo)
 *   disconnect         — emite 'disconnected' después de N pedidos
 *   malformed_response — frame recibido pero campos semánticamente inválidos
 */

import { EventEmitter } from 'events'
import type { KretzDriver, ScaleOrderData, ScaleChannel } from '../kretzDriver.interface'

const SAMPLE_PRODUCTS = [
  { code: 'ASADO', price: 8500 },
  { code: 'VACIO', price: 9200 },
  { code: 'PALETA', price: 7800 },
  { code: 'POLLO', price: 5500 },
]

const CHANNELS: ScaleChannel[] = ['A', 'B', 'C', 'D']

export class KretzMockDriver extends EventEmitter implements KretzDriver {
  private _connected = false
  private _timer: NodeJS.Timeout | null = null
  private _orderCount = 0

  private get mode(): string {
    return process.env['KRETZ_MOCK_MODE'] ?? 'manual'
  }

  private get orderIntervalMs(): number {
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
      this.mode === 'normal' ||
      this.mode === 'disconnect' ||
      this.mode === 'garbage' ||
      this.mode === 'malformed_response'
    ) {
      this._startGenerating()
    }
  }

  /**
   * Emite un pedido completo manualmente. Usado por el panel de desarrollo (sandbox).
   * Requiere que el driver esté conectado.
   */
  emitMockOrder(params: {
    channel: ScaleChannel
    items: Array<{ productCode: string; weightKg: number; unitPrice: number }>
  }): void {
    if (!this._connected) {
      throw new Error('KRETZ mock no conectado')
    }

    const items = params.items.map(item => ({
      productCode: item.productCode,
      weightKg: item.weightKg,
      unitPrice: item.unitPrice,
      subtotal: parseFloat((item.weightKg * item.unitPrice).toFixed(2)),
    }))

    const order: ScaleOrderData = {
      channel: params.channel,
      items,
      total: parseFloat(items.reduce((s, i) => s + i.subtotal, 0).toFixed(2)),
      timestamp: new Date().toISOString(),
    }

    this.emit('order', order)
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

      if (this.mode === 'malformed_response') {
        this.emit('error', new Error('Frame recibido con campos inválidos (peso o precio fuera de rango)'))
        return
      }

      if (this.mode === 'disconnect' && this._orderCount >= this.disconnectAfter) {
        this.disconnect()
        return
      }

      // Generar pedido sintético con 1–3 productos aleatorios
      const itemCount = Math.floor(Math.random() * 3) + 1
      const items = Array.from({ length: itemCount }, () => {
        const product = SAMPLE_PRODUCTS[Math.floor(Math.random() * SAMPLE_PRODUCTS.length)]
        const weightKg = parseFloat((Math.random() * 2 + 0.2).toFixed(3))
        return {
          productCode: product.code,
          weightKg,
          unitPrice: product.price,
          subtotal: parseFloat((weightKg * product.price).toFixed(2)),
        }
      })

      const order: ScaleOrderData = {
        channel: CHANNELS[this._orderCount % 4],
        items,
        total: parseFloat(items.reduce((s, i) => s + i.subtotal, 0).toFixed(2)),
        timestamp: new Date().toISOString(),
      }

      this._orderCount++
      this.emit('order', order)
    }, this.orderIntervalMs)
  }
}
