/**
 * Estado de sesión activa en el proceso main.
 *
 * Se establece tras el login exitoso de una cajera y se limpia al logout.
 * Los handlers de turnos, ventas y tickets lo consultan para saber quién
 * está operando y en qué turno, sin necesidad de recibirlo en cada payload IPC.
 */

export interface ActiveSession {
  userId: string
  storeId: string
  /** ID del turno abierto, null si aún no se abrió turno en esta sesión. */
  shiftId: string | null
}

let _session: ActiveSession | null = null

export function setActiveSession(session: ActiveSession | null): void {
  _session = session
}

export function getActiveSession(): ActiveSession | null {
  return _session
}

/**
 * Actualiza solo el shiftId de la sesión activa.
 * Llamar cuando la cajera abre un turno.
 */
export function updateActiveShift(shiftId: string | null): void {
  if (_session) {
    _session = { ..._session, shiftId }
  }
}
