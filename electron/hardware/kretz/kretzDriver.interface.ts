import type { EventEmitter } from 'events'

export type ScaleChannel = 'A' | 'B' | 'C' | 'D'

/** Un ítem dentro de un pedido emitido por la balanza */
export interface ScaleOrderItemData {
  productCode: string
  weightKg: number
  unitPrice: number
  subtotal: number
}

/**
 * Pedido completo emitido por la balanza al imprimir el ticket físico.
 * Un pedido = N productos de un mismo cliente en un canal dado (A/B/C/D).
 *
 * Nota: hasta confirmar el protocolo real con hardware en Fase 1,
 * el mock genera pedidos sintéticos. El campo `channel` y la agrupación
 * se ajustarán cuando se inspeccione empíricamente el formato del hardware.
 */
export interface ScaleOrderData {
  channel: ScaleChannel
  items: ScaleOrderItemData[]
  total: number
  timestamp: string
}

export interface KretzDriver extends EventEmitter {
  /** Inicia la escucha del puerto serial */
  connect(): Promise<void>
  /** Cierra la conexión */
  disconnect(): Promise<void>
  /** Estado de conexión actual */
  isConnected(): boolean
}

export type KretzEvent = 'order' | 'connected' | 'disconnected' | 'error'
