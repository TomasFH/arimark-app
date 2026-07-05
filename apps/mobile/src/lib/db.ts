/**
 * Base de datos IndexedDB para el POS móvil offline-first.
 * Usa Dexie como wrapper tipado sobre IndexedDB.
 *
 * Stores:
 *  - profile:  perfil del usuario autenticado (uid, role, locales autorizados)
 *  - pin:      hash PBKDF2 del PIN de emergencia
 *  - catalog:  catálogo de productos por local (descargado de Firestore)
 *  - shifts:   turnos creados en el celular, pendientes de sync
 *  - sales:    ventas confirmadas en el celular, pendientes de sync
 */
import Dexie, { type EntityTable } from 'dexie'
import type { LocalProfile, CatalogProduct, LocalShift, LocalSale } from '../types/pos'

export interface PinRecord {
  id: 1  // Siempre un único registro.
  uid: string
  hashB64: string
  saltB64: string
}

export interface CatalogRecord {
  /** storeId — clave primaria. */
  storeId: string
  products: CatalogProduct[]
  updatedAt: string
}

class MobileDb extends Dexie {
  profile!: EntityTable<LocalProfile, 'uid'>
  pin!: EntityTable<PinRecord, 'id'>
  catalog!: EntityTable<CatalogRecord, 'storeId'>
  shifts!: EntityTable<LocalShift, 'id'>
  sales!: EntityTable<LocalSale, 'id'>

  constructor() {
    super('carniceria-mobile-v1')

    this.version(1).stores({
      profile:  'uid, role',
      pin:      'id, uid',
      catalog:  'storeId',
      shifts:   'id, storeId, syncStatus, closedAt',
      sales:    'id, shiftId, storeId, syncStatus, createdAt',
    })
  }
}

export const db = new MobileDb()
