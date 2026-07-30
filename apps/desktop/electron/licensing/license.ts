/**
 * Namespace de datos del negocio (histórico: "licencia").
 *
 * A1 (jul 2026): se eliminó el gate de verificación de licencia activa en
 * Firestore. El valor de `tenant_id` en business.json
 * solo identifica el prefijo de rutas en Firestore (`licenses/{key}/...`).
 * Cualquiera puede instalar y usar la app; la única puerta es Firebase Auth.
 *
 * `verifyLicense` queda como no-op compatible con callers/tests legacy:
 * siempre retorna válida y no consulta la red.
 */

import log from 'electron-log'

export type LicenseStatus =
  | { valid: true }
  | { valid: false; reason: 'inactive' | 'expired' | 'offline_timeout' | 'not_found' | 'error'; message: string }

/**
 * @deprecated Gate eliminado (TASKS_V1 A1). Siempre retorna válida.
 * El parámetro se conserva por compatibilidad de firma.
 */
export async function verifyLicense(_licenseKey: string): Promise<LicenseStatus> {
  log.info('[license] Gate de licencia deshabilitado — siempre válida')
  return { valid: true }
}
