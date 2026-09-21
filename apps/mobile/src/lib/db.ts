/**
 * Base de datos IndexedDB para el POS móvil offline-first.
 * Usa Dexie como wrapper tipado sobre IndexedDB.
 *
 * Stores:
 *  - profile:  perfil del usuario autenticado (uid, role, locales autorizados)
 *  - catalog:  catálogo de productos por local (descargado de Firestore)
 *  - shifts:   turnos creados en el celular, pendientes de sync
 *  - sales:    ventas confirmadas en el celular, pendientes de sync
 *  - expenses: gastos e ingresos de efectivo del turno (v3)
 *  - providers / employees: caché para gasto, vales y liquidación (v4)
 *  - vales / salaryPayments / providerDebtEvents: pendientes de sync (v4)
 *  - ceboEntries: kilos de cebo del turno (v5; injectReason en expenses es campo extra)
 *  - merchandiseIntakes: libro de ingreso de mercadería (v6; líneas en v7)
 *  - merchRubros: chips de rubro de toda la licencia (v7)
 *
 * El acceso offline ya no depende de un PIN: la sesión de Firebase Auth queda
 * persistida en IndexedDB (ver firebase.ts), por lo que la versión 2 del schema
 * elimina el antiguo store `pin`.
 */
import Dexie, { type EntityTable } from 'dexie'
import type {
  LocalProfile,
  CatalogProduct,
  LocalShift,
  LocalSale,
  LocalExpense,
  LocalCebo,
  LocalMerchandiseIntake,
  LocalMerchRubro,
  LocalMerchVisitDraft,
  LocalProviderPurchasePrices,
  CachedProvider,
  CachedEmployee,
  LocalVale,
  LocalSalaryPayment,
  LocalProviderDebtEvent,
} from '../types/pos'

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
  expenses!: EntityTable<LocalExpense, 'id'>
  providers!: EntityTable<CachedProvider, 'id'>
  employees!: EntityTable<CachedEmployee, 'id'>
  vales!: EntityTable<LocalVale, 'id'>
  salaryPayments!: EntityTable<LocalSalaryPayment, 'id'>
  providerDebtEvents!: EntityTable<LocalProviderDebtEvent, 'id'>
  ceboEntries!: EntityTable<LocalCebo, 'id'>
  merchandiseIntakes!: EntityTable<LocalMerchandiseIntake, 'id'>
  merchRubros!: EntityTable<LocalMerchRubro, 'id'>
  merchVisitDrafts!: EntityTable<LocalMerchVisitDraft, 'shiftId'>
  providerPurchasePrices!: EntityTable<LocalProviderPurchasePrices, 'providerId'>

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

    // v3: gastos / aportes de emergencia del POS.
    this.version(3).stores({
      expenses: 'id, shiftId, storeId, syncStatus, createdAt',
    })

    // v4: caché de proveedores/empleados + vales, liquidación y deuda.
    this.version(4).stores({
      providers: 'id, name, archivedAt',
      employees: 'id, name',
      vales: 'id, employeeId, shiftId, storeId, syncStatus, paidAt',
      salaryPayments: 'id, employeeId, weekStart, shiftId, syncStatus',
      providerDebtEvents: 'id, providerId, storeId, expenseId, syncStatus',
    })

    // v5: cebo del turno (kg + nota). injectReason en expenses no requiere índice.
    this.version(5).stores({
      ceboEntries: 'id, shiftId, storeId, syncStatus, createdAt',
    })

    // v6: libro de ingreso de mercadería (cantidad + rubro + pago del mismo acto).
    this.version(6).stores({
      merchandiseIntakes: 'id, shiftId, storeId, syncStatus, createdAt',
    })

    // v7: líneas por entrega + caché de rubros de la licencia.
    this.version(7).stores({
      merchRubros: 'id, sortOrder, archivedAt',
    })

    // v8: borrador de visita (no se sube a Firestore) + último costo de compra.
    this.version(8).stores({
      merchVisitDrafts: 'shiftId',
      providerPurchasePrices: 'providerId',
    })
  }
}

export const db = new MobileDb()
