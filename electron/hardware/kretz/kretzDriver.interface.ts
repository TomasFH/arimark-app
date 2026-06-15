import type { EventEmitter } from 'events'
import type { SendPluArgs, PluRow } from './r30Protocol'

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
 */
export interface ScaleOrderData {
  channel: ScaleChannel
  items: ScaleOrderItemData[]
  total: number
  timestamp: string
}

export interface KretzDriver extends EventEmitter {
  /** Abre el puerto serial y establece comunicación con la balanza */
  connect(): Promise<void>
  /** Cierra la conexión */
  disconnect(): Promise<void>
  /** Estado de conexión actual */
  isConnected(): boolean

  // ---- Gestión de PLUs ----
  /** Prueba de enlace (cmd 0002). Devuelve true si la balanza responde. */
  testLink(): Promise<boolean>
  /** Crea o sobreescribe un PLU en la balanza (cmd 2005). */
  sendPlu(args: SendPluArgs): Promise<void>
  /** Borra un PLU de la balanza por número (cmd 3005). */
  deletePlu(pluNumber: string): Promise<void>
  /** Lee un PLU por número (cmd 5005). Devuelve null si no existe. */
  readPlu(pluNumber: string, priceDigits?: 6 | 7): Promise<PluRow | null>
  /** Devuelve la cantidad de PLUs almacenados en la balanza (cmd 5001). */
  readPluCount(): Promise<number>
}

export type KretzEvent = 'order' | 'connected' | 'disconnected' | 'error'

// Re-exportar para que los handlers no importen directamente del protocolo
export type { SendPluArgs, PluRow }
