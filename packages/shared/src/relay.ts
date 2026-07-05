/**
 * Contrato del relay de escaneo móvil → PC vía Firestore.
 *
 * Flujo:
 *   1. La PWA móvil escanea un barcode y crea un RelayScanEvent con status='pending'.
 *   2. El proceso main del desktop observa ese evento, lo valida y lo actualiza a
 *      'accepted' (con productName) o 'rejected' (con rejectReason).
 *   3. La PWA móvil observa el cambio de estado y muestra feedback al usuario.
 *   4. Si fue aceptado, el desktop inyecta los dígitos al renderer via IPC RELAY_SCAN.
 */

/** Estado de un evento de relay */
export type RelayScanStatus = 'pending' | 'accepted' | 'rejected'

/** Documento Firestore que representa un escaneo relayado desde el móvil */
export interface RelayScanEvent {
  /** ID del evento; generado por el móvil para idempotencia */
  eventId: string
  /** Barcode crudo escaneado (13 dígitos EAN-13) */
  barcode: string
  /** Estado actual del procesamiento */
  status: RelayScanStatus
  /** ISO timestamp de creación (generado en el cliente) */
  createdAt: string
  /** UID del usuario que generó el evento */
  createdByUid: string
  /** Nombre del producto (seteado por el desktop al aceptar) */
  productName?: string
  /** Motivo de rechazo (seteado por el desktop al rechazar) */
  rejectReason?: string
}

/**
 * Ruta del colección de eventos de relay en Firestore.
 * @param licenseKey  Clave de licencia del negocio (ej. "arimark-001")
 * @param storeId     ID del local (ej. "local1")
 */
export function relayEventsPath(licenseKey: string, storeId: string): string {
  return `licenses/${licenseKey}/relay/${storeId}/events`
}
