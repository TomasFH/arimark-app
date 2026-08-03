/**
 * IPC para refrescar datos remotos sin reiniciar el renderer ni cerrar sesión.
 *
 * Re-sincroniza locales, empleados, catálogo, pedidos, fiados, clientes especiales
 * y proveedores desde Firestore hacia el SQLite local.
 */
import { ipcMain } from 'electron'
import log from 'electron-log'
import { IPC } from './channels'
import { getActiveSession } from '../activeSession'
import { getBusinessConfig } from '../businessConfig'
import { ensureStoresSynced } from '../licensing/storeSync'
import { ensureEmployeesSynced, pushUnsyncedEmployeeOps } from '../licensing/employeeSync'
import { pullCatalogFromFirestore } from '../licensing/catalogSync'
import { publishCatalog } from '../licensing/catalogPublish'
import { ensureOrdersSynced, pushUnsyncedOrders } from '../licensing/orderSync'
import { ensureCustomerDebtsSynced, pushUnsyncedCustomerDebtOps } from '../licensing/customerDebtSync'
import { ensureSpecialCustomersSynced, pushUnsyncedSpecialCustomerOps } from '../licensing/specialCustomerSync'
import {
  pushUnsyncedProviders,
  pushUnsyncedDebtEvents,
} from '../licensing/providerSync'
import type { IpcResult } from '../../src/types/hw-api'

export interface RefreshRemoteDataResult {
  storeId: string | null
}

export function registerRefreshHandlers(): void {
  ipcMain.handle(IPC.REFRESH_REMOTE_DATA, async (): Promise<IpcResult<RefreshRemoteDataResult>> => {
    const session = getActiveSession()
    if (!session) {
      return { ok: false, error: 'No hay sesión activa.', code: 'NO_SESSION' }
    }

    const config = getBusinessConfig()
    const storeId = session.storeId || null

    try {
      try {
        await ensureStoresSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:refresh-remote-data] ensureStoresSynced falló (no bloqueante)', err)
      }

      try {
        await ensureEmployeesSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:refresh-remote-data] ensureEmployeesSynced falló (no bloqueante)', err)
      }

      if (storeId) {
        try {
          await pullCatalogFromFirestore(config.tenant_id, storeId)
        } catch (err) {
          log.warn('[ipc:refresh-remote-data] pullCatalogFromFirestore falló (no bloqueante)', err)
        }
        publishCatalog(config.tenant_id, storeId).catch(err =>
          log.warn('[ipc:refresh-remote-data] publishCatalog falló (no bloqueante)', err),
        )
      }

      try {
        await ensureOrdersSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:refresh-remote-data] ensureOrdersSynced falló (no bloqueante)', err)
      }
      try {
        await ensureCustomerDebtsSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:refresh-remote-data] ensureCustomerDebtsSynced falló (no bloqueante)', err)
      }
      try {
        await ensureSpecialCustomersSynced(config.tenant_id)
      } catch (err) {
        log.warn('[ipc:refresh-remote-data] ensureSpecialCustomersSynced falló (no bloqueante)', err)
      }

      pushUnsyncedProviders(config.tenant_id).catch(err =>
        log.warn('[ipc:refresh-remote-data] pushUnsyncedProviders falló (no bloqueante)', err),
      )
      pushUnsyncedDebtEvents(config.tenant_id).catch(err =>
        log.warn('[ipc:refresh-remote-data] pushUnsyncedDebtEvents falló (no bloqueante)', err),
      )
      pushUnsyncedEmployeeOps(config.tenant_id).catch(err =>
        log.warn('[ipc:refresh-remote-data] pushUnsyncedEmployeeOps falló (no bloqueante)', err),
      )
      pushUnsyncedOrders(config.tenant_id).catch(err =>
        log.warn('[ipc:refresh-remote-data] pushUnsyncedOrders falló (no bloqueante)', err),
      )
      pushUnsyncedCustomerDebtOps(config.tenant_id).catch(err =>
        log.warn('[ipc:refresh-remote-data] pushUnsyncedCustomerDebtOps falló (no bloqueante)', err),
      )
      pushUnsyncedSpecialCustomerOps(config.tenant_id).catch(err =>
        log.warn('[ipc:refresh-remote-data] pushUnsyncedSpecialCustomerOps falló (no bloqueante)', err),
      )

      log.info('[ipc:refresh-remote-data] Sync remoto disparado', { storeId, role: session.role })
      return { ok: true, data: { storeId } }
    } catch (err) {
      log.error('[ipc:refresh-remote-data] Error inesperado', err)
      return { ok: false, error: 'Error al actualizar datos remotos.' }
    }
  })
}
