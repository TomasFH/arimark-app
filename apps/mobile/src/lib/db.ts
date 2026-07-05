/**
 * Base de datos IndexedDB para el POS móvil offline-first.
 * Usa Dexie como wrapper tipado sobre IndexedDB.
 *
 * Stores:
 *  - profile:  perfil del usuario autenticado (uid, role, locales autorizados)
 *  - catalog:  catálogo de productos por local (descargado de Firestore)
 *  - shifts:   turnos creados en el celular, pendientes de sync
 *  - sales:    ventas confirmadas en el celular, pendientes de sync
 *
 * El acceso offline ya no depende de un PIN: la sesión de Firebase Auth queda
 * persistida en IndexedDB (ver firebase.ts), por lo que la versión 2 del schema
 * elimina el antiguo store `pin`.
 */
import Dexie, { type EntityTable } from 'dexie'
import type { LocalProfile, CatalogProduct, LocalShift, LocalSale } from '../types/pos'

export interface CatalogRecord {
  /** storeId — clave primaria. */
  storeId: string
  products: CatalogProduct[]
  updatedAt: string
}

class MobileDb extends Dexie {
  profile!: EntityTable<LocalProfile, 'uid'>
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

    // v2: se elimina el store `pin` (login offline ahora es sesión persistente).
    this.version(2).stores({
      pin: null,
    })
  }
}

export const db = new MobileDb()
