import type { EventEmitter } from 'events'

export interface ScaleTicketData {
  weightKg: number
  productCode: string
  unitPrice: number
  subtotal: number
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

export type KretzEvent = 'ticket' | 'connected' | 'disconnected' | 'error'
